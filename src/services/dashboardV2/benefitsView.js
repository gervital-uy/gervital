import { promoMonthIndex, promoOrdinal, promoPackageAmount } from '../promotions/promotionsView'
import { isInactiveThroughout } from '../clients/inactivityPeriods'
import { PLATFORM_START_ISO } from './platform'
import { inactivityPeriodsOf, monthBounds } from './padron'

// Promociones y otros descuentos del mes (bloque de Gestión CFP). Lógica pura; las
// lecturas están en benefitsQueries.js. month es 0-indexed y un mes se identifica por
// su ordinal (promoOrdinal: year * 12 + month).
//
// Dos clases de beneficio, siempre sobre la asistencia (el transporte nunca lleva
// descuento):
//   · promo prepaga (tabla promotions): N ≥ 1 meses consecutivos con cualquier %,
//     dueña de su rango. El primer mes (ancla) cobra el paquete entero y los meses
//     2..N quedan prepagos en $0 (CLAUDE.md, migraciones 086-092).
//   · descuento suelto: discount_percent de un mes sin promo (apply_plan_discount).
//     No existe una entidad "acuerdo": se agrupa en corridas de meses consecutivos
//     del mismo cliente con el mismo %.
// Cada promo o corrida es un acuerdo (una fila de las tablas). Lo del mes (cobertura,
// descuento, paquetes, renovaciones) se mide sobre el padrón del mes (padron.js): la
// misma población que cobra Gestión CFP.

const num = v => (v == null || v === '' ? 0 : Number(v) || 0)
const ordOfIso = iso => promoOrdinal(Number(String(iso).slice(0, 4)), Number(String(iso).slice(5, 7)) - 1)

export const PLATFORM_START_ORD = ordOfIso(PLATFORM_START_ISO)
export const ymOfOrdinal = ord => ({ year: Math.floor(ord / 12), month: ord % 12 })

