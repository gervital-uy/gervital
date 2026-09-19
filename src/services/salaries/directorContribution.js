/**
 * Aporte jubilatorio de directores: un gasto extraordinario sin empleado que se
 * genera solo, un mes por vez. El monto cubre a los DOS directores (ver
 * DIRECTORS_COUNT en salaryCalc).
 *
 * No hay cron en el proyecto, así que la generación es self-heal: al abrir
 * Costos se crean las filas de los meses que falten entre un mes ancla
 * (app_settings.director_contribution_start, sembrado por la migración 083 con
 * el mes en que se aplicó) y el mes corriente. Abrir Costos después de tres
 * meses crea los tres.
 *
 * Regla central: una fila ya creada NO se toca nunca. El monto de cada mes se
 * congela con el nominal más alto que regía ESE mes, así que subir un sueldo
 * hoy no reescribe la historia. Por eso el módulo solo sabe decir qué meses
 * faltan y con qué monto nacerían; nunca produce updates.
 */
import { lastBusinessDayOfMonth, toDateStr } from '../../utils/date'
import { directorContributionAsOf } from './salaryCalc'

// Identidad de la fila automática (employee_extra_costs.system_key).
export const DIRECTOR_SYSTEM_KEY = 'director_bps'
export const DIRECTOR_CONCEPT = 'Aporte Jubilatorio Directores (en fac BPS)'

/** 'YYYY-MM' → { year, month } con month 0-indexed. */
export function parseMonthKey(key) {
  const [y, m] = String(key || '').split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return null
  return { year: y, month: m - 1 }
}

/** { year, month } (month 0-indexed) → 'YYYY-MM'. */
export function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

/**
 * Meses desde el ancla hasta `current`, ambos inclusive. Vacío si el ancla es
 * posterior (por ejemplo el mes en que se aplicó la migración, mirado desde un
 * mes anterior) o si alguno no parsea.
 * @param {string} startKey - 'YYYY-MM'
 * @param {string} currentKey - 'YYYY-MM'
 * @returns {Array<{year:number, month:number}>}
 */
export function monthsBetween(startKey, currentKey) {
  const start = parseMonthKey(startKey)
  const end = parseMonthKey(currentKey)
  if (!start || !end) return []
  const months = []
  for (
    let i = start.year * 12 + start.month, last = end.year * 12 + end.month;
    i <= last;
    i++
  ) {
    months.push({ year: Math.floor(i / 12), month: i % 12 })
  }
  return months
}

/**
 * Filas a insertar: los meses del rango que todavía no tienen fila del sistema.
 *
 * Se fecha en el último día hábil del mes, que es cuando cae la factura de BPS
 * y lo mismo que usa la facturación para cerrar el mes.
 *
 * Un mes cuyo nominal más alto da 0 (sin empleados activos con sueldo vigente
 * a esa fecha) se saltea: no tiene sentido materializar un gasto de $0, y
 * dejarlo sin fila permite que se cree bien más adelante.
 *
 * @param {object} params
 * @param {string} params.startKey - 'YYYY-MM' ancla
 * @param {string} params.currentKey - 'YYYY-MM' mes corriente
 * @param {Array<{date:string}>} params.existing - filas del sistema ya creadas
 * @param {Array} params.employees
 * @returns {Array<{concept:string, amount:number, date:string, systemKey:string}>}
 */
export function pendingContributions({ startKey, currentKey, existing = [], employees = [] }) {
  const taken = new Set(existing.map(r => String(r.date || '').slice(0, 7)))
  const rows = []
  for (const { year, month } of monthsBetween(startKey, currentKey)) {
    if (taken.has(monthKey(year, month))) continue
    const date = toDateStr(lastBusinessDayOfMonth(year, month))
    const amount = directorContributionAsOf(employees, date)
    if (amount <= 0) continue
    rows.push({ concept: DIRECTOR_CONCEPT, amount, date, systemKey: DIRECTOR_SYSTEM_KEY })
  }
  return rows
}
