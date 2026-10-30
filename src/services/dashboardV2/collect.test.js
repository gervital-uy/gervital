import {
  canCollect, revertBlock, paymentDateWindow, paymentDateError, registerPayments, revertPayment,
  STALE_PAID, STALE_INVOICED, STALE_NOT_PAID
} from './collect'
import { markMonthPaid, unmarkMonthPaid } from '../invoices/invoiceService'
import { collectPromo, uncollectPromo } from '../promotions/promotionService'
import { getMonthPaymentStates } from './queries'

jest.mock('../invoices/invoiceService', () => ({ markMonthPaid: jest.fn(), unmarkMonthPaid: jest.fn() }))
jest.mock('../promotions/promotionService', () => ({ collectPromo: jest.fn(), uncollectPromo: jest.fn() }))
jest.mock('./queries', () => ({ getMonthPaymentStates: jest.fn() }))

// Estado real en la base: por defecto, como lo muestra el padrón.
const live = (entries) => new Map(entries.map(([id, payment_status, extra = {}]) => [id, { client_id: id, payment_status, invoice_status: 'pending', promo_id: null, ...extra }]))

const SUPER = { canManagePromos: true }
const ADMIN = { canManagePromos: false }
const cuota = { id: 'a', paymentStatus: 'pending', due: 30000, promoIndex: null, invoiceStatus: 'pending' }
const ancla = { id: 'b', paymentStatus: 'pending', due: 81000, promoIndex: 1, promoId: 'p1', invoiceStatus: 'pending' }
const mes2 = { id: 'c', paymentStatus: 'pending', due: 0, promoIndex: 2, promoId: 'p1', invoiceStatus: 'pending' }

describe('qué se puede cobrar y revertir', () => {
  test('se cobra lo que debe algo propio; el paquete solo con permiso de promos', () => {
    expect(canCollect(cuota, SUPER)).toBe(true)
    expect(canCollect(ancla, SUPER)).toBe(true)
    expect(canCollect(ancla, ADMIN)).toBe(false)
    expect(canCollect(mes2, SUPER)).toBe(false)
    expect(canCollect({ ...cuota, due: 0 }, SUPER)).toBe(false)
    expect(canCollect({ ...cuota, paymentStatus: 'paid' }, SUPER)).toBe(false)
  })

  test('se revierte un cobro sin factura; el ancla con permiso de promos', () => {
    const paid = { ...cuota, paymentStatus: 'paid' }
    expect(revertBlock(paid, SUPER)).toBeNull()
    expect(revertBlock({ ...paid, invoiceStatus: 'invoiced' }, SUPER)).toMatch(/factura emitida/)
    expect(revertBlock({ ...ancla, paymentStatus: 'paid' }, SUPER)).toBeNull()
    expect(revertBlock({ ...ancla, paymentStatus: 'paid' }, ADMIN)).toMatch(/superadmin/)
    expect(revertBlock({ ...mes2, paymentStatus: 'prepaid' }, SUPER)).toMatch(/cobro registrado/)
    expect(revertBlock(cuota, SUPER)).toMatch(/cobro registrado/)
  })
})

describe('fecha del giro', () => {
  test('del 1 del mes anterior al último del siguiente, nunca después de hoy', () => {
    expect(paymentDateWindow(2026, 8, '2026-10-30')).toEqual({ min: '2026-08-01', max: '2026-10-30' })
    expect(paymentDateWindow(2026, 6, '2026-10-30')).toEqual({ min: '2026-06-01', max: '2026-08-31' })
    expect(paymentDateWindow(2026, 0, '2026-10-30')).toEqual({ min: '2025-12-01', max: '2026-02-28' })
  })

  test('fecha obligatoria y dentro de la ventana', () => {
    const w = { min: '2026-09-01', max: '2026-10-30' }
    expect(paymentDateError('', w)).toMatch(/Poné la fecha/)
    expect(paymentDateError('2026-08-31', w)).toMatch(/fuera del rango/)
    expect(paymentDateError('2026-10-31', w)).toMatch(/fuera del rango/)
    expect(paymentDateError('2026-10-05', w)).toBeNull()
    // Los bordes valen
    expect(paymentDateError(w.min, w)).toBeNull()
    expect(paymentDateError(w.max, w)).toBeNull()
  })
})

