import {
  splitByLines, linesTotal, financeMonths, panelIncome, cashIncome, providerActiveIn, partitionExtras,
  directorContributionForMonth, monthCosts, buildFinanceSeries, incomeOf, personalOf, operatingOf,
  expensesOf, resultOf, change, marginKpisV2, financeQuadrantsV2, bridgeStepsV2, expensesByCategoryV2,
  cashAndTaxesV2, lineRevenueV2, breakevenV2, shadowedTemplates, templatesForMonth, PROVIDERS_TABLE_SINCE
} from './financeSeriesV2'
import { buildPadron, collectionTotals } from './padron'
import { monthlyCostToCompany, directorContributionAsOf } from '../salaries/salaryCalc'

// Montos con IVA, como los devuelve get_month_collection_panel. month es 0-indexed.
const panelRow = (id, over = {}) => ({
  client_id: id,
  attendance_gross: 30000,
  transport_gross: 0,
  payment_status: 'pending',
  paid_amount: null,
  paid_date: null,
  promo_index: null,
  promo_total_amount: null,
  promo_id: null,
  ...over
})

// Un mes con todo: cuota cobrada, cuota pendiente con transporte, ancla de una promo
// cobrada (paquete de 96.360), mes cubierto por otra promo y un cobro por otro monto.
const SEP_PANEL = [
  panelRow('a', { payment_status: 'paid', paid_amount: 30000, paid_date: '2026-09-04' }),
  panelRow('b', { attendance_gross: 24000, transport_gross: 5120 }),
  panelRow('c', { attendance_gross: 27000, transport_gross: 5120, promo_index: 1, promo_total_amount: 96360, promo_id: 'p1', payment_status: 'paid', paid_amount: 96360, paid_date: '2026-09-09' }),
  panelRow('d', { attendance_gross: 27000, promo_index: 2, promo_total_amount: 81000, promo_id: 'p0', payment_status: 'prepaid', paid_amount: 0 }),
  panelRow('e', { attendance_gross: 39000, payment_status: 'paid', paid_amount: 38000, paid_date: '2026-09-08' })
]

const LINE_KEYS = ['attGross', 'transGross', 'attNet', 'transNet']
const expectLinesEqual = (a, b) => LINE_KEYS.forEach(k => expect(a[k]).toBe(b[k]))
const plus = (a, b) => Object.fromEntries(LINE_KEYS.map(k => [k, a[k] + b[k]]))
const minus = (a, b) => Object.fromEntries(LINE_KEYS.map(k => [k, a[k] - b[k]]))

describe('splitByLines — cada línea con su IVA', () => {
  test('el importe del mes se parte exacto y se netea al 22% y al 10%', () => {
    expect(splitByLines(35120, 30000, 5120)).toEqual({ attGross: 30000, transGross: 5120, attNet: 24590, transNet: 4655 })
  })

  test('un paquete se parte en la proporción de las líneas del mes', () => {
    // 3 × (27.000 + 5.120): la misma proporción que el mes
    expect(splitByLines(96360, 27000, 5120)).toMatchObject({ attGross: 81000, transGross: 15360 })
  })

  test('sin líneas todo es asistencia; un importe vacío es cero', () => {
    expect(splitByLines(1000, 0, 0)).toMatchObject({ attGross: 1000, transGross: 0 })
    expect(splitByLines(null, 30000, 0)).toEqual({ attGross: 0, transGross: 0, attNet: 0, transNet: 0 })
  })

  test('linesTotal suma con o sin IVA', () => {
    const lines = splitByLines(35120, 30000, 5120)
    expect(linesTotal(lines)).toBe(24590 + 4655)
    expect(linesTotal(lines, true)).toBe(35120)
    expect(linesTotal(null)).toBe(0)
  })
})

