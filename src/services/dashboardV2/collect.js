import { calculateMonthBilling, markMonthPaid, unmarkMonthPaid } from '../invoices/invoiceService'
import { keepCorrectionNotes } from '../invoices/billingCorrection'
import { collectPromo, uncollectPromo } from '../promotions/promotionService'
import { formatCurrency } from '../../utils/format'
import { isBrokenPackage, monthBounds } from './padron'
import { getMonthPaymentStates } from './queries'

// Cobros desde Gestión CFP. Usa las mismas funciones que la ficha del cliente: un
// mes común va por mark_month_paid sin monto (el servidor lo calcula y no queda
// como monto ajustado) y el mes ancla de una promo por collect_promo, que cobra el
// paquete entero y deja los meses siguientes en prepago (mig 092: mark_month_paid
// rechaza cualquier mes con promo). month es 0-indexed.
//
// mark_month_paid y unmarkMonthPaid no miran el estado actual del mes: justo antes
// de escribir cada fila se relee de la base, para no pisar lo que otra persona
// registró desde la ficha mientras esta pantalla estaba abierta.

export const STALE_PAID = 'Ya figura cobrado (se registró desde otro lado): recargá el padrón'
export const STALE_INVOICED = 'Ya tiene factura emitida (se emitió desde otro lado): no se revierte acá'
export const STALE_NOT_PAID = 'Ya no figura cobrado (se revirtió desde otro lado)'
export const STALE_CHANGED = 'El cobro cambió desde otro lado: recargá el padrón'
export const INVOICED_UNPAID = 'Tiene factura emitida sin cobro registrado: registrar el cobro desde acá pisaría el monto facturado'

// Se puede cobrar lo que debe algo propio este mes y no tiene factura. Los meses
// 2..N de una promo no se cobran sueltos, y el paquete solo lo cobra quien maneja
// promos (superadmin).
export function canCollect(row, { canManagePromos }) {
  if (row.paymentStatus !== 'pending' || !(row.due > 0) || row.invoiceStatus === 'invoiced') return false
  if (row.promoIndex == null) return true
  return row.promoIndex === 1 && canManagePromos && !isBrokenPackage(row)
}

// Un cobro mal marcado se revierte acá, salvo que ya tenga factura: sin cobro no
// hay factura, así que primero hay que anularla. Revertir el ancla deshace el cobro
// del paquete entero y la promo vuelve a quedar cobrable; también repara un paquete
// roto (isBrokenPackage).
export function revertBlock(row, { canManagePromos }) {
  if (isBrokenPackage(row)) return canManagePromos ? null : 'Deshacer el cobro de un paquete es solo para superadmin'
  if (row.paymentStatus !== 'paid') return 'Solo se revierte un cobro registrado'
  if (row.invoiceStatus === 'invoiced') return 'Tiene factura emitida: primero hay que anularla desde la ficha del cliente; después el cobro se revierte acá'
  if (row.promoIndex != null && row.promoIndex !== 1) return 'Es un mes de promo: se revierte desde el primer mes del paquete'
  if (row.promoIndex === 1 && !canManagePromos) return 'Deshacer el cobro de un paquete es solo para superadmin'
  return null
}

