import { markMonthPaid, unmarkMonthPaid } from '../invoices/invoiceService'
import { collectPromo, uncollectPromo } from '../promotions/promotionService'
import { monthBounds } from './padron'

// Cobros desde Gestión CFP. Usa las mismas funciones que la ficha del cliente: un
// mes común va por mark_month_paid sin monto (el servidor lo calcula y no queda
// como monto ajustado) y el mes ancla de una promo por collect_promo, que cobra el
// paquete entero y deja los meses siguientes en prepago (mig 092: mark_month_paid
// rechaza cualquier mes con promo). month es 0-indexed.

// Se puede cobrar lo que debe algo propio este mes. Los meses 2..N de una promo no
// se cobran sueltos, y el paquete solo lo cobra quien maneja promos (superadmin).
export function canCollect(row, { canManagePromos }) {
  if (row.paymentStatus !== 'pending' || !(row.due > 0)) return false
  if (row.promoIndex == null) return true
  return row.promoIndex === 1 && canManagePromos
}

// Un cobro mal marcado se revierte acá, salvo que ya tenga factura: sin cobro no
// hay factura, así que primero hay que anularla (desde la ficha). Revertir el ancla
// deshace el cobro del paquete entero y la promo vuelve a quedar cobrable.
export function revertBlock(row, { canManagePromos }) {
  if (row.paymentStatus !== 'paid') return 'Solo se revierte un cobro registrado'
  if (row.invoiceStatus === 'invoiced') return 'Ya tiene factura emitida: se corrige desde la ficha del cliente'
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
  if (date < window.min || date > window.max) return 'La fecha está fuera del rango razonable para este mes de servicio.'
  return null
}

// Registra los cobros de a uno y en orden, cada uno con su fecha. Un error no corta
// el resto: devuelve el resultado de cada fila.
export async function registerPayments(rows, { year, month, dateFor, note = null }) {
  const results = []
  for (const row of rows) {
    const paidDate = dateFor(row)
    const notes = note?.trim() || null
    try {
      if (row.promoIndex === 1) await collectPromo(row.promoId, paidDate, null, null, notes)
      else await markMonthPaid(row.id, year, month, null, null, notes, paidDate)
      results.push({ id: row.id, ok: true })
    } catch (error) {
      results.push({ id: row.id, ok: false, error: error.message })
    }
  }
  return results
}

export function revertPayment(row, { year, month }) {
  return row.promoIndex === 1 ? uncollectPromo(row.promoId) : unmarkMonthPaid(row.id, year, month)
}
