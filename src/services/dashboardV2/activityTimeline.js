import { differenceInCalendarDays } from 'date-fns'
import { parseDateOnly } from '../../utils/date'
import { churnedDuringTrial } from '../dashboard/commercialStats'
import { monthBounds } from './padron'
import { PLATFORM_START_ISO } from './platform'

// Línea de tiempo comercial: quién está activo cada mes, quién entra y quién se va.
// Lógica pura; las lecturas están en commercialQueries.js. month es 0-indexed y las
// fechas son días 'YYYY-MM-DD' (se comparan como texto).
//
// Reglas (decisión 3 del plan):
//   · La cartera son los clientes regulares. Los que vinieron a prueba y no se
//     quedaron (churnedDuringTrial, la misma regla que /bajas) no son ni alta ni
//     baja: nunca llegaron a pagar una cuota.
//   · Los períodos de client_inactivity_periods son la fuente de verdad (la ficha
//     solo guarda la baja actual). Se depuran: los superpuestos se unen y las
//     reversiones de un día (una baja deshecha enseguida) se descartan.
//   · Cada reingreso cuenta como alta. La pausa temporal (churn_followups.stage) es
//     una etiqueta de la baja, no cambia las cuentas.
//   · Los heredados (cargados con la fecha de lanzamiento) son la base inicial: no
//     son alta.
//   · Lo que todavía no pasó no cuenta: el mes en curso se corta en hoy, así que una
//     baja o un reingreso programados entran recién el día que ocurren.
//
// Con esas reglas, en cada mes: base inicial + altas − bajas = activos al cierre.

export const PAUSE_STAGE = 'temporary_pause'
export const ENTRY_INHERITED = 'inherited'
export const ENTRY_NEW = 'new'
export const ENTRY_RETURN = 'return'

// Un mes promedio (365,25 / 12), para pasar días a meses.
export const AVG_MONTH_DAYS = 30.4375

const isoDay = v => (v ? String(v).slice(0, 10) : null)
const daysBetween = (from, to) => differenceInCalendarDays(parseDateOnly(to), parseDateOnly(from))
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0)

export function shiftMonth(year, month, delta) {
  const total = year * 12 + month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

// Los meses desde el lanzamiento hasta el mes de hoy, inclusive.
export function monthRange(today, fromIso = PLATFORM_START_ISO) {
  const start = { year: Number(fromIso.slice(0, 4)), month: Number(fromIso.slice(5, 7)) - 1 }
  const end = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }
  const out = []
  for (let ym = start.year * 12 + start.month; ym <= end.year * 12 + end.month; ym++) {
    out.push({ year: Math.floor(ym / 12), month: ym % 12 })
  }
  return out
}

export const isCommercialClient = c => c?.clientType === 'regular' && !churnedDuringTrial(c)

// Fin de un período para ordenar: abierto (null) es el más lejano.
const compareEnd = (a, b) => (a === b ? 0 : a == null ? 1 : b == null ? -1 : a.localeCompare(b))

// Los períodos de un cliente depurados, ordenados y sin superponerse. Un período es
// [fromDate, toDate): toDate es el primer día activo de nuevo (null = abierto).
// Dos que se tocan se unen (no hay un día activo entre ellos). El motivo de la baja
// unida es el del período que la abre (a igual inicio, el que más dura).
export function cleanPeriods(periods) {
  const kept = (periods || [])
    .map(p => ({ fromDate: isoDay(p?.fromDate), toDate: isoDay(p?.toDate), reason: p?.reason || null }))
    .filter(p => p.fromDate && !(p.toDate && daysBetween(p.fromDate, p.toDate) <= 1))
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate) || compareEnd(b.toDate, a.toDate))
  const merged = []
  for (const p of kept) {
    const last = merged[merged.length - 1]
    if (last && (last.toDate == null || p.fromDate <= last.toDate)) {
      if (compareEnd(p.toDate, last.toDate) > 0) last.toDate = p.toDate
      continue
    }
    merged.push({ ...p })
  }
  return merged
}

