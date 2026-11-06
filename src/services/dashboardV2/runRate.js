import { getPlanPriceSync } from '../pricing/pricingService'
import { getTransportPriceSync } from '../pricing/transportPricingService'
import { monthBounds } from './padron'

// MRR contratado: lo que la cartera activa tiene pactado por mes. Es un run-rate, no
// la facturación del mes: un alta del día 20 vale su cuota entera y una falta no lo
// mueve. Por cliente y mes:
//   asistencia: precio neto de lista del plan vigente × (1 − descuento del mes)
//   transporte: precio neto de lista por frecuencia y distancia, sin descuento
// · Neto de IVA: los netos de las listas (asistencia al 22%, transporte al 10%).
// · Incluye el transporte, pleno: el descuento corre solo sobre la asistencia, igual
//   que en calculate_month_billing.
// · Plan vigente del mes (client_plans está versionado), precio vigente del mes
//   (plan_pricing y transport_pricing también) y el descuento de ese mes del cliente
//   (monthly_invoices.discount_percent: el de una promo o uno suelto).
// · La distancia es la de la dirección del cliente, la misma que usa la facturación.
// Lógica pura; las lecturas están en commercialQueries.js. month es 0-indexed.

export const discountKey = (clientId, year, month) => `${clientId}|${year}|${month}`

// Las versiones de plan de cada cliente, de la más vieja a la más nueva.
export function indexPlans(plans) {
  const out = new Map()
  for (const p of plans || []) {
    if (!out.has(p.clientId)) out.set(p.clientId, [])
    out.get(p.clientId).push(p)
  }
  for (const list of out.values()) list.sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)))
  return out
}

// El plan vigente en un mes: la versión más nueva que arranca a más tardar el 1 del
// mes; si el mes es anterior a todas, la más vieja (igual que calculate_month_billing).
export function planForMonth(versions, year, month) {
  if (!versions?.length) return null
  const { first } = monthBounds(year, month)
  let pick = null
  for (const v of versions) if (String(v.effectiveFrom) <= first) pick = v
  return pick || versions[0]
}

export function indexDiscounts(rows) {
  const out = new Map()
  for (const r of rows || []) {
    const pct = Number(r.discountPercent)
    if (pct > 0) out.set(discountKey(r.clientId, r.year, r.month), pct)
  }
  return out
}

// Lo que vale un cliente en un mes. missing: 'plan' (sin plan), 'price' (sin precio
// de lista para su plan) o 'distance' (con transporte y sin distancia): ese
// componente queda en 0 y se avisa.
export function monthlyValue({ plan, distanceRange, discountPercent }, { planPricing, transportPricing }, year, month) {
  if (!plan) return { attendanceList: 0, discount: 0, attendance: 0, transport: 0, total: 0, discountPercent: 0, missing: 'plan' }
  const pct = Math.min(100, Math.max(0, Number(discountPercent) || 0))
  const list = getPlanPriceSync(planPricing || [], plan.frequency, plan.schedule, year, month).priceNet || 0
  const attendance = list * (1 - pct / 100)
  let transport = 0
  let missing = list > 0 ? null : 'price'
  if (plan.hasTransport) {
    if (!distanceRange) missing = missing || 'distance'
    else transport = getTransportPriceSync(transportPricing || [], plan.frequency, distanceRange, year, month).priceNet || 0
  }
  return { attendanceList: list, discount: list - attendance, attendance, transport, total: attendance + transport, discountPercent: pct, missing }
}

// valuer(clientId, year, month) → { plan, ...monthlyValue }, memorizado.
// sources: { plans, discounts, planPricing, transportPricing, clients (con distanceRange) }
export function createValuer({ plans, discounts, planPricing, transportPricing, clients }) {
  const versions = indexPlans(plans)
  const discountBy = indexDiscounts(discounts)
  const distanceBy = new Map((clients || []).map(c => [c.id, c.distanceRange || null]))
  const pricing = { planPricing, transportPricing }
  const cache = new Map()
  return (clientId, year, month) => {
    const key = discountKey(clientId, year, month)
    if (!cache.has(key)) {
      const plan = planForMonth(versions.get(clientId), year, month)
      cache.set(key, { plan, ...monthlyValue({ plan, distanceRange: distanceBy.get(clientId), discountPercent: discountBy.get(key) }, pricing, year, month) })
    }
    return cache.get(key)
  }
}

// Suma de valores, redondeada por componente para que cierre exacto:
// lista − descuentos + transporte = total.
export function sumValues(values) {
  let list = 0
  let attendance = 0
  let transport = 0
  let missing = 0
  for (const v of values) {
    list += v.attendanceList
    attendance += v.attendance
    transport += v.transport
    if (v.missing) missing++
  }
  const att = Math.round(attendance)
  const trans = Math.round(transport)
  const attList = Math.round(list)
  return { attendanceList: attList, discount: attList - att, attendance: att, transport: trans, total: att + trans, count: values.length, missing }
}

// MRR de cada mes de la línea de tiempo (activityTimeline.buildTimeline):
//   closing: los activos al cierre
//   gained / lost: las altas y las bajas del mes, cada una por lo que vale ese mes
//   opening: el MRR del cierre anterior (en el mes del lanzamiento, la base heredada)
//   other: el residuo, lo que movió el MRR sin que nadie entrara ni saliera (cambios
//          de plan, de precio de lista y de descuento):
//          opening + gained − lost + other = closing
export function runRateSeries(timeline, valuer) {
  const out = []
  timeline.months.forEach((m, i) => {
    const valueOf = r => valuer(r.person.id, m.year, m.month)
    const closing = sumValues(m.active.map(valueOf))
    const gained = sumValues(m.entries.map(valueOf))
    const lost = sumValues(m.exits.map(valueOf))
    const opening = i > 0 ? out[i - 1].closing.total : sumValues(m.opening.map(valueOf)).total
    out.push({
      year: m.year,
      month: m.month,
      closing,
      gained,
      lost,
      opening,
      other: closing.total - opening - gained.total + lost.total
    })
  })
  return out
}

// MRR ganado y perdido en una ventana de hasta `size` meses que cierra en `index`,
// recortada al lanzamiento.
export function runRateWindow(series, index, size = 12) {
  const list = series.slice(Math.max(0, index - size + 1), index + 1)
  const gained = list.reduce((s, r) => s + r.gained.total, 0)
  const lost = list.reduce((s, r) => s + r.lost.total, 0)
  return {
    months: list.length,
    gained,
    lost,
    net: gained - lost,
    avgGained: list.length ? gained / list.length : null,
    avgLost: list.length ? lost / list.length : null
  }
}
