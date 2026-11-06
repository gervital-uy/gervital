import { change, expensesOf, findMonthIndex, incomeOf, marginKpisV2, operatingOf, personalOf } from './financeSeriesV2'

// Lo que muestran el gráfico principal y la fila de KPIs de Finanzas, sobre la serie
// de financeSeriesV2. Lógica pura; los textos los arma la UI. month es 0-indexed.
//
// La pestaña mide siempre sin IVA (el IVA se cobra para la DGI, no es ingreso) y
// sobre "A ingresar al banco": lo que el mes tiene que cobrar, con el paquete de una
// promo entero en su mes ancla y $0 en los meses que cubre, igual que Cobranza.

// KPIs, Tendencia y Márgenes: los fijos mensualizados (un pago anual pesa un doceavo
// por mes). La vista Pesos los pone en el mes en que se pagan.
export const KPI_OPTIONS = { basis: 'bank', withIva: false, fixedBasis: 'monthly' }

export const RANGES = [6, 12, 24]
export const DEFAULT_RANGE = 12
export const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => i)

// ── Período ───────────────────────────────────────────────────────────────────
// Dos formas de recortar la serie, y las tres vistas parten de las mismas filas:
//   · { mode: 'window', range }: los `range` meses seguidos que terminan en el mes
//     elegido (con menos historia, los que hay);
//   · { mode: 'filter', years, months }: el cruce de años por meses (un año entero,
//     un mes contra los años anteriores, un trimestre entre ejercicios).
export function periodRows(series, { year, month }, period) {
  const list = series || []
  if (period?.mode === 'filter') {
    return list.filter(r => (period.years || []).includes(r.year) && (period.months || []).includes(r.month))
  }
  const idx = findMonthIndex(list, year, month)
  if (idx < 0) return []
  const size = period?.range || DEFAULT_RANGE
  return list.slice(Math.max(0, idx - (size - 1)), idx + 1)
}

export const availableYears = series => [...new Set((series || []).map(r => r.year))].sort((a, b) => a - b)

// Interanual necesita el mismo mes de un año anterior: con la serie arrancando en
// junio de 2026, recién existe desde junio de 2027.
export const hasSameMonthBefore = (series, year, month) => (series || []).some(r => r.month === month && r.year < year)

// El comparable de un punto dentro de lo que se ve: su mismo mes del año anterior
// más cercano. Contra el punto de al lado sería otro mes, y en un negocio estacional
// eso hace pasar la estación por gestión.
export function sameMonthBefore(points, point) {
  let best = null
  for (const p of points || []) {
    if (p.month !== point.month || p.year >= point.year) continue
    if (!best || p.year > best.year) best = p
  }
  return best
}

// Cómo rotular el eje: por mes (una ventana o un solo año), por año (un mismo mes en
// varios años) o por mes y año (varios meses de varios años). Se decide con las filas
// que quedaron, no con lo tildado: un año sin ese mes cargado no cuenta.
export function axisMode(rows, isWindow) {
  if (isWindow) return 'month'
  const years = new Set((rows || []).map(r => r.year))
  const months = new Set((rows || []).map(r => r.month))
  if (months.size === 1 && years.size > 1) return 'year'
  return years.size > 1 ? 'monthYear' : 'month'
}

// ── Puntos de cada vista ──────────────────────────────────────────────────────

// Pesos: el ingreso por línea, el personal, el resto del gasto con los fijos en su
// mes de pago, y el resultado de ese mes en esa misma base.
export function moneyPoint(row) {
  const attendance = incomeOf(row, { basis: 'bank', line: 'attendance' })
  const transport = incomeOf(row, { basis: 'bank', line: 'transport' })
  const personal = personalOf(row).total
  const operating = operatingOf(row, { fixedBasis: 'cash' })
  const income = attendance + transport
  return {
    year: row.year,
    month: row.month,
    attendance,
    transport,
    income,
    personal,
    operating: operating.total,
    fixed: operating.fixed,
    variable: operating.variable,
    extraordinary: operating.extraordinary,
    result: income - personal - operating.total
  }
}

// Tendencia: lo que tiene que entrar contra lo que cuesta operar, con los fijos
// mensualizados. El costo es el Total gastos del KPI, peso por peso.
export function trendPoint(row) {
  const income = incomeOf(row, KPI_OPTIONS)
  const costs = expensesOf(row, KPI_OPTIONS)
  const result = income - costs
  return { year: row.year, month: row.month, income, costs, result, netPct: income > 0 ? (result / income) * 100 : null }
}

// Márgenes: la cascada bruto / operativo / neto. Un mes sin ingreso no tiene margen
// y no se dibuja.
export const marginPoints = rows => (rows || []).map(r => marginKpisV2(r, { basis: 'bank' })).filter(Boolean)