const byName = (a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es')

// Estado de un acuerdo respecto del mes mirado:
//   · upcoming: arranca después.
//   · active: vigente.
//   · expiring (por renovar): vigente, y el cliente se queda sin beneficio al terminar
//     este mes o el siguiente. Lo que cuenta es dónde termina la cadena de meses con
//     beneficio: una promo que ya tiene otra pegada a continuación (renovada) o un
//     descuento escalonado (25% → 20% → 15%) siguen vigentes hasta el último tramo.
//   · expired: terminó.
export const STATE_ORDER = { expiring: 0, active: 1, upcoming: 2, expired: 3 }

export function agreementState(agreement, ord) {
  if (agreement.startOrd > ord) return 'upcoming'
  if (agreement.endOrd < ord) return 'expired'
  return agreement.benefitEndOrd <= ord + 1 ? 'expiring' : 'active'
}

// Los chips de estado. Historial no sigue al mes elegido: son acuerdos ya terminados
// (contra el mes en curso), recortados por su propio rango (benefitHistory).
export const BENEFIT_FILTERS = [
  { key: 'current', label: 'Vigentes', states: ['active', 'expiring'] },
  { key: 'expiring', label: 'Por renovar', states: ['expiring'] },
  { key: 'upcoming', label: 'Próximos', states: ['upcoming'] },
  { key: 'history', label: 'Historial', states: ['expired'] }
]

// Descuento de un mes ya cobrado, reconstruido de lo cobrado: la asistencia cobrada
// con el p% vale lista × (1 − p), así que lista − cobrado = cobrado × p / (100 − p).
// Un mes sin cobrar no tiene esa foto, y al 100% lo cobrado es 0: quedan sin dato.
export function paidMonthDiscount({ paymentStatus, attendanceChargeableGross, discountPercent }) {
  const p = num(discountPercent)
  if (paymentStatus !== 'paid' || attendanceChargeableGross == null || !(p > 0 && p < 100)) return null
  return Math.round((num(attendanceChargeableGross) * p) / (100 - p))
}

// Corridas de descuento suelto: meses consecutivos del mismo cliente con el mismo %,
// sin promo. El total de una corrida suma lo descontado en sus meses cobrados.
export function discountRuns(ledger) {
  const months = (ledger || [])
    .filter(r => !r.promoId && num(r.discountPercent) > 0)
    .map(r => ({ ...r, ord: promoOrdinal(r.year, r.month), percent: num(r.discountPercent) }))
    .filter(r => r.ord >= PLATFORM_START_ORD)
    .sort((a, b) => (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : a.ord - b.ord))

  const runs = []
  for (const m of months) {
    const last = runs[runs.length - 1]
    if (last && last.clientId === m.clientId && last.endOrd === m.ord - 1 && last.percent === m.percent) {
      last.endOrd = m.ord
      last.ledger.push(m)
    } else {
      runs.push({ clientId: m.clientId, percent: m.percent, startOrd: m.ord, endOrd: m.ord, ledger: [m] })
    }
  }

  return runs.map(({ ledger: runMonths, ...run }) => {
    const discounts = runMonths.map(paidMonthDiscount)
    return {
      ...run,
      id: `${run.clientId}:${run.startOrd}`,
      kind: 'discount',
      discountTotal: discounts.reduce((s, d) => s + (d ?? 0), 0),
      discountTotalMissing: discounts.filter(d => d == null).length
    }
  })
}

const withRange = a => {
  const start = ymOfOrdinal(a.startOrd)
  const end = ymOfOrdinal(a.endOrd)
  return {
    ...a,
    startYear: start.year,
    startMonth: start.month,
    endYear: end.year,
    endMonth: end.month,
    months: a.endOrd - a.startOrd + 1
  }
}

// Todos los acuerdos (promos y corridas), con el nombre del cliente, el acuerdo que
// lo sigue sin corte (next) y el último mes de la cadena de beneficio (benefitEndOrd).
export function buildAgreements({ promotions, ledger, clients }) {
  const clientById = new Map((clients || []).map(c => [c.id, c]))
  const promos = (promotions || []).map(p => ({
    id: p.id,
    kind: 'promo',
    clientId: p.clientId,
    percent: num(p.discountPercent),
    startOrd: promoOrdinal(p.startYear, p.startMonth),
    endOrd: promoOrdinal(p.endYear, p.endMonth),
    totalAmount: num(p.totalAmount),
    // Lo que entró si ya se cobró (puede diferir del pactado); si no, el pactado.
    packageAmount: promoPackageAmount(p),
    collected: !!p.paidDate,
    paidDate: p.paidDate || null,
    paidAmount: p.paidAmount ?? null,
    // El descuento pactado del paquete (la asistencia de los N meses), guardado al crearla.
    discountTotal: num(p.discountAmount),
    discountTotalMissing: 0,
    promoName: { firstName: p.firstName, lastName: p.lastName }
  }))
  const all = [...promos, ...discountRuns(ledger)].map(withRange)

  const benefitMonths = new Map()
  for (const a of all) {
    const set = benefitMonths.get(a.clientId) || new Set()
    for (let o = a.startOrd; o <= a.endOrd; o++) set.add(o)
    benefitMonths.set(a.clientId, set)
  }
  const byStart = new Map(all.map(a => [`${a.clientId}|${a.startOrd}`, a]))

  return all.map(({ promoName, ...a }) => {
    const months = benefitMonths.get(a.clientId)
    let benefitEndOrd = a.endOrd
    while (months.has(benefitEndOrd + 1)) benefitEndOrd++
    const next = byStart.get(`${a.clientId}|${a.endOrd + 1}`)
    const client = clientById.get(a.clientId)
    return {
      ...a,
      firstName: client?.firstName || promoName?.firstName || '',
      lastName: client?.lastName || promoName?.lastName || '',
      avatarUrl: client?.avatarUrl || null,
      benefitEndOrd,
      next: next ? { kind: next.kind, id: next.id, percent: next.percent, months: next.months } : null
    }
  })
}

// Precio de lista de la asistencia del mes: lo que cobra calculate_month_billing por
// los mismos días sin el descuento (días cobrables sobre el mes pactado, 4 por cada
// vez por semana, por la tarifa vigente del plan del mes).
export function listAttendance(billing) {
  const daysPerMonth = num(billing?.daysPerMonth)
  if (daysPerMonth <= 0) return null
  return Math.round((num(billing.chargeableDays) / daysPerMonth) * num(billing.attendanceMonthlyRateGross))
}

// Lo que un mes deja de cobrar por su descuento: lista − asistencia cobrable con el
// descuento. Sin el cálculo del mes, la lista se reconstruye de lo cobrable
// (cobrable ÷ (1 − p)), salvo al 100%, donde lo cobrable es 0 y no alcanza.
export function monthDiscountOf({ attendanceGross, percent }, billing) {
  const list = listAttendance(billing)
  if (list != null) {
    const charged = num(billing.attendanceChargeableGross)
    return { list, charged, discount: list - charged, estimated: false }
  }
  const p = num(percent)
  if (!(p > 0 && p < 100)) return null
  const charged = num(attendanceGross)
  const rebuilt = Math.round(charged / (1 - p / 100))
  return { list: rebuilt, charged, discount: rebuilt - charged, estimated: true }
}

const benefitKind = row => (row.promoId ? 'promo' : num(row.discountPercent) > 0 ? 'discount' : null)
const benefitPercent = row => (row.promoId ? num(row.promoPercent) : num(row.discountPercent))
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0)
const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : null)
const durationLabel = n => (n === 1 ? 'Promo de 1 mes' : `Promo de ${n} meses`)