// Los tramos activos de un cliente: [from, to), con cómo entró y cómo salió.
//   entry: 'inherited' (estaba al lanzar), 'new' (primera alta) o 'return' (reingreso)
//   exit:  null si sigue activo, o { date, reason, pause } con date = to (el primer
//          día inactivo). pause: el seguimiento de esa baja está en "pausa temporal".
// pauseDates: las fechas de baja de sus seguimientos en pausa temporal; churn_followups
// guarda uno por cliente, así que se asigna a la baja que contiene esa fecha.
export function clientStretches(client, periods, pauseDates = []) {
  const start = isoDay(client?.startDate)
  if (!start) return []
  const out = []
  let from = start
  const push = (to, exit) => out.push({
    from,
    to,
    entry: out.length ? ENTRY_RETURN : from === start && start <= PLATFORM_START_ISO ? ENTRY_INHERITED : ENTRY_NEW,
    exit
  })
  for (const p of cleanPeriods(periods)) {
    if (p.toDate != null && p.toDate <= from) continue
    if (p.fromDate > from) {
      const pause = pauseDates.some(d => d >= p.fromDate && (p.toDate == null || d < p.toDate))
      push(p.fromDate, { date: p.fromDate, reason: p.reason || 'other', pause })
    }
    if (p.toDate == null) return out
    from = p.toDate
  }
  push(null, null)
  return out
}

const isActiveOn = (stretch, day) => stretch.from <= day && (stretch.to == null || stretch.to > day)

// Un mes de la línea de tiempo. Las listas son de { person, stretch }:
//   opening:   la base inicial (activos al cierre del mes anterior, más los
//              heredados en el mes del lanzamiento)
//   entries:   altas del mes (primeras altas y reingresos)
//   exits:     bajas del mes
//   active:    activos al cierre (hoy, si el mes está en curso)
export function monthActivity(people, year, month, today) {
  const { first, last } = monthBounds(year, month)
  const cut = today && today < last ? today : last
  const prev = shiftMonth(year, month, -1)
  const prevLast = monthBounds(prev.year, prev.month).last
  const refs = people.flatMap(person => person.stretches.map(stretch => ({ person, stretch })))
  const within = day => day != null && day >= first && day <= cut

  const entered = refs.filter(r => within(r.stretch.from))
  const inherited = entered.filter(r => r.stretch.entry === ENTRY_INHERITED)
  const entries = entered.filter(r => r.stretch.entry !== ENTRY_INHERITED)
  const exits = refs.filter(r => within(r.stretch.to))
  const opening = [...refs.filter(r => isActiveOn(r.stretch, prevLast)), ...inherited]
  const active = refs.filter(r => isActiveOn(r.stretch, cut))

  return {
    year,
    month,
    first,
    last,
    cut,
    partial: cut < last,
    opening,
    inherited,
    entries,
    exits,
    active,
    counts: {
      opening: opening.length,
      inherited: inherited.length,
      altas: entries.length,
      newAltas: entries.filter(r => r.stretch.entry === ENTRY_NEW).length,
      returns: entries.filter(r => r.stretch.entry === ENTRY_RETURN).length,
      bajas: exits.length,
      pauses: exits.filter(r => r.stretch.exit.pause).length,
      closing: active.length
    }
  }
}

// La línea de tiempo entera, del lanzamiento al mes de hoy.
// sources: { clients (clients_full), periods, followups }
export function buildTimeline({ clients, periods, followups }, { today }) {
  const periodsBy = new Map()
  for (const p of periods || []) {
    if (!periodsBy.has(p.clientId)) periodsBy.set(p.clientId, [])
    periodsBy.get(p.clientId).push(p)
  }
  const pausesBy = new Map()
  for (const f of followups || []) {
    if (f.stage !== PAUSE_STAGE || !f.deactivationDate) continue
    if (!pausesBy.has(f.clientId)) pausesBy.set(f.clientId, [])
    pausesBy.get(f.clientId).push(isoDay(f.deactivationDate))
  }
  const people = (clients || []).filter(isCommercialClient).map(client => ({
    id: client.id,
    client,
    stretches: clientStretches(client, periodsBy.get(client.id), pausesBy.get(client.id))
  }))
  const months = monthRange(today).map(({ year, month }) => monthActivity(people, year, month, today))
  return { people, months, today }
}

