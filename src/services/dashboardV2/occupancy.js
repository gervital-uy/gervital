// Ocupación de la capacidad: qué parte de los lugares de cada turno está vendida.
// Se mide sobre lo CONTRATADO (los días de semana del plan vigente), no sobre la
// asistencia real: la brecha entre las dos es el ausentismo, que es de Asistencia.
// Lógica pura. month es 0-indexed.
//
// Turnos: mañana (AM) y tarde (PM). Un plan de mañana ocupa un lugar AM, uno de
// tarde un lugar PM y uno de día completo uno en cada turno.
//
// Aforo: lugares por turno, el mismo para los dos. Se guarda en app_settings con la
// clave shift_capacity; mientras nadie lo defina se asume DEFAULT_SHIFT_CAPACITY y
// la pantalla lo avisa. Los días hábiles son lunes a viernes: no hay calendario de
// feriados.

export const SHIFT_CAPACITY_KEY = 'shift_capacity'
export const DEFAULT_SHIFT_CAPACITY = 30
export const SHIFT_CAPACITY_RANGE = { min: 1, max: 200 }

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

const emptyCell = () => ({ users: 0, tiers: { A: 0, B: 0, C: 0, D: 0, unknown: 0 } })

const pickBy = (cells, score) => cells.reduce((best, c) => (score(c) > score(best) ? c : best), cells[0])

// seats: [{ schedule, assignedDays, tier }], uno por cliente activo con su plan del mes.
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
        cell.tiers[TIERS.includes(seat.tier) ? seat.tier : 'unknown']++
      }
    }
    const cells = grid.map((cell, i) => ({
      weekday: WEEKDAYS[i],
      label: WEEKDAY_LABELS[i],
      dates: dates[i],
      users: cell.users,
      tiers: cell.tiers,
      // Alta dependencia: tiers C y D juntos.
      dependents: cell.tiers.C + cell.tiers.D,
      free: Math.max(0, capacity - cell.users),
      pct: capacity > 0 ? (cell.users / capacity) * 100 : null
    }))
    // Lugares vendidos en el mes: cada día de semana pesa por las veces que cae.
    const sold = cells.reduce((s, c) => s + c.users * c.dates, 0)
    const perDay = workdays > 0 ? sold / workdays : 0
    return {
      key: shift.key,
      label: shift.label,
      cells,
      sold,
      pct: seatsPerShift > 0 ? (sold / seatsPerShift) * 100 : null,
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

  const sold = shifts.reduce((s, sh) => s + sh.sold, 0)
  return {
    capacity,
    workdays,
    dates,
    seatsPerShift,
    seatsMonth: seatsPerShift * shifts.length,
    shifts,
    sold,
    pct: seatsPerShift > 0 ? (sold / (seatsPerShift * shifts.length)) * 100 : null
  }
}
