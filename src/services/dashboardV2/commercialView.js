import {
  buildTimeline, churnWindow, cohortRetention, exitsByReason, flowSeries, monthChurn,
  monthIndexOf, sameMonthSeries, tenureStats
} from './activityTimeline'
import { createValuer, runRateSeries, runRateWindow, sumValues } from './runRate'
import { occupancy, parseShiftCapacity } from './occupancy'

// Pestaña Comercial: arma todo lo de un mes a partir de las lecturas en bloque de
// commercialQueries.js. Lógica pura. month es 0-indexed.
//
// La base de todo es la misma: los activos al cierre del mes (o de hoy, si el mes
// está en curso) de activityTimeline, cada uno con su plan vigente de ese mes. Así
// composición, aporte, ocupación y MRR hablan de las mismas personas.

// Tramos de edad: quinquenios entre los 75 y los 89, con una cola abierta en cada
// punta (a esta edad cinco años cambian bastante el perfil).
export const AGE_RANGES = [
  { key: 'upTo74', label: '74 o menos', from: 0, to: 74 },
  { key: '75to79', label: '75 a 79', from: 75, to: 79 },
  { key: '80to84', label: '80 a 84', from: 80, to: 84 },
  { key: '85to89', label: '85 a 89', from: 85, to: 89 },
  { key: '90plus', label: '90 o más', from: 90, to: Infinity }
]

export const UNKNOWN_SEGMENT = 'unknown'
const UNKNOWN_LABEL = 'Sin dato'

const SCHEDULE_LABELS = { morning: 'Mañana', afternoon: 'Tarde', full_day: 'Día completo' }

// Edad cumplida en un día, con las fechas como texto 'YYYY-MM-DD'.
export function ageOn(birthDate, day) {
  if (!birthDate || !day) return null
  const b = String(birthDate).slice(0, 10)
  const years = Number(day.slice(0, 4)) - Number(b.slice(0, 4))
  if (!Number.isFinite(years)) return null
  return day.slice(5) < b.slice(5) ? years - 1 : years
}

export const ageRangeOf = age => (age == null ? UNKNOWN_SEGMENT : (AGE_RANGES.find(r => age >= r.from && age <= r.to) || AGE_RANGES[0]).key)

// Las dimensiones de los selectores (MetricTabs). Todas son ordinales salvo el
// horario; el orden es el natural de la escala.
export const DIMENSIONS = {
  frequency: {
    label: 'Plan',
    order: [1, 2, 3, 4, 5],
    keyOf: ({ plan }) => plan?.frequency ?? null,
    labelOf: k => `${k}× semana`
  },
  schedule: {
    label: 'Horario',
    order: ['morning', 'afternoon', 'full_day'],
    keyOf: ({ plan }) => plan?.schedule ?? null,
    labelOf: k => SCHEDULE_LABELS[k] || k
  },
  cognitiveLevel: {
    label: 'Tier',
    order: ['A', 'B', 'C', 'D'],
    keyOf: ({ client }) => client?.cognitiveLevel || null,
    labelOf: k => `Tier ${k}`
  },
  age: {
    label: 'Edad',
    order: AGE_RANGES.map(r => r.key),
    keyOf: ({ client }, day) => ageRangeOf(ageOn(client?.birthDate, day)),
    labelOf: k => AGE_RANGES.find(r => r.key === k)?.label || k
  }
}

const segmentKey = (dimension, member, day) => {
  const key = DIMENSIONS[dimension].keyOf(member, day)
  return key == null ? UNKNOWN_SEGMENT : key
}

const segmentLabel = (dimension, key) => (key === UNKNOWN_SEGMENT ? UNKNOWN_LABEL : DIMENSIONS[dimension].labelOf(key))

const naturalOrder = (dimension, key) => {
  const i = DIMENSIONS[dimension].order.indexOf(key)
  return key === UNKNOWN_SEGMENT ? Infinity : i === -1 ? DIMENSIONS[dimension].order.length : i
}

// members: [{ client, plan, value }] (value = runRate.monthlyValue del mes).
function groupMembers(members, dimension, day) {
  const groups = new Map()
  for (const m of members) {
    const key = segmentKey(dimension, m, day)
    const g = groups.get(key) || { key, label: segmentLabel(dimension, key), clients: 0, mrr: 0 }
    g.clients++
    g.mrr += m.value.total
    groups.set(key, g)
  }
  return [...groups.values()]
}

// Composición de la base: cuántos activos hay en cada segmento, en el orden de la
// escala (sin dato al final).
export function composition(members, dimension, day) {
  return groupMembers(members, dimension, day)
    .sort((a, b) => naturalOrder(dimension, a.key) - naturalOrder(dimension, b.key))
    .map(g => ({ key: g.key, label: g.label, value: g.clients }))
}

// Reparte un total entero entre partes sin redondear (resto mayor): los pesos de
// cada parte suman exacto el total.
export function apportion(raw, total) {
  const out = raw.map(Math.floor)
  const n = out.length
  // De mayor a menor resto: los primeros suben un peso; si sobra, bajan los últimos.
  const byRemainder = out.map((_, i) => i).sort((a, b) => (raw[b] - out[b]) - (raw[a] - out[a]))
  let left = total - out.reduce((s, v) => s + v, 0)
  for (let k = 0; left !== 0 && n > 0; k++) {
    const step = Math.sign(left)
    out[step > 0 ? byRemainder[k % n] : byRemainder[n - 1 - (k % n)]] += step
    left -= step
  }
  return out
}