export const monthIndexOf = (timeline, year, month) => timeline.months.findIndex(m => m.year === year && m.month === month)

// Churn de una ventana de hasta `size` meses que cierra en el mes `index`, recortada
// a los meses que la plataforma lleva operando: bajas de la ventana sobre la cartera
// media (los activos al cierre de cada mes). La ventana anterior, del mismo largo,
// solo existe cuando entra entera desde el lanzamiento.
export function churnWindow(months, index, size = 12) {
  const span = Math.min(size, index + 1)
  const stat = list => {
    const bajas = sum(list, m => m.counts.bajas)
    const baseMedia = list.length ? sum(list, m => m.counts.closing) / list.length : 0
    return { bajas, baseMedia, churn: baseMedia > 0 ? (bajas / baseMedia) * 100 : null }
  }
  const current = stat(months.slice(index - span + 1, index + 1))
  const prevStart = index - 2 * span + 1
  const prev = prevStart >= 0 ? stat(months.slice(prevStart, index - span + 1)) : null
  return {
    months: span,
    ...current,
    avgBajas: current.bajas / span,
    prev,
    delta: prev?.churn != null && current.churn != null ? current.churn - prev.churn : null
  }
}

// Churn del mes: bajas sobre la base inicial.
export const monthChurn = m => (m.counts.opening > 0 ? (m.counts.bajas / m.counts.opening) * 100 : null)

// Permanencia al cierre del mes: desde la última alta de cada activo (un reingreso
// es un alta nueva). Los heredados no tienen alta registrada: no se les inventa
// antigüedad, se cuentan aparte. closed: la vida de los tramos que ya terminaron
// (hasta el cierre del mes) y cuya alta registró la plataforma.
export function tenureStats(timeline, index) {
  const m = timeline.months[index]
  const measured = m.active.filter(r => r.stretch.entry !== ENTRY_INHERITED)
  const tenureDays = measured.map(r => daysBetween(r.stretch.from, m.cut) + 1)
  const closed = timeline.people.flatMap(p => p.stretches)
    .filter(s => s.exit && s.exit.date <= m.cut && s.entry !== ENTRY_INHERITED)
  const lifeDays = closed.map(s => daysBetween(s.from, s.exit.date))
  const avg = list => (list.length ? sum(list, d => d) / list.length / AVG_MONTH_DAYS : null)
  return {
    avgMonths: avg(tenureDays),
    measured: measured.length,
    inherited: m.active.length - measured.length,
    closedAvgMonths: avg(lifeDays),
    closedMeasured: closed.length
  }
}

const flowRow = m => ({
  year: m.year,
  month: m.month,
  partial: m.partial,
  altas: m.counts.altas,
  newAltas: m.counts.newAltas,
  returns: m.counts.returns,
  bajas: m.counts.bajas,
  pauses: m.counts.pauses,
  net: m.counts.altas - m.counts.bajas,
  closing: m.counts.closing
})

// Altas contra bajas de los últimos `size` meses (los que haya desde el lanzamiento).
export const flowSeries = (months, index, size = 12) => months.slice(Math.max(0, index - size + 1), index + 1).map(flowRow)

// El mismo mes calendario en cada año con el centro operando, hasta el mes `index`.
export const sameMonthSeries = (months, calendarMonth, index) => months
  .slice(0, index + 1)
  .filter(m => m.month === calendarMonth && m.counts.closing > 0)
  .map(flowRow)