// La tabla de períodos: el más reciente arriba, cada uno contra su mismo mes del año
// anterior (con una base de resultado cero o negativa, solo la diferencia).
export function periodTable(points) {
  return [...(points || [])]
    .sort((a, b) => b.year - a.year || b.month - a.month)
    .map(p => {
      const comp = sameMonthBefore(points, p)
      return { ...p, comp, change: comp ? change(p.result, comp.result) : null }
    })
}

// La cifra destacada de la vista Pesos: el resultado del mes elegido con los fijos
// en su mes de pago, contra el mes anterior, y el del KPI (fijos mensualizados) para
// explicar la diferencia.
export function moneyHeadline(series, year, month) {
  const idx = findMonthIndex(series, year, month)
  if (idx < 0) return null
  const row = series[idx]
  const point = moneyPoint(row)
  const prev = idx > 0 ? moneyPoint(series[idx - 1]) : null
  return {
    ...point,
    prev,
    change: prev ? change(point.result, prev.result) : null,
    fixedMonthly: operatingOf(row, { fixedBasis: 'monthly' }).fixed,
    resultMonthly: trendPoint(row).result
  }
}

// ── Escala ────────────────────────────────────────────────────────────────────

// Una escala de pasos redondos (1, 2, 2,5 o 5 por potencia de diez) que contiene
// [min, max]. Con un mínimo negativo el cero queda adentro y la escala baja de él:
// un resultado en rojo se dibuja abajo del cero, no aplastado contra él.
export function niceScale(min, max, count = 4) {
  const lo0 = Math.min(0, min)
  const hi0 = Math.max(lo0 + 1, max)
  const raw = (hi0 - lo0) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(f => f * magnitude).find(s => s >= raw)
  const lo = Math.floor(lo0 / step) * step
  const hi = Math.ceil(hi0 / step) * step
  const ticks = []
  for (let i = 0, n = Math.round((hi - lo) / step); i <= n; i++) ticks.push(lo + i * step)
  return { min: lo, max: hi, ticks }
}

export const MONEY_SERIES = ['attendance', 'transport', 'operating', 'personal', 'result']

// Lo que tiene que entrar en la escala de la vista Pesos: las dos barras apiladas
// y el resultado, de lo que esté prendido en la leyenda.
export function moneyScale(points, active = {}) {
  let max = 0
  let min = 0
  for (const p of points || []) {
    const income = (active.attendance !== false ? p.attendance : 0) + (active.transport !== false ? p.transport : 0)
    const costs = (active.operating !== false ? p.operating : 0) + (active.personal !== false ? p.personal : 0)
    max = Math.max(max, income, costs)
    if (active.result !== false) {
      max = Math.max(max, p.result)
      min = Math.min(min, p.result)
    }
  }
  return niceScale(min, max)
}

// ── Meta de margen neto ───────────────────────────────────────────────────────
// La define el centro y se guarda en app_settings (texto, sin borrar filas: la
// tabla no tiene política de DELETE). '' es "sin definir"; null nunca se guarda,
// quedaría como el texto 'null'.

export const MARGIN_TARGET_KEY = 'net_margin_target'
export const TARGET_MIN = -20
export const TARGET_MAX = 60

export const clampTarget = v => Math.max(TARGET_MIN, Math.min(TARGET_MAX, Math.round(v)))

export function parseTarget(value) {
  if (value == null) return null
  const text = String(value).trim().replace(',', '.')
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? clampTarget(n) : null
}

export const serializeTarget = v => (typeof v === 'number' && Number.isFinite(v) ? String(clampTarget(v)) : '')

// La meta que propone el control: el margen neto de hasta 12 meses que terminan en
// el último mes cerrado (el mes en curso todavía no tiene cargado todo su gasto).
// Acumula ingresos y resultados y recién ahí divide.
export function suggestedTarget(series, year, month) {
  const idx = findMonthIndex(series, year, month)
  if (idx < 0) return null
  const window = series.slice(Math.max(0, idx - 11), idx + 1).map(trendPoint)
  const income = window.reduce((s, p) => s + p.income, 0)
  if (!(income > 0)) return null
  const result = window.reduce((s, p) => s + p.result, 0)
  const first = window[0]
  const last = window[window.length - 1]
  return {
    pct: Math.round((result / income) * 100),
    exactPct: (result / income) * 100,
    months: window.length,
    income,
    result,
    from: { year: first.year, month: first.month },
    to: { year: last.year, month: last.month }
  }
}

// ── KPI: paquetes de promo ────────────────────────────────────────────────────
// Lo que las promos le mueven al mes: el adelanto que trae un mes ancla (su paquete
// menos su propio servicio) y lo que no aportan los meses ya cubiertos. Null si el
// mes no tiene ninguna de las dos cosas.
export function packageEffect(q) {
  if (!q) return null
  const advance = q.packageAdvance || 0
  const covered = q.covered || 0
  if (!advance && !covered) return null
  const net = advance - covered
  return { advance, covered, net, pct: q.income > 0 ? (net / q.income) * 100 : null, packages: q.packages || 0, coveredMonths: q.coveredMonths || 0 }
}
