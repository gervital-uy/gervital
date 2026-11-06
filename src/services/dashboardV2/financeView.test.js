import { buildFinanceSeries, financeQuadrantsV2 } from './financeSeriesV2'
import {
  KPI_OPTIONS, periodRows, availableYears, hasSameMonthBefore, sameMonthBefore, axisMode, moneyPoint, trendPoint,
  marginPoints, periodTable, moneyHeadline, niceScale, moneyScale, clampTarget, parseTarget, serializeTarget,
  suggestedTarget, packageEffect
} from './financeView'

// Cuatro meses chicos, con montos con IVA que netean redondo (30.500 / 1,22 = 25.000;
// 11.000 / 1,10 = 10.000). month es 0-indexed.
//   jun: dos cuotas
//   jul: más transporte, y cae el pago anual del seguro (12.000, 1.000 por mes)
//   ago: arranca una promo de 3 meses (paquete de 91.500 en el ancla)
//   sep: el mes 2 de la promo no aporta, y un gasto variable grande lo deja en rojo
const row = (id, over = {}) => ({
  client_id: id, attendance_gross: 30500, transport_gross: 0, payment_status: 'pending',
  paid_amount: null, promo_index: null, promo_total_amount: null, promo_id: null, ...over
})
const source = (month, panel, variable = 0) => ({
  year: 2026,
  month,
  panel,
  payments: [],
  variableRows: variable ? [{ year: 2026, month, amount: variable, categoryName: 'Alimentación' }] : [],
  extraordinaryRows: []
})
const PROMO = { promo_id: 'p1', promo_total_amount: 91500 }
const COSTS = {
  employees: [],
  extraCosts: [],
  providers: [{ id: 'p', name: 'Ana', role: 'Chofer', monthlyAmount: 10000, active: true, createdAt: '2026-06-01T12:00:00Z' }],
  fixedTemplates: [{ amount: 12000, periodMonths: 12, startYear: 2026, startMonth: 6, categoryName: 'Seguros' }],
  directorStart: null
}
const SERIES = buildFinanceSeries([
  source(5, [row('a'), row('b')]),
  source(6, [row('a'), row('b', { transport_gross: 11000 })]),
  source(7, [row('a'), row('b'), row('c', { ...PROMO, promo_index: 1 })]),
  source(8, [row('a'), row('b'), row('c', { ...PROMO, promo_index: 2 })], 80000)
], COSTS)

const ym = (year, month) => ({ year, month })

describe('periodRows — el recorte común a las tres vistas', () => {
  test('una ventana termina en el mes elegido y, con menos historia, trae los que hay', () => {
    expect(periodRows(SERIES, ym(2026, 8), { mode: 'window', range: 6 }).map(r => r.month)).toEqual([5, 6, 7, 8])
    expect(periodRows(SERIES, ym(2026, 6), { mode: 'window', range: 6 }).map(r => r.month)).toEqual([5, 6])
    expect(periodRows(SERIES, ym(2026, 8), { mode: 'window', range: 2 }).map(r => r.month)).toEqual([7, 8])
  })

  test('un mes fuera de la serie no trae nada', () => {
    expect(periodRows(SERIES, ym(2026, 11), { mode: 'window', range: 12 })).toEqual([])
    expect(periodRows(null, ym(2026, 8), { mode: 'window', range: 12 })).toEqual([])
  })

  test('el filtro cruza años por meses, sin importar el mes elegido', () => {
    expect(periodRows(SERIES, ym(2026, 5), { mode: 'filter', years: [2026], months: [6, 7] }).map(r => r.month)).toEqual([6, 7])
    expect(periodRows(SERIES, ym(2026, 5), { mode: 'filter', years: [2025], months: [6, 7] })).toEqual([])
  })
})

