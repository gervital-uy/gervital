import {
  indexPlans, planForMonth, indexDiscounts, monthlyValue, createValuer, sumValues, runRateSeries, runRateWindow, discountKey
} from './runRate'
import { buildTimeline } from './activityTimeline'

// Listas de precios netas como las guarda la base: una versión base y una que
// cambia desde agosto 2026 (month 7).
const PLAN_PRICING = [
  { frequency: 2, schedule: 'afternoon', priceNet: 24590.16, effectiveYear: 2000, effectiveMonth: 0 },
  { frequency: 3, schedule: 'afternoon', priceNet: 31967.21, effectiveYear: 2000, effectiveMonth: 0 },
  { frequency: 2, schedule: 'full_day', priceNet: 39344.26, effectiveYear: 2000, effectiveMonth: 0 },
  { frequency: 2, schedule: 'afternoon', priceNet: 26000, effectiveYear: 2026, effectiveMonth: 7 }
]
const TRANSPORT_PRICING = [
  { frequency: 2, distanceRange: '2_to_5km', priceNet: 7563.64, effectiveYear: 2000, effectiveMonth: 0 },
  { frequency: 3, distanceRange: '2_to_5km', priceNet: 11345.45, effectiveYear: 2000, effectiveMonth: 0 }
]
const PRICING = { planPricing: PLAN_PRICING, transportPricing: TRANSPORT_PRICING }

const plan = (clientId, effectiveFrom, over = {}) => ({
  clientId, effectiveFrom, frequency: 2, schedule: 'afternoon', hasTransport: false, assignedDays: ['tuesday', 'thursday'], ...over
})

describe('plan vigente', () => {
  const versions = indexPlans([plan('a', '2026-09-01', { frequency: 3 }), plan('a', '2026-06-01'), plan('b', '2026-07-01')])

  test('la versión más nueva que arranca a más tardar el 1 del mes', () => {
    expect(planForMonth(versions.get('a'), 2026, 7).frequency).toBe(2)
    expect(planForMonth(versions.get('a'), 2026, 8).frequency).toBe(3)
    expect(planForMonth(versions.get('a'), 2026, 10).frequency).toBe(3)
  })

  test('antes de todas, la más vieja (como calculate_month_billing); sin versiones, nada', () => {
    expect(planForMonth(versions.get('b'), 2026, 5).effectiveFrom).toBe('2026-07-01')
    expect(planForMonth(undefined, 2026, 5)).toBeNull()
  })
})

describe('lo que vale un cliente en un mes', () => {
  test('neto de lista, con el descuento solo sobre la asistencia y el transporte pleno', () => {
    const v = monthlyValue({ plan: plan('a', '2026-06-01', { hasTransport: true }), distanceRange: '2_to_5km', discountPercent: 10 }, PRICING, 2026, 6)
    expect(v.attendanceList).toBeCloseTo(24590.16)
    expect(v.attendance).toBeCloseTo(24590.16 * 0.9)
    expect(v.discount).toBeCloseTo(2459.016)
    expect(v.transport).toBeCloseTo(7563.64)
    expect(v.total).toBeCloseTo(24590.16 * 0.9 + 7563.64)
    expect(v.missing).toBeNull()
  })

  test('el precio vigente del mes', () => {
    expect(monthlyValue({ plan: plan('a', '2026-06-01') }, PRICING, 2026, 6).attendanceList).toBeCloseTo(24590.16)
    expect(monthlyValue({ plan: plan('a', '2026-06-01') }, PRICING, 2026, 7).attendanceList).toBe(26000)
  })

  test('lo que falta se avisa y vale 0', () => {
    expect(monthlyValue({ plan: null }, PRICING, 2026, 6)).toMatchObject({ total: 0, missing: 'plan' })
    expect(monthlyValue({ plan: plan('a', '2026-06-01', { frequency: 5 }) }, PRICING, 2026, 6)).toMatchObject({ total: 0, missing: 'price' })
    const noDistance = monthlyValue({ plan: plan('a', '2026-06-01', { hasTransport: true }), distanceRange: null }, PRICING, 2026, 6)
    expect(noDistance).toMatchObject({ transport: 0, missing: 'distance' })
    expect(noDistance.attendance).toBeCloseTo(24590.16)
    // Un descuento fuera de rango se acota
    expect(monthlyValue({ plan: plan('a', '2026-06-01'), discountPercent: 150 }, PRICING, 2026, 6).attendance).toBe(0)
  })

  test('el valuador usa el descuento de ese mes de ese cliente', () => {
    const discounts = [{ clientId: 'a', year: 2026, month: 9, discountPercent: 20 }, { clientId: 'a', year: 2026, month: 8, discountPercent: 0 }]
    expect([...indexDiscounts(discounts).keys()]).toEqual([discountKey('a', 2026, 9)])
    const valuer = createValuer({
      ...PRICING,
      plans: [plan('a', '2026-06-01', { hasTransport: true })],
      discounts,
      clients: [{ id: 'a', distanceRange: '2_to_5km' }]
    })
    expect(valuer('a', 2026, 9).attendance).toBeCloseTo(26000 * 0.8)
    expect(valuer('a', 2026, 8).discountPercent).toBe(0)
    expect(valuer('a', 2026, 9).transport).toBeCloseTo(7563.64)
    expect(valuer('a', 2026, 9)).toBe(valuer('a', 2026, 9))
    expect(valuer('zz', 2026, 9).missing).toBe('plan')
  })
})

