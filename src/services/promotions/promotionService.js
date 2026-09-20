import { supabase } from '../supabase/client'

// Fila DB → objeto camelCase.
function fromDb(p, client = {}) {
  return {
    id: p.id,
    clientId: p.client_id,
    firstName: client.firstName || '',
    lastName: client.lastName || '',
    discountPercent: Number(p.discount_percent) || 0,
    discountAmount: Number(p.discount_amount) || 0,
    totalAmount: Number(p.total_amount) || 0,
    startYear: p.start_year,
    startMonth: p.start_month,
    endYear: p.end_year,
    endMonth: p.end_month,
    // null = promo pactada sin cobrar
    paidDate: p.paid_date || null,
    paidAmount: p.paid_amount != null ? Number(p.paid_amount) : null,
    paymentMethod: p.payment_method || null,
    notes: p.notes || null,
    createdAt: p.created_at
  }
}

async function callPromoRpc(fn, params, fallback) {
  const { data, error } = await supabase.rpc(fn, params)
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || fallback)
  return data
}

/**
 * Pactar una promo prepaga (superadmin, validado server-side). NO cobra: deja los
 * meses pendientes, con el total del paquete a cobrar en el primero.
 * @param {string} clientId
 * @param {number} startYear
 * @param {number} startMonth - 0-indexed
 * @param {number} endYear
 * @param {number} endMonth - 0-indexed
 * @param {number} percent - 1..100
 * @param {string} notes - opcional
 */
export async function createPrepaidPromo(clientId, startYear, startMonth, endYear, endMonth, percent, notes = null) {
  return callPromoRpc('create_prepaid_promo', {
    p_client_id: clientId,
    p_start_year: startYear,
    p_start_month: startMonth,
    p_end_year: endYear,
    p_end_month: endMonth,
    p_percent: percent,
    p_notes: notes
  }, 'Error al crear la promoción')
}

/**
 * Cobrar el paquete: el mes ancla queda cobrado con la plata real y el resto
 * de los meses pasan a prepago en $0.
 * @param {string} paidDate - YYYY-MM-DD
 * @param {number} amount - null usa el total pactado
 */
export async function collectPromo(promoId, paidDate, amount = null, method = null, notes = null) {
  return callPromoRpc('collect_promo', {
    p_promo_id: promoId,
    p_paid_date: paidDate,
    p_amount: amount,
    p_method: method,
    p_notes: notes
  }, 'Error al cobrar la promoción')
}

/** Deshacer el cobro. La promo sigue viva y dueña del rango. */
export async function uncollectPromo(promoId) {
  return callPromoRpc('uncollect_promo', { p_promo_id: promoId }, 'Error al deshacer el cobro')
}

/** Cancelar: deshace cobro y descuento, libera los meses y borra la promo. */
export async function cancelPromo(promoId) {
  return callPromoRpc('cancel_promo', { p_promo_id: promoId }, 'Error al cancelar la promoción')
}

/** Todas las promos con nombre del cliente. Admin+superadmin (RLS). */
export async function getPromotions() {
  const [promoRes, clientsRes] = await Promise.all([
    supabase.from('promotions').select('*')
      .order('start_year', { ascending: false })
      .order('start_month', { ascending: false }),
    supabase.from('clients_full').select('id, firstName, lastName')
  ])
  if (promoRes.error) throw new Error(promoRes.error.message)
  if (clientsRes.error) throw new Error(clientsRes.error.message)

  const byId = new Map((clientsRes.data || []).map(c => [c.id, c]))
  return (promoRes.data || []).map(p => fromDb(p, byId.get(p.client_id) || {}))
}

/** Promos de un cliente, para el calendario de su detalle. */
export async function getClientPromotions(clientId) {
  const { data, error } = await supabase
    .from('promotions').select('*')
    .eq('client_id', clientId)
    .order('start_year', { ascending: true })
    .order('start_month', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(p => fromDb(p))
}