// Cobertura del mes de hace seis meses, con la población que cobraba ese mes.
function previousCoverage(pastBase, ledger, ord) {
  const pastOrd = ord - 6
  if (!pastBase || promoOrdinal(pastBase.year, pastBase.month) !== pastOrd) return null
  const ids = pastBase.clientIds || []
  if (!ids.length) return null
  const covered = new Set((ledger || [])
    .filter(r => promoOrdinal(r.year, r.month) === pastOrd && (r.promoId || num(r.discountPercent) > 0))
    .map(r => r.clientId))
  const withBenefit = ids.filter(id => covered.has(id)).length
  return { year: pastBase.year, month: pastBase.month, base: ids.length, withBenefit, pct: pct(withBenefit, ids.length) }
}

// Un acuerdo que todavía no arrancó y cuyo cliente no va a estar activo ningún día de
// su rango (una baja sin reingreso antes de que termine). Dar de baja no borra los
// descuentos ni las promos de los meses futuros (deactivate_client no toca
// monthly_invoices ni promotions), pero esos meses nunca se van a cobrar.
const awayFor = (agreement, client) => isInactiveThroughout(
  monthBounds(agreement.startYear, agreement.startMonth).first,
  monthBounds(agreement.endYear, agreement.endMonth).last,
  inactivityPeriodsOf(client)
)

