import { isInactiveOn, isInactiveThroughout } from './inactivityPeriods'

describe('isInactiveOn', () => {
  const periods = [{ fromDate: '2026-03-10', toDate: '2026-06-15' }]

  test('día antes del período: activo', () => {
    expect(isInactiveOn('2026-03-09', periods)).toBe(false)
  })
  test('primer día del gap (from inclusive): inactivo', () => {
    expect(isInactiveOn('2026-03-10', periods)).toBe(true)
  })
  test('día en medio del gap: inactivo', () => {
    expect(isInactiveOn('2026-05-01', periods)).toBe(true)
  })
  test('día de reintegro (to exclusive): activo', () => {
    expect(isInactiveOn('2026-06-15', periods)).toBe(false)
  })
  test('período abierto (to null): inactivo desde from en adelante', () => {
    expect(isInactiveOn('2027-01-01', [{ fromDate: '2026-03-10', toDate: null }])).toBe(true)
  })
  test('múltiples períodos: matchea cualquiera', () => {
    const two = [
      { fromDate: '2026-03-10', toDate: '2026-06-15' },
      { fromDate: '2026-09-01', toDate: null }
    ]
    expect(isInactiveOn('2026-07-01', two)).toBe(false)
    expect(isInactiveOn('2026-09-02', two)).toBe(true)
  })
  test('sin períodos / null: activo', () => {
    expect(isInactiveOn('2026-05-01', [])).toBe(false)
    expect(isInactiveOn('2026-05-01', null)).toBe(false)
  })
})

describe('isInactiveThroughout', () => {
  test('un período abierto que arranca antes del rango lo cubre entero', () => {
    expect(isInactiveThroughout('2027-01-01', '2027-03-31', [{ fromDate: '2026-11-15', toDate: null }])).toBe(true)
  })
  test('un período abierto que arranca dentro del rango no lo cubre', () => {
    expect(isInactiveThroughout('2027-01-01', '2027-03-31', [{ fromDate: '2027-02-10', toDate: null }])).toBe(false)
  })
  test('reintegro dentro del rango (to exclusive): hay días activos', () => {
    expect(isInactiveThroughout('2027-01-01', '2027-03-31', [{ fromDate: '2026-11-15', toDate: '2027-02-01' }])).toBe(false)
    expect(isInactiveThroughout('2027-01-01', '2027-03-31', [{ fromDate: '2026-11-15', toDate: '2027-03-31' }])).toBe(false)
  })
  test('reintegro el día después del rango: inactivo todo el rango', () => {
    expect(isInactiveThroughout('2027-01-01', '2027-03-31', [{ fromDate: '2026-11-15', toDate: '2027-04-01' }])).toBe(true)
  })
  test('períodos encadenados cubren el rango; con un hueco, no', () => {
    const chained = [{ fromDate: '2027-01-15', toDate: '2027-05-01' }, { fromDate: '2026-12-01', toDate: '2027-01-15' }]
    expect(isInactiveThroughout('2027-01-01', '2027-03-31', chained)).toBe(true)
    const gap = [{ fromDate: '2026-12-01', toDate: '2027-01-15' }, { fromDate: '2027-01-16', toDate: null }]
    expect(isInactiveThroughout('2027-01-01', '2027-03-31', gap)).toBe(false)
  })
  test('sin períodos / null: activo', () => {
    expect(isInactiveThroughout('2027-01-01', '2027-03-31', [])).toBe(false)
    expect(isInactiveThroughout('2027-01-01', '2027-03-31', null)).toBe(false)
  })
})
