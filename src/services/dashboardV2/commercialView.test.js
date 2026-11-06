import { ageOn, ageRangeOf, apportion, composition, revenueMix, buildCommercial, UNKNOWN_SEGMENT } from './commercialView'
import { DEFAULT_SHIFT_CAPACITY } from './occupancy'

const PRICING = {
  planPricing: [
    { frequency: 1, schedule: 'afternoon', priceNet: 16393.44, effectiveYear: 2000, effectiveMonth: 0 },
    { frequency: 2, schedule: 'afternoon', priceNet: 24590.16, effectiveYear: 2000, effectiveMonth: 0 },
    { frequency: 5, schedule: 'full_day', priceNet: 66393.44, effectiveYear: 2000, effectiveMonth: 0 }
  ],
  transportPricing: [{ frequency: 2, distanceRange: '0_to_2km', priceNet: 4654.55, effectiveYear: 2000, effectiveMonth: 0 }]
}

const client = (id, over = {}) => ({
  id, firstName: id, lastName: 'X', clientType: 'regular', startDate: '2026-06-01', birthDate: '1940-05-10', cognitiveLevel: 'B', distanceRange: '0_to_2km', ...over
})
const plan = (clientId, over = {}) => ({
  clientId, effectiveFrom: '2026-06-01', frequency: 2, schedule: 'afternoon', hasTransport: false, assignedDays: ['tuesday', 'thursday'], ...over
})

describe('edad y tramos', () => {
  test('edad cumplida al día de corte', () => {
    expect(ageOn('1940-11-06', '2026-11-06')).toBe(86)
    expect(ageOn('1940-11-07', '2026-11-06')).toBe(85)
    expect(ageOn(null, '2026-11-06')).toBeNull()
    expect(ageRangeOf(74)).toBe('upTo74')
    expect(ageRangeOf(75)).toBe('75to79')
    expect(ageRangeOf(97)).toBe('90plus')
    expect(ageRangeOf(null)).toBe(UNKNOWN_SEGMENT)
  })
})

test('apportion reparte un total entero sin perder pesos', () => {
  // Suben los de mayor resto
  expect(apportion([10.5, 20.7, 30.8], 62)).toEqual([10, 21, 31])
  expect(apportion([10.4, 20.4], 30)).toEqual([10, 20])
  // Si el total redondeado queda por debajo de los pisos, baja el de menor resto
  expect(apportion([1.1, 2.3], 2)).toEqual([0, 2])
  expect(apportion([], 0)).toEqual([])
})

describe('composición y aporte', () => {
  const value = total => ({ attendanceList: total, attendance: total, transport: 0, total, missing: null })
  const members = [
    { client: client('a', { cognitiveLevel: 'A', birthDate: '1950-01-01' }), plan: { frequency: 2, schedule: 'afternoon' }, value: value(24590.16) },
    { client: client('b', { cognitiveLevel: 'D', birthDate: '1930-01-01' }), plan: { frequency: 5, schedule: 'full_day' }, value: value(66393.44) },
    { client: client('c', { cognitiveLevel: null, birthDate: null }), plan: { frequency: 2, schedule: 'afternoon' }, value: value(24590.16) }
  ]

  test('composición en el orden de la escala, sin dato al final', () => {
    expect(composition(members, 'frequency', '2026-10-31')).toEqual([
      { key: 2, label: '2× semana', value: 2 },
      { key: 5, label: '5× semana', value: 1 }
    ])
    expect(composition(members, 'cognitiveLevel', '2026-10-31').map(r => [r.label, r.value])).toEqual([['Tier A', 1], ['Tier D', 1], ['Sin dato', 1]])
    expect(composition(members, 'age', '2026-10-31').map(r => r.label)).toEqual(['75 a 79', '90 o más', 'Sin dato'])
    expect(composition(members, 'schedule', '2026-10-31').map(r => r.label)).toEqual(['Tarde', 'Día completo'])
  })

  test('aporte: el MRR de cada segmento suma exacto el total; pp = plata − gente', () => {
    const mix = revenueMix(members, 'schedule', '2026-10-31')
    expect(mix.map(r => [r.key, r.value, r.clients])).toEqual([['full_day', 66394, 1], ['afternoon', 49180, 2]])
    expect(mix.reduce((s, r) => s + r.value, 0)).toBe(115574)
    expect(mix[0].pp).toBeCloseTo((66393.44 / 115573.76) * 100 - 100 / 3)
  })
})

