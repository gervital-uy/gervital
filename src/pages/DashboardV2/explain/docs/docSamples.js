import { buildPadron, collectionTotals, invoicingTotals } from '../../../../services/dashboardV2/padron'
import { buildFinanceSeries, financeQuadrantsV2 } from '../../../../services/dashboardV2/financeSeriesV2'
import {
  KPI_OPTIONS, marginPoints, moneyHeadline, periodRows, periodTable, suggestedTarget, trendPoint
} from '../../../../services/dashboardV2/financeView'
import { chartExplainContext } from '../../sections/finance/chartContext'

// Contextos de muestra para el test de integridad de las explicaciones (solo lo
// importa docs.test.js). Uno por explicación registrada en index.js:
//   id: { full: ctx o lista de ctx con todos los datos, partial: ctx a medio cargar }
// Con `full` la explicación tiene que cerrar (valores en todas las filas y la suma
// igual al total); con `partial` y con {} alcanza con que no se rompa.

// Un padrón chico pero completo: cuota cobrada, cuota pendiente, ancla de promo
// cobrada y facturada por el paquete, mes cubierto, y una fila sin CI.
const PROMO = { promo_id: 'p1', promo_total: 3, promo_percent: 10, promo_total_amount: 81000, attendance_gross: 27000, transport_gross: 0 }
const panel = [
  { client_id: 'a', attendance_gross: 24400, transport_gross: 11000, payment_status: 'paid', paid_amount: 35400, invoice_status: 'invoiced', invoiced_amount: 35400 },
  { client_id: 'b', attendance_gross: 30000, transport_gross: 0, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'c', ...PROMO, promo_index: 1, payment_status: 'paid', paid_amount: 81000, invoice_status: 'invoiced', invoiced_amount: 81000 },
  { client_id: 'd', ...PROMO, promo_index: 2, payment_status: 'prepaid', paid_amount: 0, invoice_status: 'pending' },
  { client_id: 'e', attendance_gross: 20000, transport_gross: 0, payment_status: 'paid', paid_amount: 20000, invoice_status: 'pending' }
]
const clients = ['a', 'b', 'c', 'd', 'e'].map(id => ({
  id, firstName: 'X', lastName: id, documentNumber: id === 'e' ? null : '1', email: 'x@y.com', address: { street: 's' }
}))
const breakdown = panel.map(p => ({ clientId: p.client_id, frequency: 3, schedule: 'afternoon', hasTransport: p.transport_gross > 0 }))
const rows = buildPadron({ panel, clients, breakdown }, { year: 2026, month: 9, today: '2026-10-30' })
const cfp = { collection: collectionTotals(rows), invoicing: invoicingTotals(rows) }
const base = { cfp, monthLabel: 'octubre 2026' }
// Una fila con el emitido distinto del servicio (el ancla facturada por el paquete)
// hace que la fila de "monto distinto" de la explicación no sea un cero.

