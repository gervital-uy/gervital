import { formatCurrency } from '../../utils/format'
import { parseDateOnly } from '../../utils/date'

// Formato del dashboard v2. Todo lo que muestra un número acepta null/undefined y
// devuelve '—': un dato que todavía no cargó o que no existe no puede verse como 0.

export const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const MONTH_FULL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export const DASH = '—'
// Signo menos tipográfico (U+2212): el guion de Intl se pierde al lado del $.
export const MINUS = '−'

const isNum = v => typeof v === 'number' && Number.isFinite(v)

// month es 0-indexed, como en la base.
export const monthLabelOf = (year, month) => (isNum(year) && MONTH_FULL[month] ? `${MONTH_FULL[month]} ${year}` : DASH)

export const plural = (n, singular, pluralForm) => (isNum(n) ? `${n} ${n === 1 ? singular : pluralForm}` : DASH)

// 12.345 → "12,3"; -0.04 → "0,0" (nunca "−0,0"); -1.5 → "−1,5"
export function formatDecimal(v, decimals = 1) {
  if (!isNum(v)) return DASH
  const digits = Math.abs(v).toFixed(decimals)
  const text = digits.replace('.', ',')
  return v < 0 && Number(digits) !== 0 ? `${MINUS}${text}` : text
}

export const pctText = (v, decimals = 1) => (isNum(v) ? `${formatDecimal(v, decimals)}%` : DASH)

// Pesos con signo visible: -1234 → "−$ 1.234". Redondea antes de decidir el signo
// para no mostrar "−$ 0".
export function money(v) {
  if (!isNum(v)) return DASH
  const rounded = Math.round(v)
  return rounded < 0 ? `${MINUS}${formatCurrency(-rounded)}` : formatCurrency(rounded)
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// 'YYYY-MM-DD' → "miércoles 30 de septiembre de 2026". Sin Intl: es-UY dice
// "setiembre" y el resto de la app (date-fns es) "septiembre".
export function formatLongDate(iso) {
  const date = parseDateOnly(iso)
  if (!date) return DASH
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} de ${MONTH_FULL[date.getMonth()]} de ${date.getFullYear()}`
}

// 'YYYY-MM-DD' → "30 sep 2026"
export function formatShortDate(iso) {
  const date = parseDateOnly(iso)
  if (!date) return DASH
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`
}