describe('buildCommercial', () => {
  // a heredado 2× tarde con transporte y 10% en octubre; b heredado de día completo
  // que se va el 15 de octubre; c alta de septiembre 1× tarde.
  const sources = {
    ...PRICING,
    clients: [
      client('a'),
      client('b', { cognitiveLevel: 'D', birthDate: '1931-02-01' }),
      client('c', { startDate: '2026-09-10', cognitiveLevel: 'A', birthDate: null })
    ],
    periods: [{ clientId: 'b', fromDate: '2026-10-15', toDate: null, reason: 'health_decline' }],
    followups: [],
    plans: [
      plan('a', { hasTransport: true }),
      plan('b', { frequency: 5, schedule: 'full_day', assignedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }),
      plan('c', { effectiveFrom: '2026-09-01', frequency: 1, assignedDays: ['friday'] })
    ],
    discounts: [{ clientId: 'a', year: 2026, month: 9, discountPercent: 10 }],
    reasons: [{ key: 'health_decline', label: 'Deterioro de salud', color: '#dc2626', sortOrder: 3 }],
    shiftCapacity: '20'
  }
  const model = buildCommercial(sources, { today: '2026-11-06' })
  const oct = model.month(model.indexOf(2026, 9))

  test('un mes fuera de la ventana no existe', () => {
    expect(model.month(-1)).toBeNull()
    expect(model.month(99)).toBeNull()
    expect(model.indexOf(2026, 4)).toBe(-1)
  })

  test('clientes activos y churn', () => {
    expect(oct.counts).toMatchObject({ opening: 3, altas: 0, bajas: 1, closing: 2 })
    expect(oct.clients).toMatchObject({ active: 2, mom: { base: 3, diff: -1 }, yoy: null })
    expect(oct.churn.month).toBeCloseTo(100 / 3)
    expect(oct.churn.window).toMatchObject({ months: 5, bajas: 1 })
  })

  test('MRR del cierre, con el descuento y el transporte, y su puente', () => {
    // a: 24590,16 × 0,9 + 4654,55; c: 16393,44
    expect(oct.mrr.closing).toMatchObject({ attendanceList: 40984, discount: 2459, attendance: 38525, transport: 4655, total: 43180 })
    expect(oct.mrr.lost.total).toBe(66393)
    expect(oct.mrr.opening + oct.mrr.gained.total - oct.mrr.lost.total + oct.mrr.other).toBe(oct.mrr.closing.total)
    expect(oct.mrr.mom.base).toBe(oct.mrr.opening)
    expect(oct.mrr.window.months).toBe(5)
  })

  test('composición, aporte y ocupación hablan de los mismos activos', () => {
    for (const rows of Object.values(oct.composition)) expect(rows.reduce((s, r) => s + r.value, 0)).toBe(2)
    for (const rows of Object.values(oct.mix)) expect(rows.reduce((s, r) => s + r.value, 0)).toBe(oct.mrr.closing.total)
    expect(oct.composition.age.map(r => r.label)).toEqual(['85 a 89', 'Sin dato'])
    // a: martes y jueves de tarde; c: viernes de tarde (b ya se fue)
    expect(oct.occupancy.shifts[1].cells.map(c => c.users)).toEqual([0, 1, 0, 1, 1])
    expect(oct.occupancy.shifts[0].sold).toBe(0)
    expect(oct.occupancy).toMatchObject({ capacity: 20, isDefaultCapacity: false })
    expect(oct.occupancy.revenuePerSeat).toBeCloseTo(43180 / oct.occupancy.seatsMonth)
    expect(oct.occupancy.revenuePerSoldSeat).toBeCloseTo(43180 / oct.occupancy.sold)
    // En septiembre b todavía ocupaba la mañana: la ocupación general bajó
    expect(oct.occupancy.delta).toBeLessThan(0)
  })

  test('permanencia, flujo, bajas por motivo y cohortes salen del mismo mes', () => {
    expect(oct.tenure).toMatchObject({ measured: 1, inherited: 1 })
    expect(oct.flow.map(f => f.month)).toEqual([5, 6, 7, 8, 9])
    expect(oct.sameMonth(9)).toHaveLength(1)
    expect(oct.exitsByReason(12).rows).toEqual([{ key: 'health_decline', label: 'Deterioro de salud', color: '#dc2626', sortOrder: 3, value: 1, pauses: 0 }])
    expect(oct.cohorts('month').rows.find(r => r.key === '2026-09').size).toBe(1)
    expect(model.month(model.indexOf(2026, 9))).toBe(oct)
  })

  test('probar otro aforo recalcula la ocupación sin tocar la guardada', () => {
    const sim = oct.simulateOccupancy(10)
    expect(sim).toMatchObject({ capacity: 10, simulated: true, isDefaultCapacity: false, sold: oct.occupancy.sold })
    expect(sim.pct).toBeCloseTo(oct.occupancy.pct * 2)
    expect(oct.occupancy).toMatchObject({ capacity: 20, simulated: false })
  })

  test('sin aforo guardado usa el de por defecto y lo marca', () => {
    const fallback = buildCommercial({ ...sources, shiftCapacity: null }, { today: '2026-11-06' })
    expect(fallback).toMatchObject({ capacity: DEFAULT_SHIFT_CAPACITY, isDefaultCapacity: true })
    expect(fallback.month(4).occupancy.isDefaultCapacity).toBe(true)
  })
})
