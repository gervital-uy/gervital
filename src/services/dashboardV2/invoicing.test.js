import {
  attendanceConcept, emissionOpensOn, emitInvoices, invoiceDateOf, invoicePreview, prepareInvoice,
  STALE_CORRECTION, STALE_ISSUED, STALE_UNPAID
} from './invoicing'
import { calculateMonthBilling } from '../invoices/invoiceService'
import { emitInvoice } from '../biller/billerService'
import { getMonthPaymentStates } from './queries'

jest.mock('../invoices/invoiceService', () => ({ calculateMonthBilling: jest.fn() }))
jest.mock('../biller/billerService', () => ({ emitInvoice: jest.fn() }))
jest.mock('./queries', () => ({ getMonthPaymentStates: jest.fn() }))

// Filas del padrón de oct-26 (los montos son los reales de producción, sin nombres).
const base = { frequency: 2, schedule: 'afternoon', hasTransport: false, distanceRange: null, promoId: null, promoIndex: null, promoPercent: null, discountPercent: null }
// Cuota cobrada, con transporte de 2 a 5 km
const cuota = { ...base, id: 'c', attendanceGross: 30000, transportGross: 8320, hasTransport: true, distanceRange: '2_to_5km', paymentStatus: 'paid', paidAmount: 38320 }
// Ancla de la promo 426057b2: cobró el paquete (81.000), su servicio es 27.000
const ancla = { ...base, id: 'a', attendanceGross: 27000, transportGross: 0, paymentStatus: 'paid', paidAmount: 81000, promoId: 'p1', promoIndex: 1, promoPercent: 10 }
// Mes 2 de la promo 9676f2cc, cubierto por el paquete: 27.000 + 5.120 de transporte
const cubierto = { ...base, id: 'm2', attendanceGross: 27000, transportGross: 5120, hasTransport: true, distanceRange: '0_to_2km', paymentStatus: 'prepaid', paidAmount: 0, promoId: 'p2', promoIndex: 2, promoPercent: 10 }

const live = (row, extra = {}) => new Map([[row.id, {
  client_id: row.id, payment_status: row.paymentStatus, invoice_status: 'pending', promo_id: row.promoId, paid_amount: row.paidAmount, biller_id: null, ...extra
}]])
const billingOf = (row, extra = {}) => ({
  attendanceChargeableGross: row.attendanceGross, transportChargeableGross: row.transportGross,
  hasTransport: row.hasTransport, discountPercent: row.promoPercent ?? row.discountPercent ?? 0, ...extra
})

describe('fecha de emisión', () => {
  test('el último día hábil del mes', () => {
    expect(invoiceDateOf(2026, 9)).toBe('2026-10-30') // el 31 es sábado
    expect(invoiceDateOf(2026, 10)).toBe('2026-11-30') // lunes
    expect(invoiceDateOf(2027, 0)).toBe('2027-01-29') // 30 sábado, 31 domingo
  })

  test('no se emite antes de esa fecha', () => {
    expect(emissionOpensOn(2026, 9, '2026-10-31')).toBeNull()
    expect(emissionOpensOn(2026, 9, '2026-10-30')).toBeNull()
    expect(emissionOpensOn(2026, 10, '2026-11-15')).toBe('2026-11-30')
  })
})

describe('lo que dice la factura', () => {
  test('el concepto de asistencia, como en la ficha', () => {
    expect(attendanceConcept({ frequency: 2, schedule: 'afternoon', discountPercent: 0 })).toBe('Plan 2 días x semana – Tarde')
    expect(attendanceConcept({ frequency: 5, schedule: 'full_day', discountPercent: 25 })).toBe('Plan 5 días x semana – Día completo (25% dto)')
    expect(attendanceConcept({ frequency: 2, schedule: 'morning', discountPercent: 12.5 })).toBe('Plan 2 días x semana – Mañana (12.5% dto)')
    expect(attendanceConcept({ frequency: null, schedule: 'afternoon' })).toBeNull()
  })

  test('una cuota cobrada: asistencia y transporte con su IVA', () => {
    expect(invoicePreview(cuota)).toEqual({
      lines: { attGross: 30000, transGross: 8320 },
      items: [
        { concept: 'Plan 2 días x semana – Tarde', amount: 30000, vatRate: 22 },
        { concept: 'Transporte (2 a 5 km)', amount: 8320, vatRate: 10 }
      ],
      total: 38320
    })
  })

  test('el primer mes de una promo factura su servicio con el descuento, no el paquete', () => {
    expect(invoicePreview(ancla)).toEqual({
      lines: { attGross: 27000, transGross: 0 },
      items: [{ concept: 'Plan 2 días x semana – Tarde (10% dto)', amount: 27000, vatRate: 22 }],
      total: 27000
    })
  })

  test('un mes cubierto por el paquete factura su servicio', () => {
    expect(invoicePreview(cubierto).total).toBe(32120)
  })
})