// Finanzas: cuatro meses chicos con montos que netean redondo (30.500 / 1,22 =
// 25.000). jun: una cuota cobrada de más y ningún prestador cargado (la prestadora
// arranca en julio); jul: transporte, el seguro anual en caja, un cobro de menos y
// una plantilla fija cargada después sobre un gasto que ya era variable; ago:
// arranca una promo de 3 meses y una cuota queda pendiente; sep: el mes 2 de esa
// promo no aporta, otro mes 2 espera el cobro de su paquete y un gasto variable
// grande lo deja en rojo.
const finRow = (id, over = {}) => ({
  client_id: id, attendance_gross: 30500, transport_gross: 0, payment_status: 'paid', paid_amount: 30500,
  promo_index: null, promo_total_amount: null, promo_id: null, ...over
})
const finSource = (month, panel, variable = 0, rows = []) => ({
  year: 2026,
  month,
  panel,
  payments: [],
  variableRows: [...(variable ? [{ year: 2026, month, amount: variable, categoryName: 'Alimentación' }] : []), ...rows],
  extraordinaryRows: []
})
const FIN_PROMO = { promo_id: 'p1', promo_total_amount: 91500 }
const FIN_SUPPLIES = { year: 2026, month: 6, amount: 4000, description: 'Insumos varios', createdAt: '2026-07-10T12:00:00Z', categoryName: 'Insumos' }
const FIN_SERIES = buildFinanceSeries([
  finSource(5, [finRow('a', { paid_amount: 31000 }), finRow('b')]),
  finSource(6, [finRow('a'), finRow('b', { transport_gross: 11000, paid_amount: 40000 })], 0, [FIN_SUPPLIES]),
  finSource(7, [finRow('a'), finRow('b', { payment_status: 'pending', paid_amount: null }), finRow('c', { ...FIN_PROMO, promo_index: 1, paid_amount: 91500 })]),
  finSource(8, [
    finRow('a'),
    finRow('b'),
    finRow('c', { ...FIN_PROMO, promo_index: 2, payment_status: 'prepaid', paid_amount: 0 }),
    finRow('d', { promo_id: 'p2', promo_total_amount: 61000, promo_index: 2, payment_status: 'pending', paid_amount: null })
  ], 80000)
], {
  employees: [],
  extraCosts: [],
  providers: [{ id: 'p', name: 'Ana', role: 'Chofer', monthlyAmount: 10000, active: true, createdAt: '2026-07-01T12:00:00Z' }],
  fixedTemplates: [
    { amount: 12000, periodMonths: 12, startYear: 2026, startMonth: 6, categoryName: 'Seguros' },
    { description: 'Insumos varios', amount: 3000, periodMonths: 1, startYear: 2026, startMonth: 5, createdAt: '2026-09-20T12:00:00Z', categoryName: 'Insumos' }
  ],
  directorStart: null
})
const finCtx = (month, open = false) => ({
  finance: { q: financeQuadrantsV2(FIN_SERIES, 2026, month, KPI_OPTIONS), open },
  monthLabel: 'mes de muestra'
})
// Septiembre con un año anterior inventado, para las filas interanuales (una con
// base positiva y otra negativa, que va en pesos).
const finYoY = (() => {
  const ctx = finCtx(8)
  const q = ctx.finance.q
  return {
    ...ctx,
    finance: {
      ...ctx.finance,
      q: {
        ...q,
        yoyRef: { year: 2025, month: 8 },
        deltas: {
          ...q.deltas,
          incomeYoY: { base: 40000, diff: 10000, pct: 25 },
          expensesYoY: { base: 50000, diff: 41000, pct: 82 },
          resultYoY: { base: -10000, diff: -31000, pct: null }
        }
      }
    }
  }
})()
const SEP = { year: 2026, month: 8 }
const WINDOW = { mode: 'window', range: 12 }
const FILTER = { mode: 'filter', years: [2026], months: [6, 7, 8] }
const chartCtx = (view, period, target = { value: 15, shown: 15, persisted: true }, trendOverride = null) => {
  const rows = periodRows(FIN_SERIES, SEP, period)
  const trend = trendOverride || rows.map(trendPoint)
  return chartExplainContext({
    view,
    selected: SEP,
    headline: moneyHeadline(FIN_SERIES, SEP.year, SEP.month),
    trend,
    margins: marginPoints(rows),
    table: period.mode === 'filter' ? periodTable(trend) : [],
    target,
    suggestion: suggestedTarget(FIN_SERIES, 2026, 7)
  })
}
// Un septiembre contra el del año anterior, para la fila del comparable.
const TWO_YEARS = [{ year: 2025, month: 8, income: 100000, costs: 80000, result: 20000, netPct: 20 }, trendPoint(FIN_SERIES[3])]

export const DOC_SAMPLES = {
  cfp: {
    full: [{ ...base, domain: 'collection' }, { ...base, domain: 'invoicing' }],
    partial: { domain: 'invoicing', monthLabel: 'octubre 2026' }
  },
  monthVat: { full: base, partial: { cfp: { invoicing: {} } } },
  finIncome: { full: [finCtx(5), finCtx(6), finCtx(7, true), finCtx(8), finYoY], partial: { finance: { q: {} } } },
  finExpenses: { full: [finCtx(5), finCtx(6), finCtx(8), finYoY], partial: { finance: { q: { personal: {} } } } },
  finResult: { full: [finCtx(5), finCtx(8), finCtx(7, true), finYoY], partial: { finance: { q: {}, open: true } } },
  finAverage: { full: [finCtx(5), finCtx(8)], partial: { finance: { q: { average: {} } } } },
  finChartMoney: { full: [chartCtx('money', WINDOW), chartCtx('money', FILTER)], partial: { chart: { money: { prevName: 'agosto 2026' } } } },
  finChartTrend: {
    full: [chartCtx('trend', WINDOW), chartCtx('trend', FILTER, undefined, TWO_YEARS)],
    partial: { chart: { trend: { comp: { name: 'septiembre 2025' } } } }
  },
  finChartMargins: {
    full: [
      chartCtx('margins', WINDOW),
      chartCtx('margins', WINDOW, { value: null, shown: null, persisted: true }),
      chartCtx('margins', { mode: 'filter', years: [2026], months: [5] })
    ],
    partial: { chart: { margins: {} } }
  },
  finTarget: {
    full: [chartCtx('margins', WINDOW), chartCtx('margins', WINDOW, { value: null, shown: 20, persisted: false })],
    partial: { chart: { target: { suggestion: { fromName: 'junio 2026', toName: 'junio 2026' } } } }
  },
  finPeriods: { full: chartCtx('money', FILTER), partial: { chart: { periods: null } } }
}
