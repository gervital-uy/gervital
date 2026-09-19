import {
  irpfFactor, nominalFromLiquido, monthlyCostBreakdown, monthlyCostToCompany,
  currentSalary, extraordinarios12m, proyectarNominal,
  highestNominalAsOf, directorContributionAsOf, directorContributionPerDirector,
  DIRECTORS_COUNT
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

  test('sin asOf incluye ajustes con vigencia futura (lo que muestra la ficha)', () => {
    const adj = [
      { liquido: 80, effectiveDate: '2026-01-01' },
      { liquido: 95, effectiveDate: '2099-01-01' }
    ]
    expect(currentSalary(adj).liquido).toBe(95)
  })

  test('con asOf ignora los ajustes posteriores', () => {
    const adj = [
      { liquido: 80, effectiveDate: '2026-01-01' },
      { liquido: 95, effectiveDate: '2026-10-01' }
    ]
    expect(currentSalary(adj, '2026-09-30').liquido).toBe(80)
    expect(currentSalary(adj, '2026-10-31').liquido).toBe(95)
  })

  test('asOf incluye el ajuste que entra en vigencia ese mismo día', () => {
    const adj = [{ liquido: 95, effectiveDate: '2026-09-30' }]
    expect(currentSalary(adj, '2026-09-30').liquido).toBe(95)
  })

  test('asOf anterior a todos los ajustes da null', () => {
    const adj = [{ liquido: 95, effectiveDate: '2026-10-01' }]
    expect(currentSalary(adj, '2026-09-30')).toBeNull()
  })
})

describe('highestNominalAsOf / directorContributionAsOf', () => {
  const emp = (liquido, { active = true, hasIrpf = false, effectiveDate = '2026-01-01' } = {}) =>
    ({ active, hasIrpf, adjustments: [{ liquido, effectiveDate }] })

  test('toma el nominal más alto, no el líquido más alto', () => {
    // 59251 con IRPF nominaliza por encima de 60000 sin IRPF.
    const employees = [emp(60000), emp(59251, { hasIrpf: true })]
    expect(highestNominalAsOf(employees, '2026-09-30')).toBeCloseTo(nominalFromLiquido(59251, true), 6)
  })

  test('ignora inactivos y empleados sin sueldo vigente a la fecha', () => {
    const employees = [
      emp(99999, { active: false }),
      emp(88888, { effectiveDate: '2026-12-01' }),
      emp(40000)
    ]
    expect(highestNominalAsOf(employees, '2026-09-30')).toBeCloseTo(nominalFromLiquido(40000, false), 6)
  })

  test('sin empleados elegibles da 0', () => {
    expect(highestNominalAsOf([], '2026-09-30')).toBe(0)
    expect(highestNominalAsOf(undefined, '2026-09-30')).toBe(0)
    expect(directorContributionAsOf([], '2026-09-30')).toBe(0)
  })

  test('el aporte de un director es el nominal más alto por 0.226, redondeado', () => {
    const employees = [emp(40000)]
    const esperado = Math.round(nominalFromLiquido(40000, false) * (0.15 + 0.001 + 0.075))
    expect(directorContributionPerDirector(employees, '2026-09-30')).toBe(esperado)
    expect(Number.isInteger(directorContributionPerDirector(employees, '2026-09-30'))).toBe(true)
  })

  test('el aporte total es el de un director por la cantidad de directores', () => {
    const employees = [emp(40000)]
    expect(DIRECTORS_COUNT).toBe(2)
    expect(directorContributionAsOf(employees, '2026-09-30'))
      .toBe(directorContributionPerDirector(employees, '2026-09-30') * DIRECTORS_COUNT)
  })

  test('redondea por director, no sobre el total', () => {
    // 75865.5569... × 0.226 = 17145.6158 → 17146 por director → 34292.
    // Redondear el total daría 34291: un peso menos.
    const employees = [emp(59251, { hasIrpf: true })]
    expect(directorContributionAsOf(employees, '2026-09-30')).toBe(34292)
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