describe('años e interanual', () => {
  const LONG = [ym(2025, 7), ym(2025, 8), ym(2026, 6), ym(2026, 7)]

  test('los años disponibles salen de la serie', () => {
    expect(availableYears(SERIES)).toEqual([2026])
    expect(availableYears(LONG)).toEqual([2025, 2026])
  })

  test('interanual solo con el mismo mes de un año anterior', () => {
    expect(hasSameMonthBefore(SERIES, 2026, 7)).toBe(false)
    expect(hasSameMonthBefore(LONG, 2026, 7)).toBe(true)
    expect(hasSameMonthBefore(LONG, 2026, 6)).toBe(false)
  })

  test('el comparable es el mismo mes del año anterior más cercano, nunca el de al lado', () => {
    const points = [ym(2024, 8), ym(2025, 8), ym(2026, 7), ym(2026, 8)]
    expect(sameMonthBefore(points, ym(2026, 8))).toEqual(ym(2025, 8))
    expect(sameMonthBefore(points, ym(2026, 7))).toBeNull()
    expect(sameMonthBefore(points, ym(2024, 8))).toBeNull()
  })

  test('el eje se rotula por mes, por año o por los dos', () => {
    expect(axisMode(SERIES, true)).toBe('month')
    expect(axisMode([ym(2025, 8), ym(2026, 8)], false)).toBe('year')
    expect(axisMode([ym(2025, 7), ym(2026, 8)], false)).toBe('monthYear')
    expect(axisMode([ym(2026, 7), ym(2026, 8)], false)).toBe('month')
  })
})

describe('puntos de cada vista', () => {
  test('Pesos: ingreso por línea sin IVA y los fijos en su mes de pago', () => {
    expect(moneyPoint(SERIES[1])).toEqual({
      year: 2026, month: 6, attendance: 50000, transport: 10000, income: 60000,
      personal: 10000, operating: 12000, fixed: 12000, variable: 0, extraordinary: 0, result: 38000
    })
  })

  test('Pesos: el ancla trae el paquete entero y el mes cubierto no aporta', () => {
    expect(moneyPoint(SERIES[2]).income).toBe(125000)
    expect(moneyPoint(SERIES[3]).income).toBe(50000)
    expect(moneyPoint(SERIES[3]).result).toBe(50000 - 10000 - 80000)
  })

  test('Tendencia: el costo es el Total gastos, con los fijos mensualizados', () => {
    expect(trendPoint(SERIES[1])).toEqual({ year: 2026, month: 6, income: 60000, costs: 11000, result: 49000, netPct: (49000 / 60000) * 100 })
    expect(trendPoint(SERIES[1]).costs).toBe(financeQuadrantsV2(SERIES, 2026, 6, KPI_OPTIONS).expenses)
  })

  test('la cifra de Pesos y la del KPI difieren justo en el calendario de los fijos', () => {
    const h = moneyHeadline(SERIES, 2026, 6)
    expect(h.result).toBe(38000)
    expect(h.resultMonthly).toBe(49000)
    expect(h.result - h.resultMonthly).toBe(h.fixedMonthly - h.fixed)
    expect(h.change).toEqual({ base: 40000, diff: -2000, pct: -5 })
    expect(moneyHeadline(SERIES, 2026, 5).change).toBeNull()
    expect(moneyHeadline(SERIES, 2027, 0)).toBeNull()
  })

  test('Márgenes: la cascada cierra con el resultado del KPI y baja de cero', () => {
    const [jun, , , sep] = marginPoints(SERIES)
    expect(jun.grossPct).toBe(80)
    expect(sep.net).toBe(financeQuadrantsV2(SERIES, 2026, 8, KPI_OPTIONS).result)
    expect(sep.netPct).toBeLessThan(0)
    // Un mes sin ingreso no tiene margen
    expect(marginPoints([{ ...SERIES[0], income: { bank: { attGross: 0, transGross: 0, attNet: 0, transNet: 0 } } }])).toEqual([])
  })

  test('la tabla de períodos va del más reciente al más viejo, cada uno contra su año anterior', () => {
    const points = [
      { year: 2025, month: 8, result: 100 },
      { year: 2026, month: 8, result: 150 },
      { year: 2026, month: 7, result: -20 }
    ]
    const table = periodTable(points)
    expect(table.map(p => `${p.year}-${p.month}`)).toEqual(['2026-8', '2026-7', '2025-8'])
    expect(table[0].change).toEqual({ base: 100, diff: 50, pct: 50 })
    expect(table[1].change).toBeNull()
  })
})

