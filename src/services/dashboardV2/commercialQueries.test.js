import { getCommercialSources, loadCommercial, saveShiftCapacity, PAGE_SIZE } from './commercialQueries'
import { supabase } from '../supabase/client'
import { getPlanPricing } from '../pricing/pricingService'
import { getTransportPricing } from '../pricing/transportPricingService'
import { getReasons } from '../churn/deactivationReasonService'
import { getSetting, setSetting } from '../settings/appSettingsService'
import { todayStr } from '../../utils/date'

jest.mock('../supabase/client', () => ({ supabase: { from: jest.fn() } }))
jest.mock('../pricing/pricingService', () => ({ ...jest.requireActual('../pricing/pricingService'), getPlanPricing: jest.fn() }))
jest.mock('../pricing/transportPricingService', () => ({ ...jest.requireActual('../pricing/transportPricingService'), getTransportPricing: jest.fn() }))
jest.mock('../churn/deactivationReasonService', () => ({ getReasons: jest.fn() }))
jest.mock('../settings/appSettingsService', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }))
jest.mock('../../utils/date', () => ({ ...jest.requireActual('../../utils/date'), todayStr: jest.fn() }))

// Filas tal como las devuelve la base.
const TABLES = {
  clients_full: [
    { id: 'a', firstName: 'Ana', lastName: 'B', clientType: 'regular', startDate: '2026-06-01', birthDate: '1940-01-01', cognitiveLevel: 'B', address: { street: 'X 1', distanceRange: '2_to_5km' } },
    { id: 'b', firstName: 'Beto', lastName: 'C', clientType: 'regular', startDate: '2026-09-10', address: null }
  ],
  client_inactivity_periods: [{ client_id: 'b', from_date: '2026-10-15', to_date: null, reason: 'financial' }],
  client_plans: [
    { client_id: 'a', effective_from: '2026-06-01', frequency: 2, schedule: 'afternoon', has_transport: true, assigned_days: ['tuesday', 'thursday'] },
    { client_id: 'b', effective_from: '2026-09-01', frequency: 1, schedule: 'afternoon', has_transport: false, assigned_days: null }
  ],
  invoices_view: [{ clientId: 'a', year: 2026, month: 9, discountPercent: '10.00' }],
  churn_followups: [{ client_id: 'b', stage: 'lost', deactivation_date: '2026-10-15' }]
}

let queries
let tables
const builder = (failing) => table => {
  const q = { table, filters: [], range: null }
  queries.push(q)
  const chain = {
    select: fields => { q.fields = fields; return chain },
    gt: (column, value) => { q.filters.push(['gt', column, value]); return chain },
    order: column => { q.order = column; return chain },
    range: (from, to) => { q.range = [from, to]; return chain },
    then: (resolve, reject) => {
      const rows = q.range ? tables[table].slice(q.range[0], q.range[1] + 1) : tables[table]
      const result = failing === table ? { data: null, error: { message: `falló ${table}` } } : { data: rows, error: null }
      return Promise.resolve(result).then(resolve, reject)
    }
  }
  return chain
}

beforeEach(() => {
  queries = []
  tables = { ...TABLES }
  supabase.from.mockImplementation(builder(null))
  getPlanPricing.mockResolvedValue([
    { frequency: 1, schedule: 'afternoon', priceNet: 16393.44, effectiveYear: 2000, effectiveMonth: 0 },
    { frequency: 2, schedule: 'afternoon', priceNet: 24590.16, effectiveYear: 2000, effectiveMonth: 0 }
  ])
  getTransportPricing.mockResolvedValue([{ frequency: 2, distanceRange: '2_to_5km', priceNet: 7563.64, effectiveYear: 2000, effectiveMonth: 0 }])
  getReasons.mockResolvedValue([{ id: 'r1', key: 'financial', label: 'Motivo económico', color: '#2563eb', sortOrder: 5, isActive: false, isSystem: false }])
  getSetting.mockResolvedValue('24')
  todayStr.mockReturnValue('2026-11-06')
})

