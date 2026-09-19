import {
  parseMonthKey, monthKey, monthsBetween, pendingContributions,
  DIRECTOR_CONCEPT, DIRECTOR_SYSTEM_KEY
} from './directorContribution'
import { DIRECTOR_CONTRIBUTION_RATE, DIRECTORS_COUNT } from './salaryCalc'

// Fórmula escrita aparte para que el test no repita la implementación.
const RATE = 0.15 + 0.001 + 0.075
const nominal = (liquido, hasIrpf) => liquido / (hasIrpf ? 0.781 : 0.804)
// Se redondea por director y después se multiplica, como en la factura de BPS.
const aporte = (liquido, hasIrpf) => Math.round(nominal(liquido, hasIrpf) * RATE) * 2

const employee = (liquido, { active = true, hasIrpf = false, effectiveDate = '2026-01-01' } = {}) => ({
  active,
  hasIrpf,
  adjustments: [{ liquido, effectiveDate }]
})

describe('monthKey / parseMonthKey', () => {
  test('ida y vuelta con el mes 0-indexed', () => {
    expect(monthKey(2026, 0)).toBe('2026-01')
    expect(monthKey(2026, 11)).toBe('2026-12')
    expect(parseMonthKey('2026-09')).toEqual({ year: 2026, month: 8 })
  })

  test('descarta claves inválidas', () => {
    expect(parseMonthKey('')).toBeNull()
    expect(parseMonthKey(null)).toBeNull()
    expect(parseMonthKey('2026-13')).toBeNull()
    expect(parseMonthKey('basura')).toBeNull()
  })
})

describe('monthsBetween', () => {
  test('incluye ambos extremos', () => {
    expect(monthsBetween('2026-09', '2026-11')).toEqual([
      { year: 2026, month: 8 }, { year: 2026, month: 9 }, { year: 2026, month: 10 }
    ])
  })

  test('un solo mes cuando ancla y corriente coinciden', () => {
    expect(monthsBetween('2026-09', '2026-09')).toEqual([{ year: 2026, month: 8 }])
  })

  test('cruza el fin de año', () => {
    expect(monthsBetween('2026-11', '2027-01')).toEqual([
      { year: 2026, month: 10 }, { year: 2026, month: 11 }, { year: 2027, month: 0 }
    ])
  })

  test('vacío si el ancla es posterior al mes corriente', () => {
    expect(monthsBetween('2026-11', '2026-09')).toEqual([])
  })

  test('vacío con claves inválidas', () => {
    expect(monthsBetween('', '2026-09')).toEqual([])
    expect(monthsBetween('2026-09', null)).toEqual([])
  })
})

describe('pendingContributions', () => {
  const employees = [employee(40000), employee(59251, { hasIrpf: true }), employee(33987)]

  test('usa el nominal más alto por la tasa, por los dos directores', () => {
    const [row] = pendingContributions({ startKey: '2026-09', currentKey: '2026-09', employees })
    expect(DIRECTORS_COUNT).toBe(2)
    expect(row.amount).toBe(aporte(59251, true))
    expect(row.concept).toBe(DIRECTOR_CONCEPT)
    expect(row.systemKey).toBe(DIRECTOR_SYSTEM_KEY)
  })

  test('la tasa es 0.226', () => {
    expect(DIRECTOR_CONTRIBUTION_RATE).toBeCloseTo(0.226, 10)
  })

  test('se fecha en el último día hábil del mes', () => {
    // 30/09/2026 es miércoles; 31/01/2026 es sábado → viernes 30.
    expect(pendingContributions({ startKey: '2026-09', currentKey: '2026-09', employees })[0].date)
      .toBe('2026-09-30')
    expect(pendingContributions({ startKey: '2026-01', currentKey: '2026-01', employees })[0].date)
      .toBe('2026-01-30')
  })

  test('ignora empleados dados de baja', () => {
    const conBaja = [employee(40000), employee(99999, { active: false })]
    const [row] = pendingContributions({ startKey: '2026-09', currentKey: '2026-09', employees: conBaja })
    expect(row.amount).toBe(aporte(40000, false))
  })

  test('cada mes se congela con el nominal vigente ESE mes', () => {
    // Aumento con vigencia en octubre: septiembre no lo ve.
    const conAumento = [{
      active: true,
      hasIrpf: false,
      adjustments: [
        { liquido: 40000, effectiveDate: '2026-01-01' },
        { liquido: 60000, effectiveDate: '2026-10-01' }
      ]
    }]
    const rows = pendingContributions({ startKey: '2026-09', currentKey: '2026-10', employees: conAumento })
    expect(rows).toHaveLength(2)
    expect(rows[0].amount).toBe(aporte(40000, false))
    expect(rows[1].amount).toBe(aporte(60000, false))
  })

  test('saltea los meses que ya tienen fila (no propone updates)', () => {
    const existing = [{ date: '2026-09-30' }, { date: '2026-10-30' }]
    const rows = pendingContributions({ startKey: '2026-09', currentKey: '2026-11', existing, employees })
    expect(rows.map(r => r.date)).toEqual(['2026-11-30'])
  })

  test('el mes existente se detecta por año-mes, no por día exacto', () => {
    const existing = [{ date: '2026-09-15' }]
    const rows = pendingContributions({ startKey: '2026-09', currentKey: '2026-09', existing, employees })
    expect(rows).toEqual([])
  })

  test('llena el hueco de varios meses sin abrir Costos', () => {
    const rows = pendingContributions({ startKey: '2026-09', currentKey: '2026-12', employees })
    expect(rows.map(r => r.date)).toEqual(['2026-09-30', '2026-10-30', '2026-11-30', '2026-12-31'])
  })

  test('sin empleados activos con sueldo vigente no materializa nada', () => {
    expect(pendingContributions({ startKey: '2026-09', currentKey: '2026-09', employees: [] })).toEqual([])
    expect(pendingContributions({
      startKey: '2026-09', currentKey: '2026-09',
      employees: [employee(40000, { active: false })]
    })).toEqual([])
    // Sueldo que arranca después del mes: ese mes queda sin fila.
    expect(pendingContributions({
      startKey: '2026-09', currentKey: '2026-09',
      employees: [employee(40000, { effectiveDate: '2026-10-01' })]
    })).toEqual([])
  })
})
