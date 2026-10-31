import {
  canCollect, revertBlock, paymentDateWindow, paymentDateError, registerPayments, revertPayment,
  STALE_PAID, STALE_INVOICED, STALE_NOT_PAID, STALE_CHANGED, INVOICED_UNPAID
} from './collect'
import { calculateMonthBilling, markMonthPaid, unmarkMonthPaid } from '../invoices/invoiceService'
import { collectPromo, uncollectPromo } from '../promotions/promotionService'
import { getMonthPaymentStates } from './queries'

jest.mock('../invoices/invoiceService', () => ({ markMonthPaid: jest.fn(), unmarkMonthPaid: jest.fn(), calculateMonthBilling: jest.fn() }))
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
    // Facturado sin cobro: el cobro pisaría lo facturado
    expect(canCollect({ ...cuota, invoiceStatus: 'invoiced' }, SUPER)).toBe(false)
    // Paquete roto: la promo figura cobrada y su primer mes no
    expect(canCollect({ ...ancla, promoPaidDate: '2026-10-02' }, SUPER)).toBe(false)
  })

  test('se revierte un cobro sin factura; el ancla con permiso de promos', () => {
    const paid = { ...cuota, paymentStatus: 'paid' }
    expect(revertBlock(paid, SUPER)).toBeNull()
    expect(revertBlock({ ...paid, invoiceStatus: 'invoiced' }, SUPER)).toMatch(/factura emitida/)
    expect(revertBlock({ ...ancla, paymentStatus: 'paid' }, SUPER)).toBeNull()
    expect(revertBlock({ ...ancla, paymentStatus: 'paid' }, ADMIN)).toMatch(/superadmin/)
    expect(revertBlock({ ...mes2, paymentStatus: 'prepaid' }, SUPER)).toMatch(/cobro registrado/)
    expect(revertBlock(cuota, SUPER)).toMatch(/cobro registrado/)
    expect(revertBlock({ ...ancla, promoPaidDate: '2026-10-02' }, SUPER)).toBeNull()
    expect(revertBlock({ ...ancla, promoPaidDate: '2026-10-02' }, ADMIN)).toMatch(/superadmin/)
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
  const paidCuota = { ...cuota, paymentStatus: 'paid', paidAmount: 30000, paidDate: '2026-10-03' }
  const paidAncla = { ...ancla, paymentStatus: 'paid', paidAmount: 81000, paidDate: '2026-10-05' }
  beforeEach(() => {
    markMonthPaid.mockReset().mockResolvedValue({ success: true })
    collectPromo.mockReset().mockResolvedValue({ success: true })
    unmarkMonthPaid.mockReset().mockResolvedValue()
    uncollectPromo.mockReset().mockResolvedValue({ success: true })
    calculateMonthBilling.mockReset().mockResolvedValue({ totalChargeableGross: 30000 })
    getMonthPaymentStates.mockReset().mockResolvedValue(live([
      ['a', 'pending'], ['z', 'pending'], ['b', 'pending', { promo_id: 'p1' }]
    ]))
  })

  test('cada fila va por su función: el mes común sin monto, el ancla cobra el paquete', async () => {
    const dates = { a: '2026-10-03', b: '2026-10-05' }
    const results = await registerPayments([cuota, ancla], { year: 2026, month: 9, dateFor: r => dates[r.id], noteFor: () => '  transferencia  ' })
    expect(markMonthPaid).toHaveBeenCalledWith('a', 2026, 9, null, null, 'transferencia', '2026-10-03')
    expect(collectPromo).toHaveBeenCalledWith('p1', '2026-10-05', null, null, 'transferencia')
    expect(results).toEqual([{ id: 'a', ok: true }, { id: 'b', ok: true }])
    // Cada fila se relee justo antes de escribirla; el paquete no se recalcula
    expect(getMonthPaymentStates.mock.calls).toEqual([[2026, 9, ['a']], [2026, 9, ['b']]])
    expect(calculateMonthBilling).toHaveBeenCalledTimes(1)
  })

  test('un error no corta el resto y queda en su fila', async () => {
    markMonthPaid.mockRejectedValueOnce(new Error('Factura no encontrada'))
    const results = await registerPayments([cuota, { ...cuota, id: 'z' }], { year: 2026, month: 9, dateFor: () => '2026-10-03' })
    expect(results).toEqual([{ id: 'a', ok: false, error: 'Factura no encontrada' }, { id: 'z', ok: true }])
    expect(markMonthPaid).toHaveBeenLastCalledWith('z', 2026, 9, null, null, null, '2026-10-03')
  })

  test('no pisa un cobro registrado desde otro lado mientras la pantalla estaba abierta', async () => {
    getMonthPaymentStates.mockResolvedValue(live([['a', 'paid'], ['z', 'pending'], ['b', 'pending', { promo_id: 'otra' }], ['f', 'pending', { invoice_status: 'invoiced' }]]))
    const rows = [cuota, { ...cuota, id: 'z' }, ancla, { ...cuota, id: 'sinmes' }, { ...cuota, id: 'f' }]
    const results = await registerPayments(rows, { year: 2026, month: 9, dateFor: () => '2026-10-03' })
    expect(results).toEqual([
      { id: 'a', ok: false, error: STALE_PAID },
      { id: 'z', ok: true },
      { id: 'b', ok: false, error: expect.stringMatching(/promo de este mes cambió/) },
      { id: 'sinmes', ok: false, error: expect.stringMatching(/no está generado/) },
      { id: 'f', ok: false, error: INVOICED_UNPAID }
    ])
    expect(markMonthPaid).toHaveBeenCalledTimes(1)
    expect(collectPromo).not.toHaveBeenCalled()
  })

  test('no cobra un monto distinto del que se vio', async () => {
    calculateMonthBilling.mockResolvedValue({ totalChargeableGross: 28500 })
    const [result] = await registerPayments([cuota], { year: 2026, month: 9, dateFor: () => '2026-10-03' })
    expect(result).toEqual({ id: 'a', ok: false, error: 'El monto cambió desde que se cargó la pantalla ($\u00a030.000 → $\u00a028.500): recargá y revisalo antes de cobrar' })
    expect(markMonthPaid).not.toHaveBeenCalled()
  })

  test('conserva las líneas de corrección que dejó un cobro deshecho', async () => {
    const correction = '[05/10/2026] Corrección de cobro: 30000 → 28000 · Admin'
    getMonthPaymentStates.mockResolvedValue(live([['a', 'pending', { payment_notes: `${correction}\nefectivo` }]]))
    await registerPayments([cuota], { year: 2026, month: 9, dateFor: () => '2026-10-03' })
    expect(markMonthPaid).toHaveBeenCalledWith('a', 2026, 9, null, null, correction, '2026-10-03')
    await registerPayments([cuota], { year: 2026, month: 9, dateFor: () => '2026-10-03', noteFor: () => 'giro' })
    expect(markMonthPaid).toHaveBeenLastCalledWith('a', 2026, 9, null, null, `${correction}\ngiro`, '2026-10-03')
  })

  test('revertir relee el mes: el ancla deshace el paquete, un mes común se deshace solo', async () => {
    getMonthPaymentStates.mockResolvedValue(live([['b', 'paid', { promo_id: 'p1', paid_amount: 81000, paid_date: '2026-10-05' }]]))
    await revertPayment(paidAncla, { year: 2026, month: 9 })
    expect(uncollectPromo).toHaveBeenCalledWith('p1')
    expect(unmarkMonthPaid).not.toHaveBeenCalled()
    getMonthPaymentStates.mockResolvedValue(live([['a', 'paid', { paid_amount: 30000, paid_date: '2026-10-03' }]]))
    await revertPayment(paidCuota, { year: 2026, month: 9 })
    expect(unmarkMonthPaid).toHaveBeenCalledWith('a', 2026, 9)
  })

  test('no revierte un mes que se facturó, se revirtió o se volvió a cobrar desde otro lado', async () => {
    getMonthPaymentStates.mockResolvedValue(live([['a', 'paid', { invoice_status: 'invoiced', paid_amount: 30000, paid_date: '2026-10-03' }]]))
    await expect(revertPayment(paidCuota, { year: 2026, month: 9 })).rejects.toThrow(STALE_INVOICED)
    getMonthPaymentStates.mockResolvedValue(live([['a', 'pending']]))
    await expect(revertPayment(paidCuota, { year: 2026, month: 9 })).rejects.toThrow(STALE_NOT_PAID)
    getMonthPaymentStates.mockResolvedValue(live([['a', 'paid', { paid_amount: 30000, paid_date: '2026-10-09' }]]))
    await expect(revertPayment(paidCuota, { year: 2026, month: 9 })).rejects.toThrow(STALE_CHANGED)
    getMonthPaymentStates.mockResolvedValue(live([['a', 'paid', { promo_id: 'nueva', paid_amount: 30000, paid_date: '2026-10-03' }]]))
    await expect(revertPayment(paidCuota, { year: 2026, month: 9 })).rejects.toThrow(STALE_CHANGED)
    // El ancla también se relee: un paquete ya deshecho desde otro lado no se "revierte" de nuevo
    getMonthPaymentStates.mockResolvedValue(live([['b', 'pending', { promo_id: 'p1' }]]))
    await expect(revertPayment(paidAncla, { year: 2026, month: 9 })).rejects.toThrow(STALE_NOT_PAID)
    expect(unmarkMonthPaid).not.toHaveBeenCalled()
    expect(uncollectPromo).not.toHaveBeenCalled()
  })

  test('un paquete roto se repara deshaciendo el paquete entero', async () => {
    getMonthPaymentStates.mockResolvedValue(live([['b', 'pending', { promo_id: 'p1' }]]))
    await revertPayment({ ...ancla, promoPaidDate: '2026-10-02' }, { year: 2026, month: 9 })
    expect(uncollectPromo).toHaveBeenCalledWith('p1')
  })
})
