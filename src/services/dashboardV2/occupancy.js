// Ocupación de la capacidad: qué parte de los lugares de cada turno está ocupada.
// Se mide sobre lo CONTRATADO (los días de semana del plan vigente), no sobre la
// asistencia real: la brecha entre las dos es el ausentismo, que es de Asistencia.
// Lógica pura. month es 0-indexed.
//
// Ocupa un lugar todo el que viene, pague o no (los no facturables y los que están a
// prueba también): eso es lo que limita una venta. Vendidos son solo los lugares de
// los clientes que pagan (paying), y sobre ellos se mide el precio del lugar.
//
// Turnos: mañana (AM) y tarde (PM). Un plan de mañana ocupa un lugar AM, uno de
// tarde un lugar PM y uno de día completo uno en cada turno.
//
// Aforo: lugares por turno, el mismo para los dos. Se guarda en app_settings con la
// clave shift_capacity; mientras nadie lo defina se asume DEFAULT_SHIFT_CAPACITY y
// la pantalla lo avisa. Los días hábiles son lunes a viernes: no hay calendario de
// feriados. El rango es el que el gráfico de un cuadrito por lugar puede dibujar.

export const SHIFT_CAPACITY_KEY = 'shift_capacity'
export const DEFAULT_SHIFT_CAPACITY = 30
export const SHIFT_CAPACITY_RANGE = { min: 5, max: 60 }

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
export const WEEKDAY_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']
export const SHIFTS = [
  { key: 'am', label: 'Mañana', schedules: ['morning', 'full_day'] },
  { key: 'pm', label: 'Tarde', schedules: ['afternoon', 'full_day'] }
]
const TIERS = ['A', 'B', 'C', 'D']

// Un aforo válido: entero dentro del rango. Cualquier otra cosa (nada guardado, un
// texto, un valor fuera de rango) usa el de por defecto y lo marca.
export function isValidShiftCapacity(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= SHIFT_CAPACITY_RANGE.min && n <= SHIFT_CAPACITY_RANGE.max
}

export function parseShiftCapacity(value) {
  if (value != null && String(value).trim() !== '' && isValidShiftCapacity(String(value).trim())) {
    return { capacity: Number(String(value).trim()), isDefault: false }
  }
  return { capacity: DEFAULT_SHIFT_CAPACITY, isDefault: true }
}

// Cuántas veces cae cada día hábil (lunes a viernes) en el mes.
export function weekdayCounts(year, month) {
  const counts = [0, 0, 0, 0, 0]
  const lastDay = new Date(year, month + 1, 0).getDate()
  for (let d = 1; d <= lastDay; d++) {
    const dow = new Date(year, month, d).getDay()
    if (dow >= 1 && dow <= 5) counts[dow - 1]++
  }
  return counts
}

const emptyCell = () => ({ users: 0, paying: 0, tiers: { A: 0, B: 0, C: 0, D: 0, unknown: 0 } })

const pickBy = (cells, score) => cells.reduce((best, c) => (score(c) > score(best) ? c : best), cells[0])

// seats: [{ schedule, assignedDays, tier, paying }], uno por cada cliente que ocupa un
// lugar, con su plan del mes. paying: es un cliente que paga (de la cartera).
export function occupancy(seats, { year, month, capacity }) {
  const dates = weekdayCounts(year, month)
  const workdays = dates.reduce((s, n) => s + n, 0)
  const seatsPerShift = capacity * workdays

  const shifts = SHIFTS.map(shift => {
    const grid = WEEKDAYS.map(emptyCell)
    for (const seat of seats || []) {
      if (!shift.schedules.includes(seat.schedule)) continue
      const days = new Set((seat.assignedDays || []).filter(d => WEEKDAYS.includes(d)))
      for (const day of days) {
        const cell = grid[WEEKDAYS.indexOf(day)]
        cell.users++
        if (seat.paying) cell.paying++
        cell.tiers[TIERS.includes(seat.tier) ? seat.tier : 'unknown']++
      }
    }
    const cells = grid.map((cell, i) => ({
      weekday: WEEKDAYS[i],
      label: WEEKDAY_LABELS[i],
      dates: dates[i],
      users: cell.users,
      paying: cell.paying,
      tiers: cell.tiers,
      // Alta dependencia: tiers C y D juntos.
      dependents: cell.tiers.C + cell.tiers.D,
      free: Math.max(0, capacity - cell.users),
      pct: capacity > 0 ? (cell.users / capacity) * 100 : null
    }))
    // Lugares del mes: cada día de semana pesa por las veces que cae. taken: todos
    // los ocupados; sold: los de clientes que pagan.
    const taken = cells.reduce((s, c) => s + c.users * c.dates, 0)
    const sold = cells.reduce((s, c) => s + c.paying * c.dates, 0)
    const perDay = workdays > 0 ? taken / workdays : 0
    return {
      key: shift.key,
      label: shift.label,
      cells,
      taken,
      sold,
      pct: seatsPerShift > 0 ? (taken / seatsPerShift) * 100 : null,
      perDay,
      free: Math.max(0, capacity - perDay),
      // El día con menos lugar es el que decide si entra un cliente más.
      busiest: pickBy(cells, c => c.users),
      quietest: pickBy(cells, c => -c.users),
      mostDependents: pickBy(cells, c => c.dependents),
      // Dónde entra un cliente más con menos carga de alta dependencia.
      mostRoom: pickBy(cells, c => (c.free > 0 ? c.free * 100 - c.dependents : -1))
    }
  })

  const taken = shifts.reduce((s, sh) => s + sh.taken, 0)
  return {
    capacity,
    workdays,
    dates,
    seatsPerShift,
    seatsMonth: seatsPerShift * shifts.length,
    shifts,
    taken,
    sold: shifts.reduce((s, sh) => s + sh.sold, 0),
    pct: seatsPerShift > 0 ? (taken / (seatsPerShift * shifts.length)) * 100 : null
  }
}
