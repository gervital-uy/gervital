import { buildPadron, collectionTotals, invoicingTotals } from '../../../../services/dashboardV2/padron'
import { buildFinanceSeries, financeQuadrantsV2 } from '../../../../services/dashboardV2/financeSeriesV2'
import { financeCards } from '../../../../services/dashboardV2/financeCards'
import { buildTransportEconomics } from '../../../../services/dashboardV2/transportEconomics'
import {
  KPI_OPTIONS, marginPoints, moneyHeadline, periodRows, periodTable, suggestedTarget, trendPoint
} from '../../../../services/dashboardV2/financeView'
import { chartExplainContext } from '../../sections/finance/chartContext'
import { buildCommercial } from '../../../../services/dashboardV2/commercialView'
import { benefitHistory, buildBenefits } from '../../../../services/dashboardV2/benefitsView'

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
const FIN_SOURCES = [
  finSource(5, [finRow('a', { paid_amount: 31000 }), finRow('b')]),
  finSource(6, [finRow('a'), finRow('b', { transport_gross: 11000, paid_amount: 40000 })], 0, [FIN_SUPPLIES]),
  finSource(7, [finRow('a'), finRow('b', { payment_status: 'pending', paid_amount: null }), finRow('c', { ...FIN_PROMO, promo_index: 1, paid_amount: 91500 })]),
  finSource(8, [
    finRow('a'),
    finRow('b'),
    finRow('c', { ...FIN_PROMO, promo_index: 2, payment_status: 'prepaid', paid_amount: 0 }),
    finRow('d', { promo_id: 'p2', promo_total_amount: 61000, promo_index: 2, payment_status: 'pending', paid_amount: null })
  ], 80000)
]
const FIN_COSTS = {
  employees: [],
  extraCosts: [],
  providers: [{ id: 'p', name: 'Ana', role: 'Chofer', monthlyAmount: 10000, active: true, createdAt: '2026-07-01T12:00:00Z' }],
  fixedTemplates: [
    { amount: 12000, periodMonths: 12, startYear: 2026, startMonth: 6, categoryName: 'Seguros' },
    { description: 'Insumos varios', amount: 3000, periodMonths: 1, startYear: 2026, startMonth: 5, createdAt: '2026-09-20T12:00:00Z', categoryName: 'Insumos' }
  ],
  directorStart: null
}
const FIN_SERIES = buildFinanceSeries(FIN_SOURCES, FIN_COSTS)
// Transporte de septiembre: dos tramos (uno con dos pasajeros de bandas distintas),
// un cliente sin distancia y uno que viaja sin transporte cobrado; el chofer es la
// prestadora Ana. Sin choferes, el costo queda sin dato.
const FIN_TRANSPORT_SOURCES = {
  year: 2026,
  month: 8,
  panel: [
    { client_id: 'a', transport_gross: 11000 },
    { client_id: 'b', transport_gross: 5500 },
    { client_id: 'c', transport_gross: 0 }
  ],
  clients: [{ id: 'a', distanceRange: '2_to_5km' }, { id: 'b', distanceRange: null }, { id: 'c', distanceRange: '0_to_2km' }],
  cars: [
    { date: '2026-09-01', shift: 'morning_arrival', seatCount: 4, clientIds: ['a', 'b'] },
    { date: '2026-09-01', shift: 'afternoon_departure', seatCount: 4, clientIds: ['c'] }
  ],
  tripCounts: [{ clientId: 'a', date: '2026-09-01', tripCount: 1 }, { clientId: 'b', date: '2026-09-01', tripCount: 1 }, { clientId: 'c', date: '2026-09-01', tripCount: 1 }]
}
const FIN_TRANSPORT = buildTransportEconomics({ ...FIN_TRANSPORT_SOURCES, providers: FIN_COSTS.providers, today: '2026-11-06' })
const FIN_TRANSPORT_NO_DRIVERS = buildTransportEconomics({ ...FIN_TRANSPORT_SOURCES, providers: [], today: '2026-09-15' })
const finCtx = (month, open = false, transport = FIN_TRANSPORT) => ({
  finance: {
    q: financeQuadrantsV2(FIN_SERIES, 2026, month, KPI_OPTIONS),
    open,
    cards: financeCards({ series: FIN_SERIES, sources: FIN_SOURCES, fixedTemplates: FIN_COSTS.fixedTemplates }, { year: 2026, month }, KPI_OPTIONS),
    transport
  },
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

// Una cartera chica para Comercial (hoy = 6 de noviembre de 2026):
//   a heredado, 2× tarde con transporte y 10% de descuento en octubre
//   b heredado de día completo, se va el 15 de octubre (en pausa temporal)
//   c alta de septiembre, 1× tarde, sin fecha de nacimiento
//   d alta de octubre, 2× tarde, tier C
//   e heredado que en octubre baja de 2× a 1× (mueve el MRR sin entrar ni salir)
//   f alta de agosto con transporte y sin distancia (el transporte vale 0)
//   g sin cargo: ocupa lugar sin ser de la cartera
const person = (id, over = {}) => ({ id, firstName: id, lastName: 'X', clientType: 'regular', startDate: '2026-06-01', birthDate: '1941-03-02', cognitiveLevel: 'B', distanceRange: '0_to_2km', ...over })
const planOf = (clientId, over = {}) => ({ clientId, effectiveFrom: '2026-06-01', frequency: 2, schedule: 'afternoon', hasTransport: false, assignedDays: ['tuesday', 'thursday'], ...over })
const price = (frequency, schedule, priceNet) => ({ frequency, schedule, priceNet, effectiveYear: 2000, effectiveMonth: 0 })
const commercialModel = buildCommercial({
  clients: [
    person('a'),
    person('b', { cognitiveLevel: 'D', birthDate: '1931-02-01' }),
    person('c', { startDate: '2026-09-10', cognitiveLevel: 'A', birthDate: null }),
    person('d', { startDate: '2026-10-05', cognitiveLevel: 'C' }),
    person('e', { birthDate: '1950-08-20' }),
    person('f', { startDate: '2026-08-03', distanceRange: null }),
    person('g', { clientType: 'charity', startDate: '2026-07-01' })
  ],
  periods: [{ clientId: 'b', fromDate: '2026-10-15', toDate: null, reason: 'health_decline' }],
  followups: [{ clientId: 'b', stage: 'temporary_pause', deactivationDate: '2026-10-15' }],
  plans: [
    planOf('a', { hasTransport: true }),
    planOf('b', { frequency: 5, schedule: 'full_day', assignedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }),
    planOf('c', { effectiveFrom: '2026-09-01', frequency: 1, assignedDays: ['friday'] }),
    planOf('d', { effectiveFrom: '2026-10-01', assignedDays: ['monday', 'wednesday'] }),
    planOf('e'),
    planOf('e', { effectiveFrom: '2026-10-01', frequency: 1, assignedDays: ['tuesday'] }),
    planOf('f', { effectiveFrom: '2026-08-01', hasTransport: true, assignedDays: ['monday', 'friday'] }),
    planOf('g', { assignedDays: ['wednesday'] })
  ],
  discounts: [{ clientId: 'a', year: 2026, month: 9, discountPercent: 10 }],
  planPricing: [price(1, 'afternoon', 16393.44), price(2, 'afternoon', 24590.16), price(5, 'full_day', 66393.44)],
  transportPricing: [{ frequency: 2, distanceRange: '0_to_2km', priceNet: 4654.55, effectiveYear: 2000, effectiveMonth: 0 }],
  reasons: [{ key: 'health_decline', label: 'Deterioro de salud', color: '#dc2626', sortOrder: 3 }],
  shiftCapacity: '20'
}, { today: '2026-11-06' })

// El contexto que arma CommercialSection para un mes, con lo elegido en cada tarjeta.
const commercialCtx = (month, { capacity, compositionDim = 'frequency', mixDim = 'schedule', exitWindow = 12, cohortView = 'quarter' } = {}) => {
  const m = commercialModel.month(commercialModel.indexOf(2026, month))
  return {
    month: m,
    occupancy: capacity ? m.simulateOccupancy(capacity) : m.occupancy,
    composition: { dimension: compositionDim, rows: m.composition[compositionDim] },
    mix: { dimension: mixDim, rows: m.mix[mixDim] },
    exits: m.exitsByReason(exitWindow),
    cohorts: m.cohorts(cohortView),
    monthLabel: `${['junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre'][month - 5]} 2026`
  }
}
// Octubre (con baja en pausa, alta, cambio de plan y descuento), junio (el mes del
// lanzamiento, con la base heredada) y noviembre en curso con un aforo a prueba.
const COMMERCIAL_FULL = [
  commercialCtx(9),
  commercialCtx(5, { compositionDim: 'age', mixDim: 'cognitiveLevel', exitWindow: null, cohortView: 'month' }),
  commercialCtx(10, { capacity: 8, compositionDim: 'cognitiveLevel', mixDim: 'frequency', exitWindow: 6 })
]
const commercialSample = partial => ({ full: COMMERCIAL_FULL, partial: { monthLabel: 'octubre 2026', ...partial } })

// Promociones de octubre 2026: a arranca una promo de 3 meses (paquete cobrado), b
// cursa el mes 2 de otra, c tiene un descuento escalonado (25% y sigue con 20%), d un
// 10% sin cálculo del mes (la lista se reconstruye), g un 100% sin cálculo (no suma)
// y k ninguno, con una promo vieja de jun–ago. e tuvo un 15% en jul–ago, cobrado.
const bPromo = (id, clientId, [sy, sm], [ey, em], over = {}) => ({
  id, clientId, firstName: '', lastName: '', discountPercent: 10, discountAmount: 9000, totalAmount: 81000,
  startYear: sy, startMonth: sm, endYear: ey, endMonth: em, paidDate: null, paidAmount: null, ...over
})
const bMonth = (clientId, month, discountPercent, over = {}) => ({
  clientId, year: 2026, month, discountPercent, promoId: null, paymentStatus: 'pending', attendanceChargeableGross: null, ...over
})
const bPaid = att => ({ paymentStatus: 'paid', attendanceChargeableGross: att })
const bRow = (id, over = {}) => {
  const row = { id, firstName: id, lastName: 'X', attendanceGross: 30000, transportGross: 0, promoId: null, promoIndex: null, promoTotal: null, promoPercent: null, discountPercent: null, ...over }
  return { ...row, amount: row.attendanceGross + row.transportGross }
}
const bBill = (rate, charged) => ({ attendanceMonthlyRateGross: rate, chargeableDays: 8, daysPerMonth: 8, attendanceChargeableGross: charged })
const BENEFITS = buildBenefits({
  padron: [
    bRow('a', { promoId: 'pA', promoIndex: 1, promoTotal: 3, promoPercent: 10, attendanceGross: 27000 }),
    bRow('b', { promoId: 'pB', promoIndex: 2, promoTotal: 3, promoPercent: 10, attendanceGross: 27000, transportGross: 5000 }),
    bRow('c', { discountPercent: 25, attendanceGross: 36000 }),
    bRow('d', { discountPercent: 10, attendanceGross: 27000 }),
    bRow('g', { discountPercent: 100, attendanceGross: 0 }),
    bRow('k')
  ],
  promotions: [
    bPromo('pA', 'a', [2026, 9], [2026, 11], { paidDate: '2026-10-05', paidAmount: 81000 }),
    bPromo('pB', 'b', [2026, 8], [2026, 10], { paidDate: '2026-09-05', paidAmount: 81000 }),
    bPromo('pOld', 'k', [2026, 5], [2026, 7], { paidDate: '2026-06-05', paidAmount: 81000 })
  ],
  ledger: [
    bMonth('c', 9, 25), bMonth('c', 10, 20),
    bMonth('d', 8, 10, bPaid(27000)), bMonth('d', 9, 10),
    bMonth('g', 9, 100),
    bMonth('e', 6, 15, bPaid(17000)), bMonth('e', 7, 15, bPaid(17000))
  ],
  clients: ['a', 'b', 'c', 'd', 'e', 'g', 'k'].map(id => ({ id, firstName: id, lastName: 'X' })),
  billing: { a: bBill(30000, 27000), b: bBill(30000, 27000), c: bBill(48000, 36000) },
  pastBase: { year: 2026, month: 3, clientIds: ['a', 'b', 'k'] }
}, { year: 2026, month: 9 })
const benefitsCtx = (from, to) => ({
  benefits: {
    kpis: BENEFITS.kpis,
    history: from == null ? null : benefitHistory(BENEFITS.agreements, { from: { year: 2026, month: from }, to: { year: 2026, month: to }, today: '2026-11-06' }).totals
  },
  monthLabel: 'octubre 2026'
})
// jun–oct: con meses sin cobrar en el historial; ago: todo cobrado.
const BENEFITS_HISTORY = [benefitsCtx(5, 9), benefitsCtx(7, 7)]
const BENEFITS_FULL = [benefitsCtx(), ...BENEFITS_HISTORY]
const benefitsSample = partial => ({ full: BENEFITS_FULL, partial: { benefits: partial } })

export const DOC_SAMPLES = {
  cfp: {
    full: [{ ...base, domain: 'collection' }, { ...base, domain: 'invoicing' }],
    partial: { domain: 'invoicing', monthLabel: 'octubre 2026' }
  },
  monthVat: { full: base, partial: { cfp: { invoicing: {} } } },
  benefCoverage: benefitsSample({ kpis: { segments: [], base: 5 } }),
  benefDiscount: benefitsSample({ kpis: { discount: { total: 1000 } } }),
  benefPackages: benefitsSample({ kpis: { packages: {} } }),
  benefRenewals: benefitsSample({ kpis: { renewals: { count: 2 } } }),
  benefPromos: benefitsSample({}),
  benefDiscounts: benefitsSample({ history: {} }),
  benefHistory: { full: BENEFITS_HISTORY, partial: { benefits: { history: { promos: 1 } } } },
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
  finPeriods: { full: chartCtx('money', FILTER), partial: { chart: { periods: null } } },
  finPersonal: { full: [finCtx(5), finCtx(6), finCtx(8)], partial: { finance: { cards: { personal: {} } } } },
  finOperating: { full: [finCtx(5), finCtx(8)], partial: { finance: { cards: { operating: { parts: [] } } } } },
  finCategories: { full: [finCtx(5), finCtx(6), finCtx(8)], partial: { finance: { cards: { categories: { rows: [] } } } } },
  finCash: { full: [finCtx(6), finCtx(7, true), finCtx(8)], partial: { finance: { cards: { cash: {} } } } },
  finVat: { full: [finCtx(6), finCtx(8)], partial: { finance: { cards: {} } } },
  finBridge: { full: [finCtx(5), finCtx(8)], partial: { finance: { cards: { bridge: { steps: [] } } } } },
  finLines: { full: [finCtx(6), finCtx(8)], partial: { finance: { cards: { lines: { attendance: {} } } } } },
  finTransport: { full: [finCtx(8), finCtx(8, true, FIN_TRANSPORT_NO_DRIVERS)], partial: { finance: { transport: { legs: 2 } } } },
  finBreakeven: { full: [finCtx(5), finCtx(8)], partial: { finance: { cards: { breakeven: { users: 0 } } } } },
  activeClients: commercialSample({ month: { counts: { opening: 3 } } }),
  mrr: commercialSample({ month: { mrr: { closing: { total: 1000 } } } }),
  mrrFlow: commercialSample({ month: { mrr: { opening: 1000 }, counts: {} } }),
  churn: commercialSample({ month: { churn: { window: { months: 4 } } } }),
  tenure: commercialSample({ month: { tenure: { measured: 0 } } }),
  occupancy: commercialSample({ occupancy: { capacity: 30 } }),
  heatmapSeats: commercialSample({ occupancy: { capacity: 30 } }),
  heatmapTiers: commercialSample({ occupancy: {} }),
  composition: commercialSample({ composition: { dimension: 'age' } }),
  revenueMix: commercialSample({ mix: { dimension: 'schedule', rows: [] } }),
  clientFlow: commercialSample({ month: { counts: { altas: 1 } } }),
  exitsByReason: commercialSample({ exits: { requested: 12 } }),
  cohorts: commercialSample({ cohorts: { mode: 'month' } })
}