const pad = n => String(n).padStart(2, '0')
const shiftMonth = (year, month, delta) => {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

// Fechas razonables para un giro de este mes de servicio: hay familias que pagan
// a fin del mes anterior y otras que se atrasan, pero nunca en el futuro.
export function paymentDateWindow(year, month, today) {
  const prev = shiftMonth(year, month, -1)
  const next = shiftMonth(year, month, 1)
  const min = `${prev.year}-${pad(prev.month + 1)}-01`
  const lastOfNext = monthBounds(next.year, next.month).last
  return { min, max: today && today < lastOfNext ? today : lastOfNext }
}

export function paymentDateError(date, window) {
  if (!date) return 'Poné la fecha en que entró el dinero.'
  if (date < window.min || date > window.max) {
    return 'La fecha está fuera del rango para este mes de servicio: si el pago es real, registralo desde la ficha del cliente.'
  }
  return null
}

const samePromo = (row, live) => (live.promo_id || null) === (row.promoId || null)

// Por qué no se puede cobrar con lo que dice la base ahora (null: sigue como lo
// muestra el padrón, pendiente, sin factura y con la misma promo).
function staleReason(row, live) {
  if (!live) return 'El mes no está generado para este cliente: abrí su ficha y volvé a intentar'
  if (live.payment_status !== 'pending') return STALE_PAID
  if (live.invoice_status === 'invoiced') return INVOICED_UNPAID
  if (!samePromo(row, live)) return 'La promo de este mes cambió desde otro lado: recargá el padrón'
  return null
}

// Registra los cobros de a uno y en orden, cada uno con su fecha y su nota. Justo
// antes de cada uno relee el mes y, en un mes común, recalcula el monto: el
// servidor graba el cálculo de ese momento, y si cambió desde que se cargó la
// pantalla (una falta cargada en la ficha) no se cobra un monto que nadie vio. Un
// error no corta el resto: devuelve el resultado de cada fila.
export async function registerPayments(rows, { year, month, dateFor, noteFor = () => null }) {
  const results = []
  for (const row of rows) {
    try {
      const isPackage = row.promoIndex === 1
      const [states, billing] = await Promise.all([
        getMonthPaymentStates(year, month, [row.id]),
        isPackage ? null : calculateMonthBilling(row.id, year, month)
      ])
      const live = states.get(row.id)
      const stale = staleReason(row, live)
      if (stale) {
        results.push({ id: row.id, ok: false, error: stale })
        continue
      }
      const note = noteFor(row)?.trim() || null
      if (isPackage) {
        await collectPromo(row.promoId, dateFor(row), null, null, note)
      } else {
        const amount = Math.round(billing.totalChargeableGross)
        if (amount !== Math.round(row.due)) {
          throw new Error(`El monto cambió desde que se cargó la pantalla (${formatCurrency(row.due)} → ${formatCurrency(amount)}): recargá y revisalo antes de cobrar`)
        }
        // Las líneas de corrección que dejó un cobro deshecho son el rastro de lo
        // realmente recibido: mark_month_paid pisa las notas, así que se conservan.
        const notes = [keepCorrectionNotes(live.payment_notes), note].filter(Boolean).join('\n') || null
        await markMonthPaid(row.id, year, month, null, null, notes, dateFor(row))
      }
      results.push({ id: row.id, ok: true })
    } catch (error) {
      results.push({ id: row.id, ok: false, error: error.message })
    }
  }
  return results
}

// Antes de revertir se relee el mes: ni unmarkMonthPaid ni uncollect_promo miran
// si el cobro sigue siendo el que se ve en pantalla. El ancla va por
// uncollect_promo, que además rechaza promos con meses facturados.
export async function revertPayment(row, { year, month }) {
  const live = (await getMonthPaymentStates(year, month, [row.id])).get(row.id)
  if (!live) throw new Error(STALE_NOT_PAID)
  if (live.invoice_status === 'invoiced') throw new Error(STALE_INVOICED)
  if (!samePromo(row, live)) throw new Error(STALE_CHANGED)
  if (isBrokenPackage(row)) {
    if (live.payment_status !== 'pending') throw new Error(STALE_CHANGED)
    return uncollectPromo(row.promoId)
  }
  if (live.payment_status !== 'paid') throw new Error(STALE_NOT_PAID)
  const sameCollection = Math.round(Number(live.paid_amount) || 0) === Math.round(row.paidAmount || 0)
    && (live.paid_date || null) === (row.paidDate || null)
  if (!sameCollection) throw new Error(STALE_CHANGED)
  return row.promoIndex === 1 ? uncollectPromo(row.promoId) : unmarkMonthPaid(row.id, year, month)
}
