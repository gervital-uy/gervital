import { formatCompact } from '../../../../utils/format'
import { DASH, MINUS, MONTH_FULL, MONTH_SHORT, formatDecimal } from '../../format'

// Rótulos y colores de la pestaña Finanzas. Un punto es { year, month } (0-indexed).

// Ingreso en verdes (asistencia clara, transporte oscura), costo en grises (el gasto
// claro, el personal más oscuro) y el resultado en tinta: dos familias que se leen
// de un vistazo, con la posición (barra izquierda o derecha) como segunda marca.
export const COLORS = {
  attendance: '#34d399',
  transport: '#059669',
  operating: '#cbd5e1',
  personal: '#94a3b8',
  result: '#334155',
  income: '#059669',
  costs: '#eb6834',
  positiveArea: 'rgba(16, 185, 129, 0.18)',
  negativeArea: 'rgba(225, 29, 72, 0.16)'
}

// La cascada de márgenes: un solo verde en tres intensidades, porque es el mismo
// ingreso con una capa más de costo, no tres categorías.
export const MARGIN_LINES = [
  {
    key: 'grossPct',
    label: 'Bruto',
    color: '#6ee7b7',
    description: 'Lo que queda después de pagar a quienes prestan el servicio: los sueldos a costo empresa y los prestadores.'
  },
  {
    key: 'operatingPct',
    label: 'Operativo',
    color: '#10b981',
    description: 'Lo que queda después de restar también los gastos fijos (mensualizados), que se pagan esté el centro lleno o vacío.'
  },
  {
    key: 'netPct',
    label: 'Neto',
    color: '#065f46',
    description: 'Lo que queda después de los gastos variables, los extraordinarios, los extras del personal y el aporte jubilatorio de los directores. Antes de IRAE y amortizaciones.'
  }
]

export const shortMonth = ({ year, month }) => `${MONTH_SHORT[month]} ${String(year).slice(2)}`
export const longMonth = ({ year, month }) => `${MONTH_FULL[month]} ${year}`

// El rótulo del eje según axisMode: 'month' → "oct", 'year' → "2026",
// 'monthYear' → "oct 26".
export function axisLabel(point, mode) {
  if (mode === 'year') return String(point.year)
  if (mode === 'monthYear') return shortMonth(point)
  return MONTH_SHORT[point.month]
}

// El nombre de un punto en un globo o un aria-label: "oct 2026", o "2026" si el eje
// es por año.
export const pointLabel = (point, mode) => (mode === 'year' ? String(point.year) : `${MONTH_SHORT[point.month]} ${point.year}`)

// "jun 26 – nov 26"; un solo mes, "jun 26".
export function rangeText(rows) {
  if (!rows?.length) return ''
  const first = rows[0]
  const last = rows[rows.length - 1]
  return rows.length === 1 ? shortMonth(first) : `${shortMonth(first)} – ${shortMonth(last)}`
}

// El período de la bajada del gráfico. En una ventana, el rango y, si la historia no
// alcanza, cuántos meses hay de verdad ("6 de 12 meses con datos"): el rango nombra
// lo pedido y el denominador lo pone la serie. En el filtro, qué quedó.
export function periodCaption(rows, range) {
  if (range != null) {
    const text = rangeText(rows)
    return rows.length < range ? `${text} · ${rows.length} de ${range} meses con datos` : text
  }
  if (!rows.length) return 'sin meses en el filtro'
  const years = [...new Set(rows.map(r => r.year))].sort((a, b) => a - b)
  const months = new Set(rows.map(r => r.month))
  const yearsText = `${years.join(' · ')}`
  if (months.size === 1) {
    return `${MONTH_FULL[rows[0].month]} de ${yearsText} · ${years.length} ${years.length === 1 ? 'año' : 'años'}`
  }
  return `${yearsText} · ${rows.length} ${rows.length === 1 ? 'mes' : 'meses'}`
}

const NBSP = String.fromCharCode(160)

// Pesos abreviados con signo: 1.234.567 → "$ 1,2M"; −12.400 → "−$ 12k".
export function compactMoney(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DASH
  const text = `$${NBSP}${formatCompact(Math.abs(v))}`
  return Math.round(v) < 0 ? `${MINUS}${text}` : text
}

// Una variación en puntos con su signo: "+1,2 pp", "−3,4 pp".
export function ppText(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DASH
  const digits = formatDecimal(Math.abs(v), 1)
  return `${v < 0 && digits !== '0,0' ? MINUS : '+'}${digits} pp`
}

// La variación del resultado contra su comparable, para una etiqueta o una celda:
// porcentaje si la base es positiva y, si no, la diferencia en pesos.
export function changeText(c) {
  if (!c) return null
  const up = c.diff >= 0
  if (c.pct != null) return `${up ? '↑' : '↓'}${formatDecimal(Math.abs(c.pct), 0)}%`
  return `${up ? '+' : MINUS}${compactMoney(Math.abs(c.diff))}`
}