describe('financeMonths — la ventana arranca en el lanzamiento', () => {
  test('de junio de 2026 al mes de hoy', () => {
    expect(financeMonths('2026-11-06')).toEqual([
      { year: 2026, month: 5 }, { year: 2026, month: 6 }, { year: 2026, month: 7 },
      { year: 2026, month: 8 }, { year: 2026, month: 9 }, { year: 2026, month: 10 }
    ])
    expect(financeMonths('2027-01-02').slice(-2)).toEqual([{ year: 2026, month: 11 }, { year: 2027, month: 0 }])
    expect(financeMonths(null)).toEqual([])
  })
})

describe('panelIncome — tres bases que cierran', () => {
  const income = panelIncome(SEP_PANEL)

  test('previsto devengado: el servicio de cada fila', () => {
    expect(linesTotal(income.accrued, true)).toBe(30000 + 29120 + 32120 + 27000 + 39000)
  })

  test('banco: lo cobrado por lo que entró, el paquete entero en el ancla y $0 en el mes cubierto', () => {
    // e debía 39.000 y entraron 38.000: cuenta lo que entró
    expect(linesTotal(income.bank, true)).toBe(30000 + 29120 + 96360 + 0 + 38000)
    expect(linesTotal(income.packageAdvance, true)).toBe(96360 - 32120)
    expect(linesTotal(income.covered, true)).toBe(27000)
    expect(linesTotal(income.paidDiff, true)).toBe(-1000)
    // banco = devengado + adelanto de paquetes − meses cubiertos + diferencia de cobro
    expectLinesEqual(income.bank, plus(minus(plus(income.accrued, income.packageAdvance), income.covered), income.paidDiff))
  })

  test('banco = cobrado + pendiente, sin diferencia que explicar', () => {
    expect(linesTotal(income.collected, true)).toBe(30000 + 96360 + 38000)
    expect(linesTotal(income.pending, true)).toBe(29120)
    expectLinesEqual(income.bank, plus(income.collected, income.pending))
  })

  test('es el Previsto de Cobranza de Gestión CFP, con IVA y fila por fila', () => {
    const padron = buildPadron({ panel: SEP_PANEL }, { year: 2026, month: 8, today: '2026-09-20' })
    expect(linesTotal(income.bank, true)).toBe(collectionTotals(padron).expected)
    // Un mes cerrado y cobrado entero: no promete plata que no va a entrar
    const closed = panelIncome(SEP_PANEL.filter(p => p.payment_status !== 'pending'))
    expect(linesTotal(closed.bank, true)).toBe(linesTotal(closed.collected, true))
  })

  test('cuenta clientes por línea, paquetes, meses cubiertos y cobros por otro monto', () => {
    expect(income.counts).toEqual({
      rows: 5, clients: 5, attendanceClients: 5, transportClients: 2,
      paid: 3, pending: 1, paidOff: 1, packages: 1, packagesCollected: 1, covered: 1, awaiting: 0
    })
  })

  test('un mes 2..N que espera el cobro de su paquete no debe nada propio ni está cubierto', () => {
    const waiting = panelIncome([panelRow('x', { promo_index: 2, promo_total_amount: 81000, promo_id: 'p' })])
    expect(linesTotal(waiting.bank, true)).toBe(0)
    expect(waiting.counts.pending).toBe(0)
    expect(linesTotal(waiting.covered, true)).toBe(0)
    expect(linesTotal(waiting.awaiting, true)).toBe(30000)
    expect(waiting.counts).toMatchObject({ covered: 0, awaiting: 1 })
    expectLinesEqual(waiting.bank, minus(waiting.accrued, waiting.awaiting))
  })
})

