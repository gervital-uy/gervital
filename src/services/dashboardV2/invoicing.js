import { format } from 'date-fns'
import { calculateMonthBilling } from '../invoices/invoiceService'
import { emitInvoice } from '../biller/billerService'
import { prorateInvoiceLines } from '../invoices/invoiceAmounts'
import { buildTransportConcepto } from '../transport/transportConstants'
import { lastBusinessDayOfMonth } from '../../utils/date'
import { formatCurrency } from '../../utils/format'
import { invoiceLinesOf } from './padron'
import { getMonthPaymentStates } from './queries'

// Emisión de e-facturas desde Gestión CFP. Usa la misma edge function que la ficha
// (biller, acción emit_invoice), de a una y con una pausa entre llamadas por el
// límite de Biller. Los montos viajan explícitos: son los que la persona confirmó,
// armados como los arma biller (invoiceAmounts.js) con lo que dice la base justo
// antes de emitir. Así un mes de promo sale por su servicio aunque la edge function
// todavía no tenga ese arreglo, y nada se emite por un monto que nadie vio.
// month es 0-indexed.

export const RATE_LIMIT_MS = 1100

const SCHEDULE_LABEL = { morning: 'Mañana', afternoon: 'Tarde', full_day: 'Día completo' }

export const STALE_ISSUED = 'Ya tiene factura emitida (se emitió desde otro lado): recargá el padrón'
export const STALE_UNPAID = 'Ya no figura cobrado: sin cobro no se emite factura'
export const STALE_CORRECTION = 'El cobro del mes quedó para corregir: resolvelo en la ficha del cliente antes de facturar'

// Un motivo para no emitir que no se arregla reintentando: hay que recargar el
// padrón (o corregir la ficha) y volver a mirar.
const notRetryable = message => Object.assign(new Error(message), { stale: true })

// Las facturas de un mes salen con fecha del último día hábil de ese mes (emisión y
// vencimiento), no con la del día en que se aprieta el botón.
export const invoiceDateOf = (year, month) => format(lastBusinessDayOfMonth(year, month), 'yyyy-MM-dd')

// Antes de esa fecha no se emite: la factura saldría con fecha futura. Devuelve la
// fecha desde la que se puede emitir, o null si ya se puede.
export function emissionOpensOn(year, month, today) {
  const date = invoiceDateOf(year, month)
  return today && today < date ? date : null
}

// Concepto de la línea de asistencia, igual que el modal de la ficha. Sin plan
// conocido no se manda y biller arma el suyo.
export function attendanceConcept({ frequency, schedule, discountPercent }) {
  if (!frequency || !SCHEDULE_LABEL[schedule]) return null
  const discount = Number(discountPercent) > 0 ? ` (${Number(discountPercent)}% dto)` : ''
  return `Plan ${frequency} días x semana – ${SCHEDULE_LABEL[schedule]}${discount}`
}

// Lo que va a decir la factura de una fila del padrón: cada línea con su texto, su
// monto y su tasa de IVA. El descuento de un mes de promo es el de la promo.
export function invoicePreview(row) {
  const lines = invoiceLinesOf(row)
  const discountPercent = row.promoPercent ?? row.discountPercent
  const items = [{
    concept: attendanceConcept({ frequency: row.frequency, schedule: row.schedule, discountPercent }) || 'Plan del mes',
    amount: lines.attGross,
    vatRate: 22
  }]
  if (row.hasTransport && lines.transGross > 0) {
    items.push({ concept: buildTransportConcepto(row.distanceRange), amount: lines.transGross, vatRate: 10 })
  }
  return { lines, items, total: lines.attGross + lines.transGross }
}

// Por qué no se puede emitir con lo que dice la base ahora (null: sigue como lo
// muestra el padrón, cobrado, sin factura y con la misma promo).
function staleReason(row, live) {
  if (!live) return 'El mes no está generado para este cliente: abrí su ficha y volvé a intentar'
  if (live.invoice_status === 'invoiced' || live.biller_id) return STALE_ISSUED
  if (live.payment_status !== 'paid' && live.payment_status !== 'prepaid') return STALE_UNPAID
  if ((live.promo_id || null) !== (row.promoId || null)) return 'La promo de este mes cambió desde otro lado: recargá el padrón'
  if (live.correction_pending) return STALE_CORRECTION
  return null
}