describe('registrar y revertir', () => {
  beforeEach(() => {
    markMonthPaid.mockReset().mockResolvedValue({ success: true })
    collectPromo.mockReset().mockResolvedValue({ success: true })
    unmarkMonthPaid.mockReset().mockResolvedValue()
    uncollectPromo.mockReset().mockResolvedValue({ success: true })
    getMonthPaymentStates.mockReset().mockResolvedValue(live([
      ['a', 'pending'], ['z', 'pending'], ['b', 'pending', { promo_id: 'p1' }]
    ]))
  })

  test('cada fila va por su función: el mes común sin monto, el ancla cobra el paquete', async () => {
    const dates = { a: '2026-10-03', b: '2026-10-05' }
    const results = await registerPayments([cuota, ancla], { year: 2026, month: 9, dateFor: r => dates[r.id], note: '  transferencia  ' })
    expect(markMonthPaid).toHaveBeenCalledWith('a', 2026, 9, null, null, 'transferencia', '2026-10-03')
    expect(collectPromo).toHaveBeenCalledWith('p1', '2026-10-05', null, null, 'transferencia')
    expect(results).toEqual([{ id: 'a', ok: true }, { id: 'b', ok: true }])
  })

  test('un error no corta el resto y queda en su fila', async () => {
    markMonthPaid.mockRejectedValueOnce(new Error('Factura no encontrada'))
    const results = await registerPayments([cuota, { ...cuota, id: 'z' }], { year: 2026, month: 9, dateFor: () => '2026-10-03' })
    expect(results).toEqual([{ id: 'a', ok: false, error: 'Factura no encontrada' }, { id: 'z', ok: true }])
    expect(markMonthPaid).toHaveBeenLastCalledWith('z', 2026, 9, null, null, null, '2026-10-03')
  })

  test('no pisa un cobro registrado desde otro lado mientras la pantalla estaba abierta', async () => {
    getMonthPaymentStates.mockResolvedValue(live([['a', 'paid'], ['z', 'pending'], ['b', 'pending', { promo_id: 'otra' }]]))
    const results = await registerPayments([cuota, { ...cuota, id: 'z' }, ancla, { ...cuota, id: 'sinmes' }], { year: 2026, month: 9, dateFor: () => '2026-10-03' })
    expect(getMonthPaymentStates).toHaveBeenCalledWith(2026, 9, ['a', 'z', 'b', 'sinmes'])
    expect(results).toEqual([
      { id: 'a', ok: false, error: STALE_PAID },
      { id: 'z', ok: true },
      { id: 'b', ok: false, error: expect.stringMatching(/promo de este mes cambió/) },
      { id: 'sinmes', ok: false, error: expect.stringMatching(/no está generado/) }
    ])
    expect(markMonthPaid).toHaveBeenCalledTimes(1)
    expect(collectPromo).not.toHaveBeenCalled()
  })

  test('revertir el ancla deshace el paquete; un mes común se relee y se deshace solo', async () => {
    await revertPayment({ ...ancla, paymentStatus: 'paid' }, { year: 2026, month: 9 })
    expect(uncollectPromo).toHaveBeenCalledWith('p1')
    expect(unmarkMonthPaid).not.toHaveBeenCalled()
    getMonthPaymentStates.mockResolvedValue(live([['a', 'paid']]))
    await revertPayment({ ...cuota, paymentStatus: 'paid' }, { year: 2026, month: 9 })
    expect(unmarkMonthPaid).toHaveBeenCalledWith('a', 2026, 9)
  })

  test('no revierte un mes que se facturó o se revirtió desde otro lado', async () => {
    getMonthPaymentStates.mockResolvedValue(live([['a', 'paid', { invoice_status: 'invoiced' }]]))
    await expect(revertPayment({ ...cuota, paymentStatus: 'paid' }, { year: 2026, month: 9 })).rejects.toThrow(STALE_INVOICED)
    getMonthPaymentStates.mockResolvedValue(live([['a', 'pending']]))
    await expect(revertPayment({ ...cuota, paymentStatus: 'paid' }, { year: 2026, month: 9 })).rejects.toThrow(STALE_NOT_PAID)
    expect(unmarkMonthPaid).not.toHaveBeenCalled()
  })
})