describe('escala', () => {
  test('pasos redondos desde el cero', () => {
    expect(niceScale(0, 152500)).toEqual({ min: 0, max: 200000, ticks: [0, 50000, 100000, 150000, 200000] })
  })

  test('con un negativo la escala baja de cero', () => {
    expect(niceScale(-41000, 125000)).toEqual({ min: -50000, max: 150000, ticks: [-50000, 0, 50000, 100000, 150000] })
  })

  test('sin datos no divide por cero', () => {
    const s = niceScale(0, 0)
    expect(s.min).toBe(0)
    expect(s.max).toBeGreaterThan(0)
  })

  test('la vista Pesos incluye el resultado en rojo solo si está prendido', () => {
    const points = SERIES.map(moneyPoint)
    expect(moneyScale(points).min).toBeLessThan(0)
    expect(moneyScale(points, { result: false }).min).toBe(0)
    expect(moneyScale(points, { attendance: false, transport: false, result: false }).max).toBe(100000)
  })

  test('sin nada que dibujar queda solo el cero, no un eje "1, 1, 1, 0, 0"', () => {
    const off = { attendance: false, transport: false, operating: false, personal: false, result: false }
    expect(moneyScale([]).ticks).toEqual([0])
    expect(moneyScale(SERIES.map(moneyPoint), off).ticks).toEqual([0])
  })
})

describe('meta de margen neto', () => {
  test('lo guardado se lee como número o "sin definir"', () => {
    expect(parseTarget(null)).toBeNull()
    expect(parseTarget('')).toBeNull()
    expect(parseTarget('null')).toBeNull()
    expect(parseTarget('15')).toBe(15)
    expect(parseTarget('15,4')).toBe(15)
    expect(parseTarget('99')).toBe(60)
    expect(parseTarget('-30')).toBe(-20)
  })

  test('nunca se guarda null: sin meta es texto vacío', () => {
    expect(serializeTarget(null)).toBe('')
    expect(serializeTarget(undefined)).toBe('')
    expect(serializeTarget(NaN)).toBe('')
    expect(serializeTarget(15.4)).toBe('15')
    expect(serializeTarget(-25)).toBe('-20')
    expect(clampTarget(61)).toBe(60)
  })

  test('la meta sugerida acumula hasta 12 meses cerrados y recién ahí divide', () => {
    const s = suggestedTarget(SERIES, 2026, 7)
    expect(s).toMatchObject({ months: 3, income: 235000, result: 203000, pct: 86, from: ym(2026, 5), to: ym(2026, 7), skipped: [] })
    expect(suggestedTarget(SERIES, 2026, 4)).toBeNull()
  })

  test('deja afuera un mes sin pagos a prestadores cargados: su margen no fue real', () => {
    // La prestadora recién se carga en julio: junio queda sin ese costo
    const late = buildFinanceSeries([
      source(5, [row('a'), row('b')]),
      source(6, [row('a'), row('b', { transport_gross: 11000 })]),
      source(7, [row('a'), row('b'), row('c', { ...PROMO, promo_index: 1 })])
    ], { ...COSTS, providers: [{ ...COSTS.providers[0], createdAt: '2026-07-01T12:00:00Z' }] })
    expect(late[0].costs.providersMissing).toBe(true)
    const s = suggestedTarget(late, 2026, 7)
    expect(s).toMatchObject({ months: 2, from: ym(2026, 6), to: ym(2026, 7), skipped: [ym(2026, 5)] })
    expect(s.income).toBe(60000 + 125000)
    // El margen promedio no lo deja afuera, pero lo nombra
    expect(financeQuadrantsV2(late, 2026, 7, KPI_OPTIONS).average.incompleteMonths).toEqual([ym(2026, 5)])
  })
})

describe('paquetes de promo en el KPI', () => {
  const q = month => financeQuadrantsV2(SERIES, 2026, month, KPI_OPTIONS)

  test('el ancla trae el adelanto del paquete', () => {
    expect(packageEffect(q(7))).toMatchObject({ advance: 50000, covered: 0, net: 50000, packages: 1 })
  })

  test('el mes 2 de una promo sin cobrar espera su paquete: no está cubierto', () => {
    expect(packageEffect(q(8))).toMatchObject({ advance: 0, covered: 0, awaiting: 25000, net: -25000, awaitingMonths: 1 })
  })

  test('con el paquete cobrado, el mes 2 está cubierto y resta su servicio', () => {
    const paid = buildFinanceSeries([source(8, [row('a'), row('c', { ...PROMO, promo_index: 2, payment_status: 'prepaid', paid_amount: 0 })])], COSTS)
    expect(packageEffect(financeQuadrantsV2(paid, 2026, 8, KPI_OPTIONS))).toMatchObject({ covered: 25000, awaiting: 0, net: -25000, coveredMonths: 1 })
  })

  test('un mes sin promos no lleva marca', () => {
    expect(packageEffect(q(5))).toBeNull()
    expect(packageEffect(null)).toBeNull()
  })
})