describe('cashIncome — caja real por fecha de pago', () => {
  const payments = [
    { year: 2026, month: 8, payment_status: 'paid', paid_amount: 30000, paid_date: '2026-09-04', attendance_chargeable_gross: 30000, transport_chargeable_gross: 0 },
    // Paquete: el snapshot del ancla guarda el paquete, sirve para la proporción
    { year: 2026, month: 8, payment_status: 'paid', paid_amount: 96360, paid_date: '2026-09-09', promo_id: 'p1', attendance_chargeable_gross: 81000, transport_chargeable_gross: 15360 },
    // Octubre pagado a fin de septiembre: adelanto
    { year: 2026, month: 9, payment_status: 'paid', paid_amount: 27000, paid_date: '2026-09-29', attendance_chargeable_gross: 27000, transport_chargeable_gross: 0 },
    // Fuera del mes
    { year: 2026, month: 8, payment_status: 'paid', paid_amount: 5000, paid_date: '2026-10-01', attendance_chargeable_gross: 5000, transport_chargeable_gross: 0 },
    // Un mes prepago no aporta caja
    { year: 2026, month: 8, payment_status: 'prepaid', paid_amount: 0, paid_date: null }
  ]

  test('suma lo que entró en el mes, partido por línea', () => {
    const { cash, otherMonths, counts } = cashIncome(payments, 2026, 8)
    expect(linesTotal(cash, true)).toBe(30000 + 96360 + 27000)
    expect(cash.transGross).toBe(15360)
    expect(linesTotal(otherMonths, true)).toBe(27000)
    expect(counts).toEqual({ payments: 3, paymentsOtherMonths: 1, paymentsPackages: 1 })
  })
})

describe('gastos — prestadores, extras y aporte de directores', () => {
  const provider = (over = {}) => ({ id: 'w', name: 'Waldemar', role: 'Chofer', monthlyAmount: 44000, active: true, createdAt: '2026-09-08T18:18:02+00:00', updatedAt: '2026-09-08T18:18:02+00:00', ...over })

  test('un prestador cuenta desde el mes en que se cargó (B6)', () => {
    expect(providerActiveIn(provider(), 2026, 7)).toBe(false)
    expect(providerActiveIn(provider(), 2026, 8)).toBe(true)
    expect(providerActiveIn(provider(), 2027, 3)).toBe(true)
  })

  test('uno dado de baja deja de contar desde el mes de su última edición', () => {
    const off = provider({ active: false, updatedAt: '2026-11-02T13:00:00+00:00' })
    expect(providerActiveIn(off, 2026, 9)).toBe(true)
    expect(providerActiveIn(off, 2026, 10)).toBe(false)
    expect(providerActiveIn(provider({ createdAt: null }), 2026, 9)).toBe(false)
  })

  test('los extras sueltos anteriores a la tabla de prestadores son prestadores', () => {
    expect(PROVIDERS_TABLE_SINCE).toBe('2026-09')
    const { director, legacyProviders, staff } = partitionExtras([
      { id: 1, date: '2026-07-05', amount: 28000 },
      { id: 2, date: '2026-08-05', amount: 44000 },
      { id: 3, date: '2026-09-24', amount: 1700 },
      { id: 4, date: '2026-09-30', amount: 34292, systemKey: 'director_bps' },
      { id: 5, date: '2026-07-10', amount: 999, employeeId: 'emp' }
    ])
    expect(legacyProviders.map(x => x.id)).toEqual([1, 2])
    expect(staff.map(x => x.id)).toEqual([3])
    expect(director.map(x => x.id)).toEqual([4])
  })

  const employees = [{ active: true, hasIrpf: false, adjustments: [{ liquido: 40000, effectiveDate: '2026-06-01' }], extraCosts: [{ amount: 500, date: '2026-09-10' }] }]

  test('aporte de directores: la fila guardada, o calculado sin guardar desde el mes ancla (B14)', () => {
    const rows = [{ systemKey: 'director_bps', date: '2026-09-30', amount: 34292 }]
    expect(directorContributionForMonth({ rows, employees, startKey: '2026-09' }, 2026, 8)).toEqual({ amount: 34292, estimated: false })
    expect(directorContributionForMonth({ rows, employees, startKey: '2026-09' }, 2026, 9))
      .toEqual({ amount: directorContributionAsOf(employees, '2026-10-30'), estimated: true })
    expect(directorContributionForMonth({ rows, employees, startKey: '2026-09' }, 2026, 7)).toEqual({ amount: 0, estimated: false })
    expect(directorContributionForMonth({ rows: [], employees, startKey: null }, 2026, 9)).toEqual({ amount: 0, estimated: false })
  })

  const costs = {
    employees,
    extraCosts: [
      { date: '2026-08-05', amount: 114500 },
      { date: '2026-09-24', amount: 1700 },
      { date: '2026-09-30', amount: 34292, systemKey: 'director_bps' }
    ],
    providers: [provider(), provider({ id: 'c', name: 'Contador', role: 'Contador', monthlyAmount: 16500 })],
    fixedTemplates: [{ amount: 12000, periodMonths: 12, startYear: 2026, startMonth: 2, categoryName: 'Impuestos' }],
    directorStart: '2026-09'
  }

  test('agosto: los prestadores están en los extras sueltos, la tabla todavía no cuenta', () => {
    const c = monthCosts(costs, { year: 2026, month: 7, variableRows: [{ year: 2026, month: 7, amount: '1000.50' }], extraordinaryRows: [] })
    expect(c).toMatchObject({ providersLegacy: 114500, providersTable: 0, staffExtras: 0, drivers: 0, directorBps: 0, variable: 1000.5, fixedMonthly: 1000, fixedCash: 0, contingency: 0 })
    expect(c.salaries).toBeCloseTo(monthlyCostToCompany(40000, false))
  })

  test('septiembre: la tabla cuenta, los choferes aparte, el aporte y los extras del personal', () => {
    const c = monthCosts(costs, { year: 2026, month: 8, variableRows: [], extraordinaryRows: [{ year: 2026, month: 8, amount: 2000 }] })
    expect(c).toMatchObject({ providersLegacy: 0, providersTable: 60500, providerCount: 2, drivers: 44000, driverCount: 1, staffExtras: 1700, employeeExtras: 500, directorBps: 34292, directorBpsEstimated: false, contingency: 2000, providersMissing: false })
  })

  test('un mes anterior a la tabla sin ningún pago a prestadores tiene el gasto incompleto', () => {
    expect(monthCosts(costs, { year: 2026, month: 5, variableRows: [], extraordinaryRows: [] }).providersMissing).toBe(true)
    expect(monthCosts(costs, { year: 2026, month: 7, variableRows: [], extraordinaryRows: [] }).providersMissing).toBe(false)
  })
})

