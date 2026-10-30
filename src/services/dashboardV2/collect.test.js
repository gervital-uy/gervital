import { canCollect, revertBlock, paymentDateWindow, paymentDateError, registerPayments, revertPayment } from './collect'
import { markMonthPaid, unmarkMonthPaid } from '../invoices/invoiceService'
import { collectPromo, uncollectPromo } from '../promotions/promotionService'

jest.mock('../invoices/invoiceService', () => ({ markMonthPaid: jest.fn(), unmarkMonthPaid: jest.fn() }))
jest.mock('../promotions/promotionService', () => ({ collectPromo: jest.fn(), uncollectPromo: jest.fn() }))

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
  })
})

describe('registrar y revertir', () => {
  beforeEach(() => {
    markMonthPaid.mockResolvedValue({ success: true })
    collectPromo.mockResolvedValue({ success: true })
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

  test('revertir el ancla deshace el paquete; un mes común se deshace solo', async () => {
    await revertPayment({ ...ancla, paymentStatus: 'paid' }, { year: 2026, month: 9 })
    expect(uncollectPromo).toHaveBeenCalledWith('p1')
    expect(unmarkMonthPaid).not.toHaveBeenCalled()
    await revertPayment({ ...cuota, paymentStatus: 'paid' }, { year: 2026, month: 9 })
    expect(unmarkMonthPaid).toHaveBeenCalledWith('a', 2026, 9)
  })
})