describe('antes de emitir se relee la base', () => {
  beforeEach(() => {
    getMonthPaymentStates.mockReset()
    calculateMonthBilling.mockReset()
  })

  test('sin cambios: las líneas que se mostraron', async () => {
    getMonthPaymentStates.mockResolvedValue(live(ancla))
    calculateMonthBilling.mockResolvedValue(billingOf(ancla))
    await expect(prepareInvoice(ancla, { year: 2026, month: 9 })).resolves.toEqual({
      lines: { attGross: 27000, transGross: 0 }, hasTransport: false, discountPercent: 10
    })
    expect(getMonthPaymentStates).toHaveBeenCalledWith(2026, 9, ['a'])
    expect(calculateMonthBilling).toHaveBeenCalledWith('a', 2026, 9)
  })

  test('no emite lo que ya se emitió, se revirtió o cambió de promo desde otro lado', async () => {
    calculateMonthBilling.mockResolvedValue(billingOf(cuota))
    getMonthPaymentStates.mockResolvedValueOnce(live(cuota, { invoice_status: 'invoiced' }))
    await expect(prepareInvoice(cuota, { year: 2026, month: 9 })).rejects.toThrow(STALE_ISSUED)
    getMonthPaymentStates.mockResolvedValueOnce(live(cuota, { biller_id: 123 }))
    await expect(prepareInvoice(cuota, { year: 2026, month: 9 })).rejects.toThrow(STALE_ISSUED)
    getMonthPaymentStates.mockResolvedValueOnce(live(cuota, { payment_status: 'pending', paid_amount: null }))
    await expect(prepareInvoice(cuota, { year: 2026, month: 9 })).rejects.toThrow(STALE_UNPAID)
    getMonthPaymentStates.mockResolvedValueOnce(live(cuota, { promo_id: 'otra' }))
    await expect(prepareInvoice(cuota, { year: 2026, month: 9 })).rejects.toThrow(/promo de este mes cambió/)
    getMonthPaymentStates.mockResolvedValueOnce(new Map())
    await expect(prepareInvoice(cuota, { year: 2026, month: 9 })).rejects.toThrow(/no está generado/)
    // Un cobro que quedó para corregir no se factura por el monto que ya no corresponde
    getMonthPaymentStates.mockResolvedValueOnce(live(cuota, { correction_pending: true }))
    await expect(prepareInvoice(cuota, { year: 2026, month: 9 })).rejects.toThrow(STALE_CORRECTION)
  })

  test('si el monto cambió desde que se cargó la pantalla, no emite', async () => {
    // Una falta no cobrable cargada después: la promo pasa a 20.250
    getMonthPaymentStates.mockResolvedValue(live(ancla))
    calculateMonthBilling.mockResolvedValue(billingOf(ancla, { attendanceChargeableGross: 20250 }))
    await expect(prepareInvoice(ancla, { year: 2026, month: 9 })).rejects.toThrow('El monto cambió desde que se cargó la pantalla ($\u00a027.000 → $\u00a020.250)')
  })

  test('un cobro corregido desde la ficha cambia lo que se factura', async () => {
    getMonthPaymentStates.mockResolvedValue(live(cuota, { paid_amount: 35000 }))
    calculateMonthBilling.mockResolvedValue(billingOf(cuota))
    await expect(prepareInvoice(cuota, { year: 2026, month: 9 })).rejects.toThrow(/38\.320 → \$\u00a035\.000/)
  })

  test('sin asistencia no hay factura, como en la ficha', async () => {
    const gratis = { ...cubierto, attendanceGross: 0, transportGross: 5120 }
    getMonthPaymentStates.mockResolvedValue(live(gratis))
    calculateMonthBilling.mockResolvedValue(billingOf(gratis))
    await expect(prepareInvoice(gratis, { year: 2026, month: 9 })).rejects.toThrow(/asistencia del mes queda en \$0/)
  })
})