// Bajas por motivo en una ventana de `size` meses que cierra en `index` (null = toda
// la historia), con los nombres y colores de deactivation_reasons. prev: la ventana
// anterior del mismo largo, solo si entra entera desde el lanzamiento.
export function exitsByReason(months, index, size, reasons = []) {
  const meta = new Map((reasons || []).map(r => [r.key, r]))
  const count = list => {
    const rows = new Map()
    for (const m of list) {
      for (const { stretch } of m.exits) {
        const key = stretch.exit.reason || 'other'
        const info = meta.get(key)
        const row = rows.get(key) || { key, label: info?.label || key, color: info?.color || null, sortOrder: info?.sortOrder ?? Infinity, value: 0, pauses: 0 }
        row.value++
        if (stretch.exit.pause) row.pauses++
        rows.set(key, row)
      }
    }
    return [...rows.values()].sort((a, b) => b.value - a.value || a.sortOrder - b.sortOrder)
  }
  const span = size == null ? index + 1 : Math.min(size, index + 1)
  const rows = count(months.slice(index - span + 1, index + 1))
  const prevStart = size == null ? -1 : index - 2 * size + 1
  return {
    months: span,
    requested: size,
    rows,
    total: sum(rows, r => r.value),
    pauses: sum(rows, r => r.pauses),
    prev: prevStart >= 0 ? count(months.slice(prevStart, index - size + 1)) : null
  }
}

// Retención por cohortes. Una cohorte son las altas (primeras y reingresos) de un
// mismo mes o trimestre calendario; la celda k es cuántas siguen activas al cierre
// del período k contado desde el de la cohorte. Se sigue cada tramo, no a la
// persona: quien se va y reingresa queda como baja en su cohorte original y abre un
// registro en la del reingreso. Así, los vivos de todas las cohortes más los
// heredados activos son exactamente los activos al cierre.
export const COHORT_MODES = {
  month: { cohorts: 12, steps: 12 },
  quarter: { cohorts: 8, steps: 8 }
}

export function cohortRetention(timeline, index, mode = 'month') {
  const cfg = COHORT_MODES[mode] || COHORT_MODES.month
  const periods = []
  timeline.months.slice(0, index + 1).forEach(m => {
    const quarter = Math.floor(m.month / 3) + 1
    const key = mode === 'quarter' ? `${m.year}-T${quarter}` : `${m.year}-${String(m.month + 1).padStart(2, '0')}`
    let p = periods[periods.length - 1]
    if (!p || p.key !== key) {
      p = { key, year: m.year, month: m.month, quarter, cut: m.cut, members: [] }
      periods.push(p)
    }
    p.cut = m.cut
    p.members.push(...m.entries)
  })

  const visible = periods.slice(-cfg.cohorts)
  const offset = periods.length - visible.length
  const rows = visible.map((p, row) => {
    const n = p.members.length
    const targets = periods.slice(offset + row, offset + row + cfg.steps)
    const cells = []
    targets.forEach((target, k) => {
      const active = p.members.filter(r => isActiveOn(r.stretch, target.cut)).length
      const before = k > 0 ? cells[k - 1].active : n
      cells.push({ k, period: target.key, active, pct: n > 0 ? (active / n) * 100 : null, lostInStep: before - active, lostTotal: n - active })
    })
    const members = p.members.map(({ person, stretch }) => {
      const step = stretch.to == null ? -1 : targets.findIndex(t => stretch.to <= t.cut)
      return {
        clientId: person.id,
        firstName: person.client.firstName || '',
        lastName: person.client.lastName || '',
        entry: stretch.entry,
        exitStep: step >= 0 ? step : null,
        exitDate: step >= 0 ? stretch.exit.date : null,
        reason: step >= 0 ? stretch.exit.reason : null
      }
    })
    return { key: p.key, year: p.year, month: p.month, quarter: p.quarter, size: n, cells, members }
  })

  // Curva combinada: por paso, los vivos sobre los que entraron, solo con las
  // cohortes que ya llegaron a ese paso. Con cohortes de dos o tres personas es la
  // única lectura con algo de peso.
  const average = []
  for (let k = 0; k < cfg.steps; k++) {
    const reached = rows.filter(r => r.size > 0 && r.cells[k])
    if (!reached.length) continue
    const active = sum(reached, r => r.cells[k].active)
    const base = sum(reached, r => r.size)
    average.push({ k, active, base, cohorts: reached.length, pct: (active / base) * 100 })
  }

  return {
    mode: COHORT_MODES[mode] ? mode : 'month',
    steps: cfg.steps,
    rows,
    average,
    entries: sum(rows, r => r.size),
    emptyCohorts: rows.filter(r => r.size === 0).length
  }
}
