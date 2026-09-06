import {
  irpfFactor, nominalFromLiquido, monthlyCostBreakdown, monthlyCostToCompany,
  currentSalary, extraordinarios12m, proyectarNominal
} from './salaryCalc'

// Referencia manual de la fórmula, escrita aparte para que el test no repita
// la implementación: si alguien toca una constante, esto lo caza.
const expectedCost = (liquido, hasIrpf) => {
  const nominal = liquido / (hasIrpf ? 0.781 : 0.804)
  return nominal
    + nominal * (0.075 + 0.05 + 0.001)
    + (nominal / 12) * (1 + 0.075 + 0.001)
    + (nominal / 30) * (20 / 12) * 0.804
}

describe('irpfFactor / nominalFromLiquido', () => {
  test('sin IRPF divide por 0.804, con IRPF por 0.781', () => {
    expect(irpfFactor(false)).toBe(0.804)
    expect(irpfFactor(true)).toBe(0.781)
  })

  test('nominal de las empleadas reales', () => {
    expect(nominalFromLiquido(33987, false)).toBeCloseTo(42272.39, 2) // Carolina
    expect(nominalFromLiquido(40000, false)).toBeCloseTo(49751.24, 2) // Abigail
    expect(nominalFromLiquido(59251, true)).toBeCloseTo(75865.56, 2)  // María (IRPF)
  })

  test('el IRPF sube el nominal para el mismo líquido', () => {
    expect(nominalFromLiquido(50000, true)).toBeGreaterThan(nominalFromLiquido(50000, false))
  })

  test('líquido 0 o inválido da 0', () => {
    expect(nominalFromLiquido(0, false)).toBe(0)
    expect(nominalFromLiquido(null, false)).toBe(0)
    expect(nominalFromLiquido(undefined, true)).toBe(0)
  })
})

describe('monthlyCostToCompany', () => {
  test('coincide con la fórmula de referencia', () => {
    expect(monthlyCostToCompany(33987, false)).toBeCloseTo(expectedCost(33987, false), 6)
    expect(monthlyCostToCompany(59251, true)).toBeCloseTo(expectedCost(59251, true), 6)
  })

  test('valores esperados de las 6 empleadas', () => {
    expect(monthlyCostToCompany(33987, false)).toBeCloseTo(53277, 0) // Carolina
    expect(monthlyCostToCompany(59251, true)).toBeCloseTo(95616, 0)  // María
    expect(monthlyCostToCompany(40000, false)).toBeCloseTo(62703, 0) // Abigail
    expect(monthlyCostToCompany(41779, false)).toBeCloseTo(65492, 0) // Eugenia
    expect(monthlyCostToCompany(36684, false)).toBeCloseTo(57505, 0) // Martina
    expect(monthlyCostToCompany(38000, false)).toBeCloseTo(59568, 0) // Camila
  })

  test('incluye el nominal, no sólo los agregados patronales', () => {
    const { nominal, total } = monthlyCostBreakdown(40000, false)
    expect(total).toBeGreaterThan(nominal)
    expect(total - nominal).toBeCloseTo(12952, 0) // el "encima" del nominal
  })

  test('el desglose suma el total', () => {
    const b = monthlyCostBreakdown(41779, false)
    expect(b.nominal + b.aportes + b.aguinaldo + b.vacacional).toBeCloseTo(b.total, 6)
  })

  test('es plano: el costo no depende del mes', () => {
    // No hay parámetro de mes; el mismo líquido da el mismo costo siempre.
    expect(monthlyCostToCompany(38000, false)).toBe(monthlyCostToCompany(38000, false))
  })

  test('líquido 0 da 0', () => {
    expect(monthlyCostToCompany(0, false)).toBe(0)
  })
})

describe('currentSalary', () => {
  test('toma el ajuste con la vigencia más alta', () => {
    const adj = [
      { liquido: 80, effectiveDate: '2025-01-01' },
      { liquido: 95, effectiveDate: '2026-01-01' },
      { liquido: 88, effectiveDate: '2025-06-01' }
    ]
    expect(currentSalary(adj)).toEqual({ liquido: 95, effectiveDate: '2026-01-01' })
  })

  test('desempata por createdAt', () => {
    const adj = [
      { liquido: 80, effectiveDate: '2026-01-01', createdAt: '2026-01-01T10:00:00Z' },
      { liquido: 99, effectiveDate: '2026-01-01', createdAt: '2026-01-02T10:00:00Z' }
    ]
    expect(currentSalary(adj).liquido).toBe(99)
  })

  test('sin ajustes da null', () => {
    expect(currentSalary([])).toBeNull()
    expect(currentSalary(undefined)).toBeNull()
  })
})

describe('extraordinarios12m', () => {
  test('suma sólo los de los últimos 12 meses', () => {
    const extras = [
      { amount: 1000, date: '2026-05-01' },
      { amount: 500, date: '2024-01-01' }
    ]
    expect(extraordinarios12m(extras, '2026-06-11')).toBe(1000)
  })

  test('vacío da 0', () => {
    expect(extraordinarios12m([], '2026-06-11')).toBe(0)
    expect(extraordinarios12m(undefined, '2026-06-11')).toBe(0)
  })
})

describe('proyectarNominal', () => {
  test('0 semestres devuelve el mismo nominal', () => {
    expect(proyectarNominal(1000, 3.5, 0)).toBe(1000)
  })
})
