import { DIMENSIONS } from '../../../../services/dashboardV2/commercialView'
import { PLATFORM_START_ISO } from '../../../../services/dashboardV2/platform'
import { MINUS, MONTH_SHORT, monthLabelOf } from '../../format'

// Rótulos y textos chicos de la pestaña Comercial.

export const CARD = 'rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]'

// Los selectores de dimensión (Plan, Horario, Tier, Edad), en el orden del modelo.
export const DIMENSION_TABS = Object.entries(DIMENSIONS).map(([value, d]) => ({ value, label: d.label }))

// El mes del lanzamiento, dicho en palabras: "junio 2026".
export const LAUNCH_LABEL = monthLabelOf(Number(PLATFORM_START_ISO.slice(0, 4)), Number(PLATFORM_START_ISO.slice(5, 7)) - 1)

export const shortMonth = (year, month) => `${MONTH_SHORT[month]} ${String(year).slice(2)}`

// Clave de un período de cohorte → rótulo: '2026-09' → "sep 26", '2026-T3' → "T3 26".
export function periodLabel(key) {
  const text = String(key || '')
  const quarter = text.match(/^(\d{4})-T(\d)$/)
  if (quarter) return `T${quarter[2]} ${quarter[1].slice(2)}`
  const month = text.match(/^(\d{4})-(\d{2})$/)
  return month ? shortMonth(Number(month[1]), Number(month[2]) - 1) : text
}

// Cuántos de los meses pedidos existen: "4 con datos". null con el rango completo,
// así la nota desaparece sola el mes en que la historia alcanza.
export const coverage = (actual, requested) => (actual >= requested ? null : `${actual} con ${actual === 1 ? 'dato' : 'datos'}`)

// Una cantidad con signo: +3, −2, 0.
export const signed = n => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${-n}` : '0')

export const monthsText = n => `${n} ${n === 1 ? 'mes' : 'meses'}`