describe('plantillas fijas cargadas hacia atrás', () => {
  // Como en la base: siete gastos variables de julio que en septiembre pasaron a
  // plantillas con inicio en junio, y la verdulería con otra descripción.
  const tpl = (over = {}) => ({ amount: 10000, periodMonths: 1, startYear: 2026, startMonth: 5, supplierId: null, createdAt: '2026-09-22T14:00:00+00:00', categoryName: 'Administración', ...over })
  const insumos = tpl({ description: 'Insumos varios' })
  const limpieza = tpl({ description: 'Artículos de limpieza', amount: 2500 })
  const verduleria = tpl({ description: 'Verduleria El Chavo', supplierId: 'chavo', startMonth: 7, createdAt: '2026-09-23T14:00:00+00:00' })
  const ute = tpl({ description: 'Electricidad (UTE)', amount: 12000, createdAt: '2026-07-06T14:00:00+00:00' })
  const imm1 = tpl({ description: 'Contribución', supplierId: 'imm', amount: 9000 })
  const imm2 = tpl({ description: 'Tributos', supplierId: 'imm', amount: 2600 })
  const templates = [insumos, limpieza, verduleria, ute, imm1, imm2]
  const variable = (month, description, amount, createdAt, supplierId = null) => ({ year: 2026, month, description, amount, createdAt, supplierId, categoryName: 'Varios' })

  test('en un mes que ya tenía el gasto como variable cuenta la fila variable, no la plantilla', () => {
    const july = [variable(6, 'Insumos varios', 10000, '2026-07-07T12:00:00+00:00'), variable(6, 'artículos de limpieza ', 3000, '2026-07-07T12:00:00+00:00')]
    expect([...shadowedTemplates(templates, july, 2026, 6)]).toEqual([insumos, limpieza])
    const c = monthCosts({ fixedTemplates: templates }, { year: 2026, month: 6, variableRows: july, extraordinaryRows: [] })
    expect(c.fixedMonthly).toBe(12000 + 9000 + 2600)
    expect(c.variable).toBe(13000)
    expect(c).toMatchObject({ fixedShadowedCount: 2, fixedShadowedMonthly: 12500 })
  })

  test('mismo proveedor con otra descripción: solo si es la única plantilla de ese proveedor', () => {
    const august = [variable(7, 'Frutas y verduras El Chavo', 12000, '2026-07-21T12:00:00+00:00', 'chavo'), variable(7, 'IMM', 5000, '2026-07-21T12:00:00+00:00', 'imm')]
    expect([...shadowedTemplates(templates, august, 2026, 7)]).toEqual([verduleria])
  })

  test('una fila variable cargada después de la plantilla es un gasto aparte: cuentan las dos', () => {
    const october = [variable(9, 'Verduleria El Chavo', 15934, '2026-10-27T12:00:00+00:00', 'chavo')]
    expect(shadowedTemplates(templates, october, 2026, 9).size).toBe(0)
    // Una plantilla cargada antes que el mes: la fila variable no la pisa
    const julyPower = [variable(6, 'Electricidad (UTE)', 11000, '2026-07-20T12:00:00+00:00')]
    expect(shadowedTemplates(templates, julyPower, 2026, 6).size).toBe(0)
  })

  test('un mes sin la fila variable cuenta la plantilla; en caja, igual', () => {
    expect(templatesForMonth(templates, [], 2026, 5)).toEqual(templates)
    const july = [variable(6, 'Insumos varios', 10000, '2026-07-07T12:00:00+00:00')]
    const c = monthCosts({ fixedTemplates: templates }, { year: 2026, month: 6, variableRows: july, extraordinaryRows: [] })
    expect(c.fixedCash).toBe(c.fixedMonthly)
  })

  test('gastos por categoría usan la misma regla', () => {
    const july = { year: 2026, month: 6, variableRows: [variable(6, 'Insumos varios', 10000, '2026-07-07T12:00:00+00:00')], extraordinaryRows: [] }
    const { total } = expensesByCategoryV2(july, null, [insumos])
    expect(total).toBe(10000)
  })
})