// Relee el mes y lo recalcula justo antes de emitir. Si algo cambió desde que se
// cargó la pantalla (se emitió o se revirtió desde la ficha, cambió la asistencia),
// no se emite: se avisa para revisar.
export async function prepareInvoice(row, { year, month }) {
  const [states, billing] = await Promise.all([
    getMonthPaymentStates(year, month, [row.id]),
    calculateMonthBilling(row.id, year, month)
  ])
  const live = states.get(row.id)
  const stale = staleReason(row, live)
  if (stale) throw notRetryable(stale)

  const lines = prorateInvoiceLines({
    paymentStatus: live.payment_status,
    paidAmount: live.paid_amount,
    liveAttGross: billing.attendanceChargeableGross,
    liveTransGross: billing.transportChargeableGross,
    hasTransport: billing.hasTransport,
    promoId: live.promo_id
  })
  const shown = invoiceLinesOf(row)
  if (lines.attGross !== shown.attGross || lines.transGross !== shown.transGross) {
    const before = formatCurrency(shown.attGross + shown.transGross)
    const now = formatCurrency(lines.attGross + lines.transGross)
    throw notRetryable(before === now
      ? 'Cambió el reparto entre asistencia y transporte desde que se cargó la pantalla: recargá y revisalo antes de emitir'
      : `El monto cambió desde que se cargó la pantalla (${before} → ${now}): recargá y revisalo antes de emitir`)
  }
  // Como el modal de la ficha: sin asistencia no hay factura (un descuento del 100%).
  if (lines.attGross <= 0) throw notRetryable('La asistencia del mes queda en $0: no hay factura que emitir')
  return { lines, hasTransport: billing.hasTransport, discountPercent: billing.discountPercent }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Emite de a una y en orden. Un error no corta el resto: devuelve el resultado de
// cada fila (ok; error, con stale si reintentar no lo arregla; o skipped si se
// detuvo antes de llegar). onProgress avisa cuándo empieza y cómo termina cada una.
export async function emitInvoices(rows, { year, month, onProgress = () => {}, shouldStop = () => false, pause = RATE_LIMIT_MS }) {
  const date = invoiceDateOf(year, month)
  const results = []
  let calledBiller = false
  for (const row of rows) {
    // La pausa va entre llamadas a Biller, no después de una fila que no llegó a
    // salir. Detener vale también durante la pausa: lo que no salió, no sale.
    if (calledBiller && !shouldStop()) await sleep(pause)
    calledBiller = false
    if (shouldStop()) {
      results.push({ id: row.id, ok: false, skipped: true })
      continue
    }
    onProgress(row.id, 'emitting')
    try {
      const { lines, hasTransport, discountPercent } = await prepareInvoice(row, { year, month })
      const concept = attendanceConcept({ frequency: row.frequency, schedule: row.schedule, discountPercent })
      calledBiller = true
      const res = await emitInvoice(row.id, year, month, {
        attendanceAmount: lines.attGross,
        ...(concept ? { attendanceConcepto: concept } : {}),
        ...(hasTransport ? { transportAmount: lines.transGross, transportConcepto: buildTransportConcepto(row.distanceRange) } : {}),
        fechaEmision: date,
        fechaVencimiento: date
      })
      const number = res?.serie && res?.numero ? `${res.serie}-${res.numero}` : null
      results.push({ id: row.id, ok: true, number })
      onProgress(row.id, 'ok')
    } catch (error) {
      const detail = error.detail ? `: ${String(error.detail).slice(0, 200)}` : ''
      const message = `${error.message}${detail}`
      results.push({ id: row.id, ok: false, error: message, ...(error.stale ? { stale: true } : {}) })
      onProgress(row.id, error.stale ? 'stale' : 'error', message)
    }
  }
  return results
}