describe('getCommercialSources', () => {
  test('lee cada tabla una vez y normaliza los campos', async () => {
    const s = await getCommercialSources()
    expect(queries.map(q => q.table).sort()).toEqual(['churn_followups', 'client_inactivity_periods', 'client_plans', 'clients_full', 'invoices_view'])
    expect(queries.find(q => q.table === 'client_plans').range).toEqual([0, PAGE_SIZE - 1])
    expect(queries.find(q => q.table === 'invoices_view').filters).toEqual([['gt', 'discountPercent', 0]])
    expect(getReasons).toHaveBeenCalledWith({ includeInactive: true })
    expect(getSetting).toHaveBeenCalledWith('shift_capacity')

    expect(s.clients[0]).toEqual({ id: 'a', firstName: 'Ana', lastName: 'B', clientType: 'regular', startDate: '2026-06-01', birthDate: '1940-01-01', cognitiveLevel: 'B', distanceRange: '2_to_5km' })
    expect(s.clients[1].distanceRange).toBeNull()
    expect(s.periods).toEqual([{ clientId: 'b', fromDate: '2026-10-15', toDate: null, reason: 'financial' }])
    expect(s.plans[1]).toEqual({ clientId: 'b', effectiveFrom: '2026-09-01', frequency: 1, schedule: 'afternoon', hasTransport: false, assignedDays: [] })
    expect(s.discounts).toEqual([{ clientId: 'a', year: 2026, month: 9, discountPercent: 10 }])
    expect(s.followups).toEqual([{ clientId: 'b', stage: 'lost', deactivationDate: '2026-10-15' }])
    // Los motivos dados de baja del catálogo también: una baja vieja puede usarlos
    expect(s.reasons).toEqual([{ key: 'financial', label: 'Motivo económico', color: '#2563eb', sortOrder: 5 }])
    expect(s.shiftCapacity).toBe('24')
  })

  test('client_plans se lee por páginas, con un orden fijo', async () => {
    const one = TABLES.client_plans[0]
    tables.client_plans = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({ ...one, effective_from: `2026-06-${String((i % 28) + 1).padStart(2, '0')}` }))
    const s = await getCommercialSources()
    const pages = queries.filter(q => q.table === 'client_plans')
    expect(pages.map(q => q.range)).toEqual([[0, PAGE_SIZE - 1], [PAGE_SIZE, 2 * PAGE_SIZE - 1]])
    expect(pages[0].order).toBe('id')
    expect(s.plans).toHaveLength(PAGE_SIZE + 1)
  })

  test('sin poder leer el aforo sigue, con el de por defecto', async () => {
    getSetting.mockRejectedValue(new Error('permiso'))
    expect((await getCommercialSources()).shiftCapacity).toBeNull()
  })

  test('una lectura que falla corta la carga con su mensaje', async () => {
    supabase.from.mockImplementation(builder('client_plans'))
    await expect(getCommercialSources()).rejects.toThrow('falló client_plans')
  })
})

test('loadCommercial arma el modelo con el día de hoy', async () => {
  const model = await loadCommercial()
  expect(model.timeline.today).toBe('2026-11-06')
  expect(model.capacity).toBe(24)
  const oct = model.month(model.indexOf(2026, 9))
  expect(oct.counts).toMatchObject({ opening: 2, bajas: 1, closing: 1 })
  // a: 24590,16 × 0,9 + 7563,64
  expect(oct.mrr.closing.total).toBe(Math.round(24590.16 * 0.9) + Math.round(7563.64))
  expect(oct.exitsByReason(null).rows[0]).toMatchObject({ key: 'financial', label: 'Motivo económico', value: 1 })
})

describe('saveShiftCapacity', () => {
  test('guarda un entero válido como texto', async () => {
    await saveShiftCapacity(' 28 ')
    expect(setSetting).toHaveBeenCalledWith('shift_capacity', '28')
  })

  test('no guarda nada fuera de rango o que no sea entero', async () => {
    for (const v of ['', 'abc', 0, 12.5, 500, null]) {
      await expect(saveShiftCapacity(v)).rejects.toThrow('entre 1 y 200')
    }
    expect(setSetting).not.toHaveBeenCalled()
  })
})