// Serie de dos meses para los selectores: agosto y septiembre.
const COSTS = {
  employees: [{ active: true, hasIrpf: false, adjustments: [{ liquido: 40000, effectiveDate: '2026-06-01' }], extraCosts: [] }],
  extraCosts: [{ date: '2026-08-05', amount: 10000 }, { date: '2026-09-30', amount: 5000, systemKey: 'director_bps' }],
  providers: [{ id: 'w', role: 'Chofer', monthlyAmount: 10000, active: true, createdAt: '2026-09-01T12:00:00+00:00' }],
  fixedTemplates: [
    { amount: 6000, periodMonths: 1, startYear: 2026, startMonth: 0, categoryName: 'Alquiler' },
    { amount: 12000, periodMonths: 12, startYear: 2026, startMonth: 8, categoryName: 'Seguros' }
  ],
  directorStart: '2026-09'
}
const SALARY = monthlyCostToCompany(40000, false)

const AUG = {
  year: 2026,
  month: 7,
  panel: [panelRow('a', { payment_status: 'paid', paid_amount: 30000 }), panelRow('b', { attendance_gross: 24000, transport_gross: 5120, payment_status: 'paid', paid_amount: 29120 })],
  payments: [],
  variableRows: [{ year: 2026, month: 7, amount: 4000, categoryName: 'Alimentación' }, { year: 2026, month: 7, amount: 1500, categoryName: 'Limpieza' }],
  extraordinaryRows: []
}
const SEP = {
  year: 2026,
  month: 8,
  panel: SEP_PANEL,
  payments: [{ year: 2026, month: 8, payment_status: 'paid', paid_amount: 30000, paid_date: '2026-09-04', attendance_chargeable_gross: 30000, transport_chargeable_gross: 0 }],
  variableRows: [{ year: 2026, month: 8, amount: 6000, categoryName: 'Alimentación' }],
  extraordinaryRows: [{ year: 2026, month: 8, amount: 2000, categoryName: 'Obras' }]
}
const series = buildFinanceSeries([SEP, AUG], COSTS)
const [aug, sep] = series