describe('sumValues', () => {
  test('redondea por componente y cierra exacto: lista − descuentos + transporte = total', () => {
    const s = sumValues([
      { attendanceList: 24590.16, attendance: 22131.144, transport: 7563.64, missing: null },
      { attendanceList: 31967.21, attendance: 31967.21, transport: 0, missing: 'distance' }
    ])
    expect(s).toEqual({ attendanceList: 56557, discount: 2459, attendance: 54098, transport: 7564, total: 61662, count: 2, missing: 1 })
    expect(s.attendanceList - s.discount + s.transport).toBe(s.total)
    expect(sumValues([])).toMatchObject({ total: 0, count: 0 })
  })
})

describe('MRR por mes', () => {
  // h1 heredado que sube de plan en septiembre; h2 heredado que se va en julio;
  // n1 alta de agosto con transporte.
  const sources = {
    clients: [
      { id: 'h1', clientType: 'regular', startDate: '2026-06-01' },
      { id: 'h2', clientType: 'regular', startDate: '2026-06-01', deactivationDate: '2026-07-10' },
      { id: 'n1', clientType: 'regular', startDate: '2026-08-20', distanceRange: '2_to_5km' }
    ],
    periods: [{ clientId: 'h2', fromDate: '2026-07-10', toDate: null, reason: 'other' }],
    followups: [],
    plans: [plan('h1', '2026-06-01'), plan('h1', '2026-09-01', { frequency: 3 }), plan('h2', '2026-06-01'), plan('n1', '2026-08-01', { hasTransport: true })],
    discounts: [{ clientId: 'h1', year: 2026, month: 6, discountPercent: 10 }],
    ...PRICING
  }
  const timeline = buildTimeline(sources, { today: '2026-09-15' })
  const series = runRateSeries(timeline, createValuer(sources))

  test('apertura + ganado − perdido + otros = cierre, todos los meses', () => {
    for (const r of series) expect(r.opening + r.gained.total - r.lost.total + r.other).toBe(r.closing.total)
  })

  test('el mes del lanzamiento abre con la base heredada; las altas y bajas valen lo de su mes', () => {
    expect(series[0]).toMatchObject({ opening: 49180, other: 0 })
    expect(series[0].closing.total).toBe(49180)
    // jul: h2 se va (vale su cuota de julio) y h1 tiene 10% de descuento
    expect(series[1].lost.total).toBe(24590)
    expect(series[1].closing).toMatchObject({ attendanceList: 24590, discount: 2459, total: 22131 })
    expect(series[1].other).toBe(-2459)
    // ago: alta de n1 con transporte, a la lista nueva
    expect(series[2].gained).toMatchObject({ attendance: 26000, transport: 7564, total: 33564 })
    // sep: h1 pasa a 3× (cambio de plan: residuo)
    expect(series[3].other).toBe(31967 - 26000)
  })

  test('ventana de ganado y perdido', () => {
    expect(runRateWindow(series, 3, 12)).toMatchObject({ months: 4, gained: 33564, lost: 24590, net: 8974 })
    expect(runRateWindow(series, 3, 2)).toMatchObject({ months: 2, gained: 33564, lost: 0 })
    expect(runRateWindow(series, 3, 2).avgGained).toBe(16782)
  })
})
