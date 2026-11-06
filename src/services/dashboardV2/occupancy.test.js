import { parseShiftCapacity, isValidShiftCapacity, weekdayCounts, occupancy, DEFAULT_SHIFT_CAPACITY, SHIFT_CAPACITY_RANGE } from './occupancy'

describe('aforo', () => {
  test('lo guardado si es un entero válido; si no, el de por defecto marcado', () => {
    expect(parseShiftCapacity('25')).toEqual({ capacity: 25, isDefault: false })
    expect(parseShiftCapacity(' 40 ')).toEqual({ capacity: 40, isDefault: false })
    for (const v of [null, undefined, '', 'abc', '0', '12.5', '500', '-3']) {
      expect(parseShiftCapacity(v)).toEqual({ capacity: DEFAULT_SHIFT_CAPACITY, isDefault: true })
    }
  })

  test('el rango es el que el gráfico de un cuadrito por lugar puede dibujar', () => {
    expect(SHIFT_CAPACITY_RANGE).toEqual({ min: 5, max: 60 })
    expect(isValidShiftCapacity('5')).toBe(true)
    expect(isValidShiftCapacity('60')).toBe(true)
    expect(isValidShiftCapacity('4')).toBe(false)
    expect(isValidShiftCapacity('61')).toBe(false)
    expect(isValidShiftCapacity(DEFAULT_SHIFT_CAPACITY)).toBe(true)
  })
})

test('días hábiles de cada día de semana en el mes', () => {
  // octubre 2026 arranca un jueves
  expect(weekdayCounts(2026, 9)).toEqual([4, 4, 4, 5, 5])
  // febrero 2027: cuatro de cada uno
  expect(weekdayCounts(2027, 1)).toEqual([4, 4, 4, 4, 4])
})

describe('ocupación de octubre 2026', () => {
  const seats = [
    { schedule: 'full_day', assignedDays: ['tuesday', 'thursday'], tier: 'C', paying: true },
    { schedule: 'morning', assignedDays: ['tuesday'], tier: 'A', paying: true },
    { schedule: 'afternoon', assignedDays: ['monday', 'thursday', 'thursday', 'saturday'], tier: 'D', paying: true },
    // No paga (no facturable o a prueba): ocupa lugar, no es un lugar vendido
    { schedule: 'afternoon', assignedDays: ['thursday'], tier: null, paying: false },
    // Sin plan: no ocupa nada
    { schedule: undefined, assignedDays: undefined, tier: 'B', paying: true }
  ]
  const o = occupancy(seats, { year: 2026, month: 9, capacity: 10 })
  const [am, pm] = o.shifts

  test('día completo ocupa los dos turnos; mañana y tarde, el suyo', () => {
    expect(am.cells.map(c => c.users)).toEqual([0, 2, 0, 1, 0])
    expect(pm.cells.map(c => c.users)).toEqual([1, 1, 0, 3, 0])
  })

  test('tiers y alta dependencia por casillero', () => {
    expect(pm.cells[3].tiers).toEqual({ A: 0, B: 0, C: 1, D: 1, unknown: 1 })
    expect(pm.cells[3]).toMatchObject({ dependents: 2, free: 7, pct: 30, dates: 5, label: 'Jueves' })
  })

  test('lugares ocupados y vendidos del mes, pesados por las veces que cae cada día', () => {
    // AM: martes 2 × 4 + jueves 1 × 5; PM: lunes 4 + martes 4 + jueves 3 × 5
    expect(am).toMatchObject({ taken: 13, sold: 13 })
    // De los tres del jueves a la tarde, uno no paga: 5 lugares ocupados no vendidos
    expect(pm).toMatchObject({ taken: 23, sold: 18 })
    expect(pm.cells[3]).toMatchObject({ users: 3, paying: 2 })
    expect(o).toMatchObject({ capacity: 10, workdays: 22, seatsPerShift: 220, seatsMonth: 440, taken: 36, sold: 31 })
    // La ocupación es sobre los ocupados, paguen o no
    expect(am.pct).toBeCloseTo((13 / 220) * 100)
    expect(o.pct).toBeCloseTo((36 / 440) * 100)
    expect(pm.perDay).toBeCloseTo(23 / 22)
    expect(pm.free).toBeCloseTo(10 - 23 / 22)
  })

  test('el día más cargado, el más libre y dónde entra uno más', () => {
    expect(pm.busiest.weekday).toBe('thursday')
    expect(pm.quietest.weekday).toBe('wednesday')
    expect(pm.mostDependents.weekday).toBe('thursday')
    // Empatan miércoles y viernes con 10 libres y nadie dependiente: gana el primero
    expect(pm.mostRoom.weekday).toBe('wednesday')
  })

  test('sin clientes ni aforo no se rompe', () => {
    const empty = occupancy([], { year: 2026, month: 9, capacity: 0 })
    expect(empty.pct).toBeNull()
    expect(empty.shifts[0].cells[0].pct).toBeNull()
  })
})