describe('buildFinanceSeries y selectores', () => {
  test('ordena por mes y arma cada fila', () => {
    expect(series.map(r => r.month)).toEqual([7, 8])
    expect(incomeOf(sep, { withIva: true })).toBe(193480)
    expect(incomeOf(sep, { basis: 'accrued', withIva: true })).toBe(157240)
    expect(incomeOf(sep, { basis: 'cash', withIva: true })).toBe(30000)
    expect(incomeOf(sep, { basis: 'bank', line: 'transport', withIva: true })).toBe(5120 + 15360)
    expect(incomeOf(sep, { basis: 'bank', line: 'attendance' })).toBe(sep.income.bank.attNet)
    expect(incomeOf(null)).toBe(0)
  })

  test('personal: sueldos, prestadores (tabla o extras viejos), extras y aporte', () => {
    expect(personalOf(aug)).toEqual({ salaries: SALARY, providers: 10000, extras: 0, director: 0, total: SALARY + 10000 })
    expect(personalOf(sep)).toEqual({ salaries: SALARY, providers: 10000, extras: 0, director: 5000, total: SALARY + 15000 })
  })

  test('funcionamiento: fijos mensualizados o en caja, variables y extraordinarios', () => {
    expect(operatingOf(sep)).toEqual({ fixed: 7000, variable: 6000, extraordinary: 2000, total: 15000 })
    expect(operatingOf(sep, { fixedBasis: 'cash' })).toEqual({ fixed: 18000, variable: 6000, extraordinary: 2000, total: 26000 })
    expect(expensesOf(sep)).toBeCloseTo(SALARY + 15000 + 15000)
    expect(resultOf(sep)).toBeCloseTo(incomeOf(sep) - expensesOf(sep))
  })

  test('change: sin porcentaje sobre una base cero o negativa', () => {
    expect(change(150, 100)).toEqual({ base: 100, diff: 50, pct: 50 })
    expect(change(100, -50)).toEqual({ base: -50, diff: 150, pct: null })
    expect(change(100, null)).toBeNull()
  })
})

describe('marginKpisV2 — cascada bruto / operativo / neto', () => {
  test('cada escalón resta un balde real', () => {
    const m = marginKpisV2(sep)
    const income = incomeOf(sep)
    expect(m.income).toBe(income)
    expect(m.gross).toBeCloseTo(income - SALARY - 10000)
    expect(m.operating).toBeCloseTo(m.gross - 7000)
    expect(m.net).toBeCloseTo(m.operating - 6000 - 2000 - 5000)
    expect(m.netPct).toBeCloseTo((m.net / income) * 100)
    expect(m.net).toBeCloseTo(resultOf(sep))
  })

  test('sin ingresos no hay margen', () => {
    expect(marginKpisV2({ ...sep, income: { ...sep.income, bank: { attGross: 0, transGross: 0, attNet: 0, transNet: 0 } } })).toBeNull()
    expect(marginKpisV2(null)).toBeNull()
  })
})