describe('emitir', () => {
  const rows = [cuota, ancla, cubierto]
  beforeEach(() => {
    getMonthPaymentStates.mockReset().mockImplementation((y, m, [id]) => Promise.resolve(live(rows.find(r => r.id === id))))
    calculateMonthBilling.mockReset().mockImplementation(id => Promise.resolve(billingOf(rows.find(r => r.id === id))))
    emitInvoice.mockReset().mockResolvedValue({ ok: true, serie: 'A', numero: '3500' })
  })

  test('cada factura con sus montos, sus conceptos y la fecha del mes', async () => {
    const progress = []
    const results = await emitInvoices(rows, { year: 2026, month: 9, pause: 0, onProgress: (id, state) => progress.push(`${id}:${state}`) })
    expect(emitInvoice.mock.calls).toEqual([
      ['c', 2026, 9, {
        attendanceAmount: 30000, attendanceConcepto: 'Plan 2 días x semana – Tarde',
        transportAmount: 8320, transportConcepto: 'Transporte (2 a 5 km)',
        fechaEmision: '2026-10-30', fechaVencimiento: '2026-10-30'
      }],
      ['a', 2026, 9, {
        attendanceAmount: 27000, attendanceConcepto: 'Plan 2 días x semana – Tarde (10% dto)',
        fechaEmision: '2026-10-30', fechaVencimiento: '2026-10-30'
      }],
      ['m2', 2026, 9, {
        attendanceAmount: 27000, attendanceConcepto: 'Plan 2 días x semana – Tarde (10% dto)',
        transportAmount: 5120, transportConcepto: 'Transporte (0 a 2 km)',
        fechaEmision: '2026-10-30', fechaVencimiento: '2026-10-30'
      }]
    ])
    expect(results).toEqual([
      { id: 'c', ok: true, number: 'A-3500' },
      { id: 'a', ok: true, number: 'A-3500' },
      { id: 'm2', ok: true, number: 'A-3500' }
    ])
    expect(progress).toEqual(['c:emitting', 'c:ok', 'a:emitting', 'a:ok', 'm2:emitting', 'm2:ok'])
  })

  test('sin plan conocido, biller arma el concepto', async () => {
    await emitInvoices([{ ...ancla, frequency: null }], { year: 2026, month: 9, pause: 0 })
    expect(emitInvoice.mock.calls[0][3]).not.toHaveProperty('attendanceConcepto')
  })

  test('un rechazo no corta el resto y trae lo que dijo Biller', async () => {
    const rejection = Object.assign(new Error('Biller rechazó la emisión (HTTP 422)'), { detail: '{"error":"documento inválido"}' })
    emitInvoice.mockRejectedValueOnce(rejection)
    const results = await emitInvoices(rows, { year: 2026, month: 9, pause: 0 })
    expect(results[0]).toEqual({ id: 'c', ok: false, error: 'Biller rechazó la emisión (HTTP 422): {"error":"documento inválido"}' })
    expect(results.slice(1).map(r => r.ok)).toEqual([true, true])
  })

  test('lo que cambió en la base no llega a Biller', async () => {
    getMonthPaymentStates.mockImplementation((y, m, [id]) => Promise.resolve(live(rows.find(r => r.id === id), id === 'a' ? { invoice_status: 'invoiced' } : {})))
    const progress = []
    const results = await emitInvoices(rows, { year: 2026, month: 9, pause: 0, onProgress: (id, state) => progress.push(`${id}:${state}`) })
    // No se arregla reintentando: va marcado como tal
    expect(results[1]).toEqual({ id: 'a', ok: false, error: STALE_ISSUED, stale: true })
    expect(progress).toContain('a:stale')
    expect(emitInvoice.mock.calls.map(c => c[0])).toEqual(['c', 'm2'])
  })

  test('detener durante la pausa entre facturas: la que sigue no sale', async () => {
    let stop = false
    const pending = emitInvoices(rows, { year: 2026, month: 9, pause: 30, shouldStop: () => stop })
    await new Promise(resolve => setTimeout(resolve, 10))
    stop = true
    const results = await pending
    expect(emitInvoice).toHaveBeenCalledTimes(1)
    expect(results.slice(1)).toEqual([{ id: 'a', ok: false, skipped: true }, { id: 'm2', ok: false, skipped: true }])
  })

  test('detener: termina la que está saliendo y deja el resto sin emitir', async () => {
    let stop = false
    emitInvoice.mockImplementationOnce(async () => { stop = true; return { ok: true } })
    const results = await emitInvoices(rows, { year: 2026, month: 9, pause: 0, shouldStop: () => stop })
    expect(results).toEqual([
      { id: 'c', ok: true, number: null },
      { id: 'a', ok: false, skipped: true },
      { id: 'm2', ok: false, skipped: true }
    ])
    expect(emitInvoice).toHaveBeenCalledTimes(1)
  })
})
