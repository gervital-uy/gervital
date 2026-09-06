import { providerCostForMonth } from './serviceProviderCalc'

const p = (monthlyAmount, active = true) => ({ monthlyAmount, active })

describe('providerCostForMonth', () => {
  test('suma los montos de los prestadores activos', () => {
    expect(providerCostForMonth([p(44000), p(28000), p(16500), p(26000)])).toBe(114500)
  })

  test('los dados de baja no suman', () => {
    expect(providerCostForMonth([p(44000), p(28000, false)])).toBe(44000)
  })

  test('el monto mensual es el monto mensual (no se mensualiza un anual)', () => {
    expect(providerCostForMonth([p(12000)])).toBe(12000)
  })

  test('vacío o ausente da 0', () => {
    expect(providerCostForMonth([])).toBe(0)
    expect(providerCostForMonth(undefined)).toBe(0)
    expect(providerCostForMonth(null)).toBe(0)
  })

  test('tolera montos no numéricos', () => {
    expect(providerCostForMonth([p(1000), p(undefined), p(null)])).toBe(1000)
  })
})