describe('financeQuadrantsV2 — el mes como estado de resultados', () => {
  const q = financeQuadrantsV2(series, 2026, 8)

  test('ingresos, gastos y resultado cierran con personal + funcionamiento', () => {
    expect(q.income).toBe(incomeOf(sep))
    expect(q.expenses).toBeCloseTo(q.personal.total + q.operating.total)
    expect(q.result).toBeCloseTo(q.income - q.expenses)
    expect(q.resultPct).toBeCloseTo((q.result / q.income) * 100)
  })

  test('ya entró y falta salen del estado de cada fila y suman el banco', () => {
    expect(q.collected + q.pending).toBe(q.income)
    expect(q.paidOff).toBe(1)
    expect(q.paidDiff).toBeLessThan(0)
    expect(q.packages).toBe(1)
    expect(q.coveredMonths).toBe(1)
    expect(q.awaitingMonths).toBe(0)
  })

  test('margen promedio: suma de resultados sobre suma de ingresos de la ventana', () => {
    const sumIncome = incomeOf(aug) + incomeOf(sep)
    const sumResult = resultOf(aug) + resultOf(sep)
    expect(q.average.months).toBe(2)
    expect(q.average.pct).toBeCloseTo((sumResult / sumIncome) * 100)
    expect(q.average.resultPerMonth).toBeCloseTo(sumResult / 2)
    // Sin una ventana anterior entera no hay comparación
    expect(q.average.prevWindowPct).toBeNull()
    expect(q.average.vsPrevWindowPp).toBeNull()
  })

  test('variación contra el mes anterior; sin año anterior todavía', () => {
    expect(q.deltas.incomeMoM.diff).toBe(incomeOf(sep) - incomeOf(aug))
    expect(q.deltas.incomeYoY).toBeNull()
    expect(q.prev).toEqual({ year: 2026, month: 7 })
    expect(financeQuadrantsV2(series, 2026, 7).deltas.incomeMoM).toBeNull()
    expect(financeQuadrantsV2(series, 2026, 11)).toBeNull()
  })

  test('con IVA y en base caja', () => {
    expect(financeQuadrantsV2(series, 2026, 8, { withIva: true }).income).toBe(193480)
    expect(financeQuadrantsV2(series, 2026, 8, { basis: 'cash' }).income).toBe(incomeOf(sep, { basis: 'cash' }))
  })
})

describe('bridgeStepsV2 — del ingreso a la ganancia', () => {
  test('resta cada bloque con monto y termina en el resultado', () => {
    const { steps, income, net } = bridgeStepsV2(sep)
    expect(steps.map(s => s.key)).toEqual(['income', 'salaries', 'providers', 'extras', 'fixed', 'variable', 'extraordinary', 'net'])
    expect(income).toBe(incomeOf(sep))
    expect(net).toBeCloseTo(resultOf(sep))
    expect(steps.find(s => s.key === 'extras').amount).toBe(5000)
  })

  test('un bloque en cero no se dibuja', () => {
    expect(bridgeStepsV2(aug).steps.map(s => s.key)).not.toContain('extras')
    expect(bridgeStepsV2(null)).toBeNull()
  })
})

