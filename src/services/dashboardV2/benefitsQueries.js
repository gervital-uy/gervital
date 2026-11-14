import { supabase } from '../supabase/client'
import { getPromotions } from '../promotions/promotionService'
import { calculateMonthBilling } from '../invoices/invoiceService'
import { promoOrdinal } from '../promotions/promotionsView'
import { unwrap } from './queries'
import { PLATFORM_START_ORD, ymOfOrdinal } from './benefitsView'

// Lecturas del bloque Promociones y otros descuentos. Todo sale de lo que ya existe
// en la base (la v2 no agrega funciones, vistas ni tablas). month es 0-indexed.

const numOrNull = v => (v == null ? null : Number(v))

// Los meses con beneficio de todos los clientes (una promo o un descuento suelto)
// desde el lanzamiento, con el estado de cobro y la asistencia cobrada (la foto que
// guarda el cobro): de un mes cerrado no queda otra cosa para medir su descuento.
export async function getBenefitLedger() {
  const rows = await supabase
    .from('monthly_invoices')
    .select('client_id, year, month, discount_percent, discount_reason, promo_id, payment_status, attendance_chargeable_gross')
    .or('discount_percent.gt.0,promo_id.not.is.null')
    .gte('year', ymOfOrdinal(PLATFORM_START_ORD).year)
    .then(unwrap)
  return rows
    .filter(r => promoOrdinal(r.year, r.month) >= PLATFORM_START_ORD)
    .map(r => ({
      clientId: r.client_id,
      year: r.year,
      month: r.month,
      discountPercent: Number(r.discount_percent) || 0,
      discountReason: r.discount_reason || null,
      promoId: r.promo_id || null,
      paymentStatus: r.payment_status || 'pending',
      attendanceChargeableGross: numOrNull(r.attendance_chargeable_gross)
    }))
}

// Nombre, foto y períodos de inactividad de todos los clientes, también los dados de
// baja: el historial los nombra, y un acuerdo futuro de un cliente que no va a volver
// no es un próximo.
export async function getBenefitClients() {
  const rows = await supabase.from('clients_full').select('id, firstName, lastName, avatarUrl, deactivationDate, inactivityPeriods').then(unwrap)
  return rows.map(c => ({
    id: c.id,
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    avatarUrl: c.avatarUrl || null,
    deactivationDate: c.deactivationDate || null,
    inactivityPeriods: c.inactivityPeriods
  }))
}

// La población que cobra un mes (la misma del padrón), para la cobertura de hace seis meses.
export async function getPanelClientIds(year, month) {
  const rows = await supabase.rpc('get_month_collection_panel', { p_year: year, p_month: month }).then(unwrap)
  return rows.map(r => r.client_id)
}

// El cálculo del mes de cada cliente con beneficio, para su precio de lista. Si el de
// un cliente falla, queda afuera y su descuento se reconstruye de lo cobrable.
export async function getMonthBenefitBilling(year, month, clientIds) {
  const pairs = await Promise.all(clientIds.map(id => calculateMonthBilling(id, year, month).then(b => [id, b], () => null)))
  return Object.fromEntries(pairs.filter(Boolean))
}

// Todo lo que el bloque necesita además del padrón del mes (que ya carga Gestión CFP):
// buildBenefits({ padron, ...fuentes }, { year, month }).
export async function loadBenefitSources({ year, month }) {
  const pastOrd = promoOrdinal(year, month) - 6
  const past = pastOrd >= PLATFORM_START_ORD ? ymOfOrdinal(pastOrd) : null
  const [promotions, ledger, clients, pastIds] = await Promise.all([
    getPromotions(),
    getBenefitLedger(),
    getBenefitClients(),
    // La comparación con hace seis meses es un agregado: si falla, el resto se muestra igual.
    past ? getPanelClientIds(past.year, past.month).catch(() => null) : null
  ])
  const ids = [...new Set(ledger.filter(r => r.year === year && r.month === month).map(r => r.clientId))]
  const billing = await getMonthBenefitBilling(year, month, ids)
  return { promotions, ledger, clients, billing, pastBase: past && pastIds ? { ...past, clientIds: pastIds } : null }
}
