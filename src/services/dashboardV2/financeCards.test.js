import { buildFinanceSeries } from './financeSeriesV2'
import { financeCards } from './financeCards'

// Dos meses chicos: julio con una cuota y un variable; agosto con una cuota con
// transporte, un variable más grande y una plantilla fija mensual.
const row = (id, over = {}) => ({
  client_id: id, attendance_gross: 30500, transport_gross: 0, payment_status: 'paid', paid_amount: 30500,
  promo_index: null, promo_total_amount: null, promo_id: null, ...over
})
const SOURCES = [
  { year: 2026, month: 6, panel: [row('a')], payments: [], variableRows: [{ year: 2026, month: 6, amount: 5000, categoryName: 'Alimentación' }], extraordinaryRows: [] },
  { year: 2026, month: 7, panel: [row('a'), row('b', { transport_gross: 11000, paid_amount: 41500 })], payments: [], variableRows: [{ year: 2026, month: 7, amount: 8000, categoryName: 'Alimentación' }], extraordinaryRows: [] }
]
const COSTS = {
  employees: [],
  extraCosts: [],
  providers: [{ id: 'p', name: 'Ana', role: 'Chofer', monthlyAmount: 10000, active: true, createdAt: '2026-07-01T12:00:00Z' }],
  fixedTemplates: [{ amount: 3000, periodMonths: 1, startYear: 2026, startMonth: 7, categoryName: 'Limpieza' }],
  directorStart: null
}
const series = buildFinanceSeries(SOURCES, COSTS)
const cards = financeCards({ series, sources: SOURCES, fixedTemplates: COSTS.fixedTemplates }, { year: 2026, month: 7 })

describe('tarjetas de análisis de Finanzas', () => {
  test('un mes fuera de la serie no tiene tarjetas', () => {
    expect(financeCards({ series, sources: SOURCES, fixedTemplates: [] }, { year: 2026, month: 2 })).toBeNull()
  })

  test('los bloques de gasto, con el mes anterior y el recorrido', () => {
    expect(cards.prev).toEqual({ year: 2026, month: 6 })
    const providers = cards.personal.parts.find(p => p.key === 'providers')
    expect(providers).toEqual({ key: 'providers', value: 10000, prev: 10000, trend: [10000, 10000] })
    const variable = cards.operating.parts.find(p => p.key === 'variable')
    expect(variable).toMatchObject({ value: 8000, prev: 5000, trend: [5000, 8000] })
    expect(cards.operating.total).toBe(11000)
  })

  test('gastos por categoría contra el mes anterior, sin el personal', () => {
    expect(cards.categories.rows.map(r => [r.label, r.value, r.prev])).toEqual([
      ['Alimentación', 8000, 5000],
      ['Limpieza', 3000, 0]
    ])
    expect(cards.categories.total).toBe(11000)
  })

  test('caja, puente, líneas y equilibrio salen de la misma fila', () => {
    expect(cards.cash.bank).toBe(72000)
    expect(cards.bridge.net).toBe(cards.bridge.income - 10000 - 3000 - 8000)
    expect(cards.lines.attendance.revenue + cards.lines.transport.revenue).toBe(cards.bridge.income)
    expect(cards.lines.transport.clients).toBe(1)
    expect(cards.breakeven.users).toBe(2)
  })
})
