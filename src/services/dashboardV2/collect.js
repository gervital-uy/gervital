import { markMonthPaid, unmarkMonthPaid } from '../invoices/invoiceService'
import { collectPromo, uncollectPromo } from '../promotions/promotionService'
import { monthBounds } from './padron'
import { getMonthPaymentStates } from './queries'

// Cobros desde Gestión CFP. Usa las mismas funciones que la ficha del cliente: un
// mes común va por mark_month_paid sin monto (el servidor lo calcula y no queda
// como monto ajustado) y el mes ancla de una promo por collect_promo, que cobra el
// paquete entero y deja los meses siguientes en prepago (mig 092: mark_month_paid
// rechaza cualquier mes con promo). month es 0-indexed.
//
// mark_month_paid y unmarkMonthPaid no miran el estado actual del mes: antes de
// escribir se relee de la base, para no pisar lo que otra persona registró desde
// la ficha mientras esta pantalla estaba abierta.

export const STALE_PAID = 'Ya figura cobrado (se registró desde otro lado): recargá el padrón'
export const STALE_INVOICED = 'Ya tiene factura emitida (se emitió desde otro lado): no se revierte acá'
export const STALE_NOT_PAID = 'Ya no figura cobrado (se revirtió desde otro lado)'

// Se puede cobrar lo que debe algo propio este mes. Los meses 2..N de una promo no
// se cobran sueltos, y el paquete solo lo cobra quien maneja promos (superadmin).
export function canCollect(row, { canManagePromos }) {
  if (row.paymentStatus !== 'pending' || !(row.due > 0)) return false
  if (row.promoIndex == null) return true
  return row.promoIndex === 1 && canManagePromos
}

// Un cobro mal marcado se revierte acá, salvo que ya tenga factura: sin cobro no
// hay factura, así que primero hay que anularla. Revertir el ancla deshace el cobro
// del paquete entero y la promo vuelve a quedar cobrable.
export function revertBlock(row, { canManagePromos }) {
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

// Por qué no se puede cobrar con lo que dice la base ahora (null: sigue como lo
// muestra el padrón, pendiente y con la misma promo).
function staleReason(row, live) {
  if (!live) return 'El mes no está generado para este cliente: abrí su ficha y volvé a intentar'
  if (live.payment_status !== 'pending') return STALE_PAID
  if ((live.promo_id || null) !== (row.promoId || null)) return 'La promo de este mes cambió desde otro lado: recargá el padrón'
  return null
}

// Registra los cobros de a uno y en orden, cada uno con su fecha. Un error no corta
// el resto: devuelve el resultado de cada fila.
export async function registerPayments(rows, { year, month, dateFor, note = null }) {
  const live = await getMonthPaymentStates(year, month, rows.map(r => r.id))
  const notes = note?.trim() || null
  const results = []
  for (const row of rows) {
    const stale = staleReason(row, live.get(row.id))
    if (stale) {
      results.push({ id: row.id, ok: false, error: stale })
      continue
    }
    try {
      if (row.promoIndex === 1) await collectPromo(row.promoId, dateFor(row), null, null, notes)
      else await markMonthPaid(row.id, year, month, null, null, notes, dateFor(row))
      results.push({ id: row.id, ok: true })
    } catch (error) {
      results.push({ id: row.id, ok: false, error: error.message })
    }
  }
  return results
}

// El ancla va por uncollect_promo, que ya rechaza promos con meses facturados. Un
// mes común se relee antes: unmarkMonthPaid no mira si el mes ya se facturó.
export async function revertPayment(row, { year, month }) {
  if (row.promoIndex === 1) return uncollectPromo(row.promoId)
  const live = (await getMonthPaymentStates(year, month, [row.id])).get(row.id)
  if (live?.invoice_status === 'invoiced') throw new Error(STALE_INVOICED)
  if (live?.payment_status !== 'paid') throw new Error(STALE_NOT_PAID)
  return unmarkMonthPaid(row.id, year, month)
}