// El bloque del mes. sources = { padron, promotions, ledger, clients, billing, pastBase }:
//   · padron: las filas de buildPadron del mes (la base).
//   · promotions: getPromotions(); ledger: getBenefitLedger(); clients: nombre, foto y
//     períodos de inactividad de cada cliente (getBenefitClients).
//   · billing: { [clientId]: calculateMonthBilling } de los clientes con beneficio.
//   · pastBase: { year, month, clientIds } del mes −6, o null.
// Devuelve los acuerdos sin el mes (agreements, para el historial), los acuerdos con
// lo del mes (rows) y los KPIs.
export function buildBenefits({ padron, promotions, ledger, clients, billing = {}, pastBase = null }, { year, month }) {
  const ord = promoOrdinal(year, month)
  const base = padron || []
  const rowById = new Map(base.map(r => [r.id, r]))
  const benefitRows = base.filter(benefitKind)
  const promoRows = benefitRows.filter(r => r.promoId)
  const discountRows = benefitRows.filter(r => !r.promoId)
  const discountById = new Map(benefitRows.map(r => [
    r.id,
    monthDiscountOf({ attendanceGross: r.attendanceGross, percent: benefitPercent(r) }, billing[r.id])
  ]))

  const clientById = new Map((clients || []).map(c => [c.id, c]))
  const agreements = buildAgreements({ promotions, ledger, clients })
  const rows = agreements.map(a => {
    const state = agreementState(a, ord)
    const live = state === 'active' || state === 'expiring'
    const row = live ? rowById.get(a.clientId) : null
    // La fila del padrón es la de este acuerdo: la promo por su id, la corrida por
    // tener descuento suelto ese mes.
    const inPadron = !!row && (a.kind === 'promo' ? row.promoId === a.id : benefitKind(row) === 'discount')
    const discount = inPadron ? discountById.get(a.clientId) : null
    return {
      ...a,
      state,
      inPadron,
      // Lo vigente se mide con el padrón; lo que no arrancó, con los períodos.
      clientAway: state === 'upcoming' && awayFor(a, clientById.get(a.clientId)),
      index: promoMonthIndex(a, year, month),
      // El servicio del mes (asistencia con el descuento + transporte).
      monthAmount: inPadron ? row.amount : null,
      monthList: discount?.list ?? null,
      monthDiscount: discount?.discount ?? null,
      monthDiscountEstimated: !!discount?.estimated
    }
  })

  const live = rows.filter(a => a.inPadron)
  const starting = live.filter(a => a.kind === 'promo' && a.startOrd === ord)
  const collectedPackages = starting.filter(a => a.collected)
  const renewals = live.filter(a => a.state === 'expiring')

  const groups = new Map()
  for (const r of promoRows) groups.set(num(r.promoTotal), (groups.get(num(r.promoTotal)) || 0) + 1)
  const promoGroups = [...groups].sort((a, b) => b[0] - a[0]).map(([months, count]) => ({ months, count }))

  const discountOf = r => discountById.get(r.id)?.discount ?? 0
  const promoDiscount = sum(promoRows, discountOf)
  const looseDiscount = sum(discountRows, discountOf)
  const totalDiscount = promoDiscount + looseDiscount
  const attendanceCharged = sum(base, r => num(r.attendanceGross))
  const without = base.length - benefitRows.length

  return {
    year,
    month,
    ord,
    agreements,
    rows,
    kpis: {
      base: base.length,
      withBenefit: benefitRows.length,
      promoCount: promoRows.length,
      discountCount: discountRows.length,
      without,
      coveragePct: pct(benefitRows.length, base.length),
      promoGroups,
      segments: [
        ...promoGroups.map(g => ({ key: `promo-${g.months}`, kind: 'promo', months: g.months, count: g.count, label: durationLabel(g.months) })),
        { key: 'discount', kind: 'discount', count: discountRows.length, label: 'Otros descuentos' },
        { key: 'none', kind: null, count: without, label: 'Sin beneficio' }
      ],
      previousCoverage: previousCoverage(pastBase, ledger, ord),
      // Descuento devengado del mes: cada mes con beneficio cuenta el suyo (un mes de
      // promo, el de su propio servicio, no el del paquete).
      discount: {
        total: totalDiscount,
        promos: promoDiscount,
        discounts: looseDiscount,
        // Meses con beneficio sin precio de lista (sin cálculo y al 100%): no suman.
        missing: benefitRows.filter(r => discountById.get(r.id) == null).length,
        estimated: benefitRows.filter(r => discountById.get(r.id)?.estimated).length,
        attendanceCharged,
        // La asistencia del padrón a precio de lista: lo cobrable más lo descontado.
        listAttendance: attendanceCharged + totalDiscount,
        sharePct: pct(totalDiscount, attendanceCharged + totalDiscount)
      },
      packages: {
        count: starting.length,
        amount: sum(starting, a => a.packageAmount),
        collectedCount: collectedPackages.length,
        collected: sum(collectedPackages, a => a.packageAmount),
        pendingCount: starting.length - collectedPackages.length,
        pending: sum(starting.filter(a => !a.collected), a => a.packageAmount)
      },
      renewals: {
        count: renewals.length,
        promos: renewals.filter(a => a.kind === 'promo').length,
        discounts: renewals.filter(a => a.kind === 'discount').length,
        // El servicio del mes de esos clientes: lo que queda en juego si no renuevan.
        atStake: sum(renewals, a => num(a.monthAmount))
      },
      counts: {
        current: live.length,
        expiring: renewals.length,
        upcoming: rows.filter(a => a.state === 'upcoming' && !a.clientAway).length
      },
      // Acuerdos vigentes de clientes que no cobran este mes (p. ej. una baja): no
      // entran en la cobertura ni en las tablas del mes.
      offPadron: rows.filter(a => (a.state === 'active' || a.state === 'expiring') && !a.inPadron).length,
      // Acuerdos que no arrancaron de clientes que no van a estar activos en su rango:
      // tampoco entran en Próximos.
      upcomingAway: rows.filter(a => a.clientAway).length
    }
  }
}