// Aporte a la facturación: el MRR contratado de cada segmento (neto, con descuentos
// y con el transporte), de mayor a menor. pp: participación en el MRR menos
// participación en clientes, en puntos porcentuales. Los segmentos suman exacto el
// MRR del mes (el mismo redondeo que runRate.sumValues).
export function revenueMix(members, dimension, day) {
  const groups = groupMembers(members, dimension, day)
  const totalMrr = groups.reduce((s, g) => s + g.mrr, 0)
  const totalClients = groups.reduce((s, g) => s + g.clients, 0)
  const values = apportion(groups.map(g => g.mrr), sumValues(members.map(m => m.value)).total)
  return groups
    .map((g, i) => {
      const revenuePct = totalMrr > 0 ? (g.mrr / totalMrr) * 100 : null
      const clientsPct = totalClients > 0 ? (g.clients / totalClients) * 100 : null
      return {
        key: g.key,
        label: g.label,
        value: values[i],
        clients: g.clients,
        revenuePct,
        clientsPct,
        pp: revenuePct != null && clientsPct != null ? revenuePct - clientsPct : null
      }
    })
    .sort((a, b) => b.value - a.value || naturalOrder(dimension, a.key) - naturalOrder(dimension, b.key))
}

const change = (current, before) => (before == null || current == null
  ? null
  : { base: before, diff: current - before, pct: before !== 0 ? ((current - before) / before) * 100 : null })

// sources: lo que devuelve commercialQueries.getCommercialSources.
//   → { timeline, runRate, capacity, isDefaultCapacity, indexOf(year, month), month(index) }
// month(index) devuelve todo lo del mes (memorizado); null fuera de la ventana.
export function buildCommercial(sources, { today }) {
  const timeline = buildTimeline(sources, { today })
  const valuer = createValuer(sources)
  const runRate = runRateSeries(timeline, valuer)
  const { capacity, isDefault } = parseShiftCapacity(sources.shiftCapacity)
  const reasons = sources.reasons || []
  const cache = new Map()

  const membersOf = m => m.active.map(({ person }) => {
    const value = valuer(person.id, m.year, m.month)
    return { clientId: person.id, client: person.client, plan: value.plan, value }
  })

  const occupancyOf = (m, cap) => occupancy(
    membersOf(m).map(({ plan, client }) => ({ schedule: plan?.schedule, assignedDays: plan?.assignedDays, tier: client.cognitiveLevel })),
    { year: m.year, month: m.month, capacity: cap }
  )

  // La ocupación del mes con un aforo dado: el guardado (o el de por defecto), o uno
  // que se prueba en pantalla sin guardarlo (simulated).
  const occupancyView = (index, cap, { isDefaultCapacity = false, simulated = false } = {}) => {
    const occ = occupancyOf(timeline.months[index], cap)
    const prev = index > 0 ? occupancyOf(timeline.months[index - 1], cap) : null
    const mrr = runRate[index].closing.total
    return {
      ...occ,
      isDefaultCapacity,
      simulated,
      delta: prev?.pct != null && occ.pct != null ? occ.pct - prev.pct : null,
      // Rendimiento por lugar: el MRR del mes sobre los lugares del mes. Por lugar
      // disponible mide capacidad y precio juntos; por lugar vendido, solo el precio.
      revenuePerSeat: occ.seatsMonth > 0 ? mrr / occ.seatsMonth : null,
      revenuePerSoldSeat: occ.sold > 0 ? mrr / occ.sold : null
    }
  }

  function build(index) {
    const m = timeline.months[index]
    const prev = index > 0 ? timeline.months[index - 1] : null
    const lastYear = index >= 12 ? timeline.months[index - 12] : null
    const rate = runRate[index]
    const members = membersOf(m)
    const dims = Object.keys(DIMENSIONS)

    return {
      year: m.year,
      month: m.month,
      cut: m.cut,
      partial: m.partial,
      counts: m.counts,
      clients: {
        active: m.counts.closing,
        mom: change(m.counts.closing, prev?.counts.closing),
        yoy: change(m.counts.closing, lastYear?.counts.closing)
      },
      churn: {
        month: monthChurn(m),
        window: churnWindow(timeline.months, index, 12)
      },
      mrr: {
        ...rate,
        mom: change(rate.closing.total, index > 0 ? runRate[index - 1].closing.total : null),
        yoy: change(rate.closing.total, lastYear ? runRate[index - 12].closing.total : null),
        window: runRateWindow(runRate, index, 12)
      },
      tenure: tenureStats(timeline, index),
      occupancy: occupancyView(index, capacity, { isDefaultCapacity: isDefault }),
      simulateOccupancy: cap => occupancyView(index, cap, { simulated: true }),
      composition: Object.fromEntries(dims.map(d => [d, composition(members, d, m.cut)])),
      mix: Object.fromEntries(dims.map(d => [d, revenueMix(members, d, m.cut)])),
      flow: flowSeries(timeline.months, index, 12),
      sameMonth: calendarMonth => sameMonthSeries(timeline.months, calendarMonth, index),
      exitsByReason: size => exitsByReason(timeline.months, index, size, reasons),
      cohorts: mode => cohortRetention(timeline, index, mode)
    }
  }

  return {
    timeline,
    runRate,
    capacity,
    isDefaultCapacity: isDefault,
    // El catálogo de motivos de baja (nombre y color), para nombrar el motivo de cada persona
    reasons,
    indexOf: (year, month) => monthIndexOf(timeline, year, month),
    month: index => {
      if (index < 0 || index >= timeline.months.length) return null
      if (!cache.has(index)) cache.set(index, build(index))
      return cache.get(index)
    }
  }
}
