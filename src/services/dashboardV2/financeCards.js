import {
  AVERAGE_WINDOW, breakevenV2, bridgeStepsV2, cashAndTaxesV2, expensesByCategoryV2, findMonthIndex, lineRevenueV2,
  operatingOf, personalOf
} from './financeSeriesV2'

// Las tarjetas de análisis del mes de Finanzas, armadas de una vez sobre la serie
// (buildFinanceSeries) y las fuentes de cada mes (loadFinanceData). Lógica pura:
// todo sale de los selectores de financeSeriesV2. month es 0-indexed.
// opts: los de los KPIs (base, IVA, fijos mensualizados o en caja).

const PERSONAL_PARTS = ['salaries', 'providers', 'extras', 'director']
const OPERATING_PARTS = ['fixed', 'variable', 'extraordinary']

// Un bloque de gasto partido en sus piezas, cada una con el mes anterior y su
// recorrido de los últimos meses (hasta AVERAGE_WINDOW, desde el lanzamiento).
function blockParts(series, idx, keys, of) {
  const window = series.slice(Math.max(0, idx - (AVERAGE_WINDOW - 1)), idx + 1)
  const now = of(series[idx])
  const before = idx > 0 ? of(series[idx - 1]) : null
  return {
    total: now.total,
    parts: keys.map(key => ({
      key,
      value: now[key],
      prev: before ? before[key] : null,
      trend: window.map(r => of(r)[key])
    }))
  }
}

export function financeCards({ series, sources, fixedTemplates }, { year, month }, opts = {}) {
  const idx = findMonthIndex(series, year, month)
  if (idx < 0) return null
  const row = series[idx]
  const prevRow = idx > 0 ? series[idx - 1] : null
  const sourceOf = r => (r ? (sources || []).find(s => s.year === r.year && s.month === r.month) || null : null)
  const fixedBasis = opts.fixedBasis || 'monthly'
  const current = sourceOf(row) || { year, month, variableRows: [], extraordinaryRows: [] }

  return {
    year,
    month,
    prev: prevRow ? { year: prevRow.year, month: prevRow.month } : null,
    personal: blockParts(series, idx, PERSONAL_PARTS, personalOf),
    operating: blockParts(series, idx, OPERATING_PARTS, r => operatingOf(r, { fixedBasis })),
    categories: expensesByCategoryV2(current, sourceOf(prevRow), fixedTemplates, { fixedBasis }),
    cash: cashAndTaxesV2(row),
    bridge: bridgeStepsV2(row, opts),
    // Ingreso por línea: siempre el servicio del mes (la caja no se parte por línea
    // sin prorratear) y con el IVA que pidan los KPIs.
    lines: {
      attendance: lineRevenueV2(series, year, month, 'attendance', { withIva: !!opts.withIva }),
      transport: lineRevenueV2(series, year, month, 'transport', { withIva: !!opts.withIva })
    },
    breakeven: breakevenV2(row, { fixedBasis })
  }
}