describe('expensesByCategoryV2 — sin personal, contra el mes anterior', () => {
  test('suma por categoría con el detalle por tipo', () => {
    const { rows, total, prevTotal, delta } = expensesByCategoryV2(SEP, AUG, COSTS.fixedTemplates)
    const byLabel = Object.fromEntries(rows.map(r => [r.label, r]))
    expect(byLabel.Alimentación).toMatchObject({ value: 6000, prev: 4000, delta: 2000, deltaPct: 50, byType: { fixed: 0, variable: 6000, extraordinary: 0 } })
    expect(byLabel.Alquiler).toMatchObject({ value: 6000, prev: 6000, delta: 0 })
    expect(byLabel.Seguros).toMatchObject({ value: 1000, prev: 0, deltaPct: null })
    expect(byLabel.Obras.byType.extraordinary).toBe(2000)
    // Limpieza tuvo gasto en agosto y no en septiembre: aparece en 0
    expect(byLabel.Limpieza).toMatchObject({ value: 0, prev: 1500, delta: -1500 })
    expect(total).toBe(6000 + 6000 + 1000 + 2000)
    expect(prevTotal).toBe(4000 + 1500 + 6000)
    expect(delta).toBe(rows.reduce((s, r) => s + r.delta, 0))
  })

  test('fijos en caja: el pago entero en su mes; sin mes anterior no hay variación', () => {
    const { rows, prevTotal, delta } = expensesByCategoryV2(SEP, null, COSTS.fixedTemplates, { fixedBasis: 'cash' })
    expect(rows.find(r => r.label === 'Seguros').value).toBe(12000)
    expect(rows.find(r => r.label === 'Alquiler').prev).toBeNull()
    expect(prevTotal).toBeNull()
    expect(delta).toBeNull()
  })
})

describe('cashAndTaxesV2 — caja e IVA del mes', () => {
  test('banco, cobrado, pendiente y el IVA del servicio por línea', () => {
    const c = cashAndTaxesV2(sep)
    expect(c.bank).toBe(193480)
    expect(c.collected + c.pending).toBe(c.bank)
    expect(c.paidDiff).toBe(-1000)
    expect(c.collectedPct).toBeCloseTo((164360 / 193480) * 100)
    expect(c.cash).toBe(30000)
    expect(c.cashOwnMonth).toBe(30000)
    // IVA: cada fila con su tasa (asistencia 22%, transporte 10%)
    const accrued = sep.income.accrued
    expect(c.vat).toBe(157240 - accrued.attNet - accrued.transNet)
    expect(c.vatTransport).toBe((5120 - 4655) * 2)
    expect(cashAndTaxesV2(null)).toBeNull()
  })
})

describe('lineRevenueV2 — asistencia y transporte por separado', () => {
  test('transporte: participación, penetración y por cliente, contra el mes anterior', () => {
    const t = lineRevenueV2(series, 2026, 8, 'transport', { withIva: true })
    expect(t.revenue).toBe(10240)
    expect(t.clients).toBe(2)
    expect(t.base).toBe(5)
    expect(t.penetrationPct).toBe(40)
    expect(t.perClient).toBe(5120)
    expect(t.sharePct).toBeCloseTo((10240 / 157240) * 100)
    expect(t.mom).toEqual({ base: 5120, diff: 5120, pct: 100 })
    expect(t.yoy).toBeNull()
  })

  test('asistencia no tiene penetración', () => {
    expect(lineRevenueV2(series, 2026, 8, 'attendance').penetrationPct).toBeNull()
    expect(lineRevenueV2(series, 2027, 0, 'attendance')).toBeNull()
  })
})

describe('breakevenV2 — por usuario y punto de equilibrio', () => {
  test('fijos sobre la contribución por usuario', () => {
    const b = breakevenV2(sep)
    const revenue = incomeOf(sep, { basis: 'accrued' })
    const fixedCosts = personalOf(sep).total + 7000 + 2000
    expect(b.users).toBe(5)
    expect(b.revenue).toBe(revenue)
    expect(b.fixedCosts).toBeCloseTo(fixedCosts)
    expect(b.variableCosts).toBe(6000)
    expect(b.contributionPerUser).toBeCloseTo((revenue - 6000) / 5)
    expect(b.breakevenUsers).toBeCloseTo(fixedCosts / ((revenue - 6000) / 5))
    expect(b.safetyMarginPct).toBeCloseTo(((5 - b.breakevenUsers) / 5) * 100)
  })

  test('sin usuarios no hay equilibrio', () => {
    const empty = buildFinanceSeries([{ ...SEP, panel: [] }], COSTS)[0]
    expect(breakevenV2(empty)).toMatchObject({ users: 0, revenuePerUser: null, breakevenUsers: null, safetyMarginPct: null })
  })
})
