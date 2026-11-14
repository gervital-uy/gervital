import { supabase } from '../supabase/client'
import { getPromotions } from '../promotions/promotionService'
import { calculateMonthBilling } from '../invoices/invoiceService'
import { getBenefitLedger, loadBenefitSources } from './benefitsQueries'

jest.mock('../supabase/client', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }))
jest.mock('../promotions/promotionService', () => ({ getPromotions: jest.fn() }))
jest.mock('../invoices/invoiceService', () => ({ calculateMonthBilling: jest.fn() }))

// Un query builder de supabase-js: encadena filtros y se resuelve con { data, error }.
const builder = result => {
  const b = {}
  for (const method of ['select', 'or', 'gte', 'eq', 'in']) b[method] = jest.fn(() => b)
  b.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return b
}

const LEDGER = [
  { client_id: 'a', year: 2026, month: 4, discount_percent: '10.00', promo_id: null, payment_status: 'paid', attendance_chargeable_gross: '27000.00' },
  { client_id: 'a', year: 2026, month: 9, discount_percent: '10.00', promo_id: 'p1', payment_status: 'paid', attendance_chargeable_gross: '27000.00' },
  { client_id: 'b', year: 2026, month: 9, discount_percent: '25.00', discount_reason: 'Situación económica', promo_id: null, payment_status: 'pending', attendance_chargeable_gross: null },
  { client_id: 'b', year: 2026, month: 10, discount_percent: '20.00', promo_id: null, payment_status: 'pending', attendance_chargeable_gross: null },
  { client_id: 'c', year: 2026, month: 9, discount_percent: '100.00', promo_id: null, payment_status: 'pending', attendance_chargeable_gross: null }
]
const CLIENTS = [{ id: 'a', firstName: 'Ana', lastName: 'Pérez', avatarUrl: null, deactivationDate: '2026-11-15', inactivityPeriods: [{ fromDate: '2026-11-15', toDate: null }] }]

let ledgerQuery
let clientsQuery
const mockTables = ({ ledger = { data: LEDGER, error: null } } = {}) => {
  ledgerQuery = builder(ledger)
  clientsQuery = builder({ data: CLIENTS, error: null })
  supabase.from.mockImplementation(table => (table === 'monthly_invoices' ? ledgerQuery : table === 'clients_full' ? clientsQuery : null))
}

beforeEach(() => {
  mockTables()
  getPromotions.mockResolvedValue([{ id: 'p1' }])
  calculateMonthBilling.mockImplementation(id => (id === 'c' ? Promise.reject(new Error('sin distancia')) : Promise.resolve({ id })))
  supabase.rpc.mockResolvedValue({ data: [{ client_id: 'a' }, { client_id: 'z' }], error: null })
})

describe('getBenefitLedger', () => {
  test('trae los meses con promo o descuento desde el lanzamiento, en camelCase', async () => {
    const ledger = await getBenefitLedger()
    expect(ledgerQuery.select).toHaveBeenCalledWith('client_id, year, month, discount_percent, discount_reason, promo_id, payment_status, attendance_chargeable_gross')
    expect(ledgerQuery.or).toHaveBeenCalledWith('discount_percent.gt.0,promo_id.not.is.null')
    expect(ledgerQuery.gte).toHaveBeenCalledWith('year', 2026)
    // mayo 2026 es anterior al lanzamiento
    expect(ledger).toHaveLength(4)
    expect(ledger[0]).toEqual({ clientId: 'a', year: 2026, month: 9, discountPercent: 10, discountReason: null, promoId: 'p1', paymentStatus: 'paid', attendanceChargeableGross: 27000 })
    expect(ledger[1]).toMatchObject({ clientId: 'b', discountReason: 'Situación económica', promoId: null, attendanceChargeableGross: null })
  })

  test('un error de la base se propaga', async () => {
    mockTables({ ledger: { data: null, error: { message: 'permiso denegado' } } })
    await expect(getBenefitLedger()).rejects.toThrow('permiso denegado')
  })
})

describe('loadBenefitSources', () => {
  test('pide el cálculo del mes solo de los clientes con beneficio en ese mes; un cálculo que falla queda afuera', async () => {
    const sources = await loadBenefitSources({ year: 2026, month: 9 })
    expect(calculateMonthBilling.mock.calls.map(c => c[0]).sort()).toEqual(['a', 'b', 'c'])
    expect(calculateMonthBilling).toHaveBeenCalledWith('a', 2026, 9)
    expect(sources.billing).toEqual({ a: { id: 'a' }, b: { id: 'b' } })
    expect(sources.promotions).toEqual([{ id: 'p1' }])
    // Los clientes traen sus períodos de inactividad: una baja no tiene próximos
    expect(clientsQuery.select).toHaveBeenCalledWith('id, firstName, lastName, avatarUrl, deactivationDate, inactivityPeriods')
    expect(sources.clients).toEqual([{ id: 'a', firstName: 'Ana', lastName: 'Pérez', avatarUrl: null, deactivationDate: '2026-11-15', inactivityPeriods: [{ fromDate: '2026-11-15', toDate: null }] }])
    expect(sources.ledger).toHaveLength(4)
  })

  test('antes de diciembre 2026 no hay mes de hace seis meses con datos', async () => {
    const sources = await loadBenefitSources({ year: 2026, month: 9 })
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(sources.pastBase).toBeNull()
  })

  test('desde diciembre 2026 trae la población de hace seis meses', async () => {
    const sources = await loadBenefitSources({ year: 2026, month: 11 })
    expect(supabase.rpc).toHaveBeenCalledWith('get_month_collection_panel', { p_year: 2026, p_month: 5 })
    expect(sources.pastBase).toEqual({ year: 2026, month: 5, clientIds: ['a', 'z'] })
  })

  test('si falla la población de hace seis meses, el resto se carga igual', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const sources = await loadBenefitSources({ year: 2026, month: 11 })
    expect(sources.pastBase).toBeNull()
    expect(sources.ledger).toHaveLength(4)
  })
})
