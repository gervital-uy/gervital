import { endOfMonth, isWeekend, subDays } from 'date-fns'

// Último día hábil del mes (lun-vie). month is 0-indexed.
export function lastBusinessDayOfMonth(year, month) {
  let d = endOfMonth(new Date(year, month, 1))
  while (isWeekend(d)) d = subDays(d, 1)
  return d
}

/**
 * Parsea una fecha sin hora ('YYYY-MM-DD') como medianoche **local**.
 *
 * `new Date('2026-06-24')` la interpreta como medianoche UTC, que en GMT-3 es
 * el 23 a las 21:00: cualquier lectura local posterior (`format`, `getDate`,
 * `differenceInCalendarDays`) devuelve el día anterior. Ese es el bug que hacía
 * que el modal dijera "23 de junio" al clickear el 24.
 *
 * Medianoche y no mediodía a propósito: el resultado se compara contra días de
 * calendario construidos a medianoche (ver el cálculo de facturación en
 * ClientDetail), y mediodía dejaría el primer día del cliente fuera del rango.
 *
 * Un string CON hora (un timestamptz de la DB, p. ej. '2026-09-05T00:25:47+00:00')
 * sí representa un instante real, así que se parsea como instante: recortarlo a 10
 * caracteres daría el día UTC, que es justamente el error que queremos evitar.
 *
 * @param {string|Date|null|undefined} value - 'YYYY-MM-DD', o un ISO completo
 * @returns {Date|null} null si el valor está vacío o no es parseable
 */
export function parseDateOnly(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const str = String(value)
  if (str.length > 10) {
    const instant = new Date(str)
    return isNaN(instant.getTime()) ? null : instant
  }
  const [y, m, d] = str.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

/**
 * Hoy en formato 'YYYY-MM-DD' según el **reloj local**.
 *
 * `new Date().toISOString().slice(0, 10)` da el día en UTC, que entre las 21:00
 * y la medianoche en GMT-3 ya es mañana.
 *
 * @returns {string}
 */
export function todayStr() {
  return toDateStr(new Date())
}

/**
 * Formatea un Date a 'YYYY-MM-DD' usando sus componentes locales.
 * @param {Date} date
 * @returns {string}
 */
export function toDateStr(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}
