import { reconcileShift, reconcileShifts, parkedIds, historicalRoster, withoutParked } from './shiftRoster'

const car = (id, memberIds, seatCount = 4) => ({ id, name: id, seatCount, memberIds })
const members = (r, carIndex = 0) => r.state.cars[carIndex].memberIds

describe('reconcileShift', () => {
  test('returns the same state and parked when cars and unassigned already match the roster', () => {
    const state = { cars: [car('c1', ['ana'])], unassigned: ['beto'] }
    const parked = {}
    const r = reconcileShift(state, ['ana', 'beto'], parked)
    expect(r.state).toBe(state)
    expect(r.parked).toBe(parked)
    expect(r.removedFromCars).toEqual([])
  })

  test('takes out of the car whoever is no longer in the roster and parks them with their car', () => {
    const state = { cars: [car('c1', ['ana', 'beto']), car('c2', ['caro'])], unassigned: [] }
    const r = reconcileShift(state, ['ana', 'caro'])
    expect(members(r)).toEqual(['ana'])
    expect(r.state.cars[1]).toBe(state.cars[1])
    expect(r.state.unassigned).toEqual([])
    expect(r.removedFromCars).toEqual(['beto'])
    expect(r.parked.beto).toMatchObject({ carId: 'c1' })
  })

  test('someone who comes back (falta deshecha) returns to their car and position', () => {
    const out = reconcileShift({ cars: [car('c1', ['ana', 'beto', 'caro'])], unassigned: [] }, ['ana', 'caro'])
    const back = reconcileShift(out.state, ['ana', 'beto', 'caro'], out.parked)
    expect(members(back)).toEqual(['ana', 'beto', 'caro'])
    expect(back.state.unassigned).toEqual([])
    expect(back.parked).toEqual({})
  })

  test('several people leaving in different passes and coming back together recover the original order', () => {
    const start = { cars: [car('c1', ['a', 'b', 'c', 'd'], 5)], unassigned: [] }
    const p1 = reconcileShift(start, ['a', 'c', 'd'])
    const p2 = reconcileShift(p1.state, ['a', 'd'], p1.parked)
    const back = reconcileShift(p2.state, ['a', 'b', 'c', 'd'], p2.parked)
    expect(members(back)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('people leaving in the same pass come back in their original order, whatever the roster order', () => {
    const start = { cars: [car('c1', ['a', 'b', 'c', 'd'], 5)], unassigned: [] }
    const out = reconcileShift(start, ['b', 'd'])
    expect(members(reconcileShift(out.state, ['c', 'b', 'a', 'd'], out.parked))).toEqual(['a', 'b', 'c', 'd'])
  })

  test('only some of them coming back still land next to their neighbours', () => {
    const start = { cars: [car('c1', ['a', 'b', 'c', 'd'], 5)], unassigned: [] }
    const out = reconcileShift(start, ['b', 'd'])
    expect(members(reconcileShift(out.state, ['b', 'c', 'd'], out.parked))).toEqual(['b', 'c', 'd'])
    expect(members(reconcileShift(out.state, ['a', 'b', 'd'], out.parked))).toEqual(['a', 'b', 'd'])
  })

  test('if that car is full or was deleted, the returning person goes to unassigned and stops being parked', () => {
    const out = reconcileShift({ cars: [car('c1', ['ana', 'beto'], 2)], unassigned: [] }, ['ana'])
    const filled = { cars: [{ ...out.state.cars[0], memberIds: ['ana', 'dani'] }], unassigned: [] }
    const full = reconcileShift(filled, ['ana', 'beto', 'dani'], out.parked)
    expect(full.state.unassigned).toEqual(['beto'])
    expect(full.parked).toEqual({})
    const gone = reconcileShift({ cars: [car('c2', [])], unassigned: [] }, ['beto'], out.parked)
    expect(gone.state.unassigned).toEqual(['beto'])
  })

  test('never restores the same person twice, even with a repeated roster id', () => {
    const out = reconcileShift({ cars: [car('c1', ['ana', 'beto'])], unassigned: [] }, ['ana'])
    const back = reconcileShift(out.state, ['ana', 'beto', 'beto'], out.parked)
    expect(members(back)).toEqual(['ana', 'beto'])
    expect(back.state.unassigned).toEqual([])
  })

  test('a new roster member (recupero marcado) goes to unassigned, at the end and in roster order', () => {
    const state = { cars: [car('c1', ['ana'])], unassigned: ['beto'] }
    const r = reconcileShift(state, ['dani', 'ana', 'beto', 'eva'])
    expect(r.state.unassigned).toEqual(['beto', 'dani', 'eva'])
    expect(r.state.cars).toBe(state.cars)
  })

  test('drops from unassigned whoever left the roster, without parking them', () => {
    const r = reconcileShift({ cars: [], unassigned: ['ana', 'beto'] }, ['beto'])
    expect(r.state.unassigned).toEqual(['beto'])
    expect(r.removedFromCars).toEqual([])
    expect(r.parked).toEqual({})
  })

  test('someone sitting in a car is never duplicated into unassigned', () => {
    const state = { cars: [car('c1', ['ana'])], unassigned: ['ana', 'beto'] }
    expect(reconcileShift(state, ['ana', 'beto']).state.unassigned).toEqual(['beto'])
  })

  test('fills unassigned for a freshly built fleet (no members yet)', () => {
    const state = { cars: [car('c1', []), car('c2', [])], unassigned: [] }
    const r = reconcileShift(state, ['ana', 'beto'])
    expect(r.state.unassigned).toEqual(['ana', 'beto'])
    expect(r.state.cars).toBe(state.cars)
  })

  test('does not mutate the input state or parked', () => {
    const state = { cars: [car('c1', ['ana', 'beto'])], unassigned: ['caro'] }
    const out = reconcileShift({ cars: [car('c1', ['ana', 'dani'])], unassigned: [] }, ['ana'])
    const parkedCopy = JSON.parse(JSON.stringify(out.parked))
    reconcileShift(state, ['ana', 'dani'], out.parked)
    expect(state).toEqual({ cars: [car('c1', ['ana', 'beto'])], unassigned: ['caro'] })
    expect(out.parked).toEqual(parkedCopy)
  })
})

describe('reconcileShifts', () => {
  const shifts = () => ({
    morning_arrive: { cars: [car('c1', ['ana', 'beto'])], unassigned: [] },
    morning_leave: { cars: [car('c2', ['ana'])], unassigned: [] }
  })

  test('reconciles every shift, parks per shift and reports each removed client once', () => {
    const r = reconcileShifts(shifts(), { morning_arrive: ['beto'], morning_leave: [] })
    expect(r.shifts.morning_arrive.cars[0].memberIds).toEqual(['beto'])
    expect(r.shifts.morning_leave.cars[0].memberIds).toEqual([])
    expect(r.removedFromCars).toEqual(['ana'])
    expect(Object.keys(r.parked)).toEqual(['morning_arrive', 'morning_leave'])
    expect(parkedIds(r.parked)).toEqual(['ana'])
  })

  test('returns the same objects when nothing changes', () => {
    const input = shifts()
    const parked = {}
    const r = reconcileShifts(input, { morning_arrive: ['ana', 'beto'], morning_leave: ['ana'] }, parked)
    expect(r.shifts).toBe(input)
    expect(r.parked).toBe(parked)
  })

  test('a full round trip (falta y falta deshecha) leaves the day exactly as it was', () => {
    const input = shifts()
    const out = reconcileShifts(input, { morning_arrive: ['beto'], morning_leave: [] })
    const back = reconcileShifts(out.shifts, { morning_arrive: ['ana', 'beto'], morning_leave: ['ana'] }, out.parked)
    expect(back.shifts).toEqual(input)
    expect(parkedIds(back.parked)).toEqual([])
  })

  test('leaves a shift untouched when its roster is missing (not computed)', () => {
    const input = shifts()
    expect(reconcileShifts(input, { morning_arrive: ['ana', 'beto'] }).shifts).toBe(input)
  })
})

describe('historicalRoster', () => {
  const known = new Set(['ana', 'beto', 'caro', 'dani', 'hugo'])

  test('on a past day keeps in the car whoever has no absence, even if today they would not be in the roster', () => {
    const state = { cars: [car('c1', ['ana', 'beto', 'caro'])], unassigned: [] }
    expect(historicalRoster(['ana'], state, new Set(['caro']), known)).toEqual(['ana', 'beto'])
  })

  test('also keeps whoever was moved to unassigned on that past day', () => {
    const state = { cars: [car('c1', [])], unassigned: ['hugo'] }
    expect(historicalRoster([], state, new Set(), known)).toEqual(['hugo'])
  })

  test('keeps in the car someone who is no longer a known client (baja): the trip happened', () => {
    const state = { cars: [car('c1', ['ana', 'ghost'])], unassigned: ['ghost2'] }
    expect(historicalRoster(['ana'], state, new Set(), known)).toEqual(['ana', 'ghost'])
  })

  test('still adds the day roster (recuperos) and never duplicates', () => {
    const state = { cars: [car('c1', ['ana'])], unassigned: ['ana'] }
    expect(historicalRoster(['dani', 'ana'], state, new Set(), known)).toEqual(['dani', 'ana'])
  })
})

describe('withoutParked', () => {
  test('removes only the entries that were saved, keeping the ones parked afterwards', () => {
    const saved = reconcileShifts({ s: { cars: [car('c1', ['ana', 'beto'])], unassigned: [] } }, { s: ['beto'] }).parked
    const later = reconcileShifts({ s: { cars: [car('c1', ['beto', 'caro'])], unassigned: [] } }, { s: ['beto'] }, saved).parked
    expect(parkedIds(withoutParked(later, saved))).toEqual(['caro'])
    expect(withoutParked(saved, saved)).toEqual({})
  })
})
