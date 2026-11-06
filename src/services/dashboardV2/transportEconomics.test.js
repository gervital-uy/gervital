import { buildTransportEconomics, NO_BAND } from './transportEconomics'

// Septiembre de 2026 (month 8). Montos de transporte con IVA (10%).
const panelRow = (id, transport, over = {}) => ({ client_id: id, attendance_gross: 30000, transport_gross: transport, ...over })

const CLIENTS = [
  { id: 'a', distanceRange: '0_to_2km' },
  { id: 'b', distanceRange: '2_to_5km' },
  { id: 'c', distanceRange: '5_to_10km' },
  { id: 'd', distanceRange: null },
  { id: 'e', distanceRange: '2_to_5km' }
]

const driver = (name, amount, over = {}) => ({ id: name, name, role: 'Chofer', monthlyAmount: amount, active: true, createdAt: '2026-09-08T18:00:00+00:00', ...over })

const base = {
  year: 2026,
  month: 8,
  panel: [panelRow('a', 5120), panelRow('b', 8320), panelRow('c', 10240), panelRow('d', 2560), panelRow('e', 0)],
  clients: CLIENTS,
  cars: [
    // Dos tramos con pasajeros el 1, uno el 2; un auto vacío no es tramo
    { date: '2026-09-01', shift: 'morning_arrive', seatCount: 4, clientIds: ['a', 'b'] },
    { date: '2026-09-01', shift: 'afternoon_leave', seatCount: 4, clientIds: ['a', 'b', 'c', 'e'] },
    { date: '2026-09-02', shift: 'morning_arrive', seatCount: 4, clientIds: ['c'] },
    { date: '2026-09-02', shift: 'morning_leave', seatCount: 4, clientIds: [] },
    // Fuera del mes
    { date: '2026-10-01', shift: 'morning_arrive', seatCount: 4, clientIds: ['a'] }
  ],
  tripCounts: [
    { clientId: 'a', date: '2026-09-01', tripCount: 2 },
    { clientId: 'b', date: '2026-09-01', tripCount: 2 },
    { clientId: 'c', date: '2026-09-01', tripCount: 1 },
    { clientId: 'c', date: '2026-09-02', tripCount: 1 },
    // e viajó sin transporte cobrado
    { clientId: 'e', date: '2026-09-01', tripCount: 1 },
    { clientId: 'a', date: '2026-10-01', tripCount: 1 }
  ],
  providers: [
    driver('Waldemar', 60000),
    driver('Rafael', 30000),
    { id: 'x', name: 'Contador', role: 'Contador', monthlyAmount: 16500, active: true, createdAt: '2026-09-08T18:00:00+00:00' }
  ]
}

describe('buildTransportEconomics — lo que cobra contra lo que cuesta', () => {
  const t = buildTransportEconomics(base)
  const band = key => t.bands.find(b => b.band === key)

  test('cobra: la línea de transporte sin el 10% de IVA, por banda de la ficha', () => {
    expect(band('0_to_2km')).toMatchObject({ revenueGross: 5120, revenueNet: 4655, clients: 1 })
    expect(band('2_to_5km')).toMatchObject({ revenueGross: 8320, revenueNet: 7564, clients: 1 })
    expect(band(NO_BAND)).toMatchObject({ revenueGross: 2560, revenueNet: 2327 })
    expect(t.revenueNet).toBe(4655 + 7564 + 9309 + 2327)
    expect(t.billedClients).toBe(4)
  })

  test('cuesta: solo los choferes, en partes iguales por tramo y por pasajero', () => {
    expect(t.cost).toBe(90000)
    expect(t.drivers.map(d => d.name)).toEqual(['Waldemar', 'Rafael'])
    expect(t.legs).toBe(3)
    expect(t.costPerLeg).toBe(30000)
    // a: 30.000/2 + 30.000/4; c: 30.000/4 + 30.000
    expect(band('0_to_2km').cost).toBe(15000 + 7500)
    expect(band('5_to_10km').cost).toBe(7500 + 30000)
    // b y e (2 a 5 km): 15.000 + 7.500 + 7.500
    expect(band('2_to_5km').cost).toBe(30000)
    const allocated = t.bands.reduce((s, b) => s + b.cost, 0)
    expect(allocated).toBe(t.cost)
    expect(band('0_to_2km').margin).toBe(4655 - 22500)
    expect(t.margin).toBe(t.revenueNet - 90000)
  })

  test('tramos, viajes y ocupación', () => {
    expect(t).toMatchObject({ seats: 12, passengers: 7, trips: 7, days: 2, legsPerDay: 1.5 })
    expect(t.occupancyPct).toBeCloseTo((7 / 12) * 100)
    expect(t.costPerTrip).toBeCloseTo(90000 / 7)
    expect(band('5_to_10km')).toMatchObject({ trips: 2, riders: 1, passengers: 2 })
  })

  test('quien viaja sin transporte cobrado queda a la vista', () => {
    expect(t.unbilledClients).toBe(1)
    expect(t.unbilledTrips).toBe(1)
    expect(band('2_to_5km').unbilledTrips).toBe(1)
    expect(t.riders).toBe(4)
  })

  test('sin choferes cargados el costo no se conoce (no es cero)', () => {
    const before = buildTransportEconomics({ ...base, providers: [driver('Waldemar', 60000, { createdAt: '2026-10-01T15:00:00+00:00' })] })
    expect(before).toMatchObject({ costKnown: false, cost: null, margin: null, costPerLeg: null, costPerTrip: null })
    expect(before.bands.every(b => b.cost === null && b.margin === null)).toBe(true)
  })

  test('choferes sin tramos programados: el costo queda sin repartir', () => {
    const empty = buildTransportEconomics({ ...base, cars: [], tripCounts: [] })
    expect(empty).toMatchObject({ cost: 90000, unallocatedCost: 90000, legs: 0, occupancyPct: null, legsPerDay: null })
  })

  test('el mes en curso se marca abierto', () => {
    expect(buildTransportEconomics({ ...base, today: '2026-09-15' }).open).toBe(true)
    expect(t.open).toBe(false)
  })
})