// Orden de las tablas del mes: primero lo que hay que renovar, después lo vigente
// (mayor descuento del mes primero) y al final lo que todavía no arrancó (por fecha).
export function sortBenefitRows(rows) {
  return [...rows].sort((a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state])
    || (a.state === 'upcoming' ? a.startOrd - b.startOrd : (b.monthDiscount ?? -1) - (a.monthDiscount ?? -1))
    || byName(a, b))
}

// Las filas de un chip del mes (no del historial), separadas por tabla. Lo vigente
// es solo lo del padrón; lo que todavía no arrancó, salvo el de un cliente que no va
// a estar activo en su rango (clientAway).
export function benefitTables(rows, filterKey) {
  const states = BENEFIT_FILTERS.find(f => f.key === filterKey && f.key !== 'history')?.states || []
  const shown = (rows || []).filter(a => states.includes(a.state) && (a.state === 'upcoming' ? !a.clientAway : a.inPadron))
  return {
    promos: sortBenefitRows(shown.filter(a => a.kind === 'promo')),
    discounts: sortBenefitRows(shown.filter(a => a.kind === 'discount'))
  }
}

// Rango por defecto del historial: los últimos `monthsBack` meses cerrados (todos
// desde el lanzamiento con null), hasta el mes anterior al en curso. null si todavía
// no terminó ningún mes.
export function historyRange(today, monthsBack = 12) {
  const current = ordOfIso(today)
  if (current - 1 < PLATFORM_START_ORD) return null
  const from = monthsBack == null ? PLATFORM_START_ORD : Math.max(PLATFORM_START_ORD, current - monthsBack)
  return { from: ymOfOrdinal(from), to: ymOfOrdinal(current - 1) }
}

// Acuerdos terminados (antes del mes en curso) cuyo último mes cae en el rango, del
// más reciente al más viejo. El descuento de una promo es el pactado del paquete; el
// de una corrida, lo descontado en sus meses cobrados.
export function benefitHistory(agreements, { from, to, today }) {
  const current = ordOfIso(today)
  const lo = promoOrdinal(from.year, from.month)
  const hi = Math.min(promoOrdinal(to.year, to.month), current - 1)
  const rows = (agreements || [])
    .filter(a => a.endOrd >= lo && a.endOrd <= hi)
    .map(a => ({ ...a, state: 'expired' }))
    .sort((a, b) => b.endOrd - a.endOrd || byName(a, b))
  const promos = rows.filter(a => a.kind === 'promo')
  const discounts = rows.filter(a => a.kind === 'discount')
  return {
    promos,
    discounts,
    totals: {
      count: rows.length,
      promos: promos.length,
      discounts: discounts.length,
      promoDiscount: sum(promos, a => a.discountTotal),
      looseDiscount: sum(discounts, a => a.discountTotal),
      discount: sum(rows, a => a.discountTotal),
      // Meses de corridas sin cobrar (o al 100%): su descuento no está en el total.
      missingMonths: sum(rows, a => a.discountTotalMissing)
    }
  }
}
