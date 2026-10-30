import { supabase } from '../supabase/client'
import { getBillingBreakdown } from '../dashboard/dashboardService'
import { calculateMonthBilling } from '../invoices/invoiceService'
import { todayStr } from '../../utils/date'
import { buildPadron, monthEvents, needsProration } from './padron'

// Lecturas del dashboard v2. Todo sale de lo que ya existe en la base: la v2 no
// agrega funciones, vistas ni tablas. month es 0-indexed.

const CLIENT_FIELDS = 'id, firstName, lastName, avatarUrl, documentNumber, email, address, plan, transferResponsible, startDate, deactivationDate, inactivityPeriods'
const INVOICE_FIELDS = 'clientId, discountPercent, emitError, dgiStatus, correctionPending, isAmountOverridden, paymentNotes, attendanceChargeableGross, transportChargeableGross'

const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data || []
}

// Las cinco lecturas del padrón del mes, en paralelo, más los días prorrateados de
// las altas, bajas y reingresos del mes (pocas filas: una llamada a
// calculate_month_billing cada una).
export async function getPadronSources(year, month) {
  const [panel, clients, breakdown, invoices] = await Promise.all([
    supabase.rpc('get_month_collection_panel', { p_year: year, p_month: month }).then(unwrap),
    supabase.from('clients_full').select(CLIENT_FIELDS).then(unwrap),
    getBillingBreakdown(year, month),
    supabase.from('invoices_view').select(INVOICE_FIELDS).eq('year', year).eq('month', month).then(unwrap)
  ])

  const promoIds = [...new Set(panel.map(p => p.promo_id).filter(Boolean))]
  const inPanel = new Set(panel.map(p => p.client_id))
  const prorated = clients.filter(c => inPanel.has(c.id) && needsProration(monthEvents(c, year, month)))

  const [promotions, billingPairs] = await Promise.all([
    promoIds.length
      ? supabase.from('promotions').select('id, paid_date').in('id', promoIds).then(unwrap)
      : [],
    // Si el cálculo de un cliente falla, la fila se muestra igual, sin los días.
    Promise.all(prorated.map(c => calculateMonthBilling(c.id, year, month).then(b => [c.id, b], () => [c.id, null])))
  ])

  return { panel, clients, breakdown, invoices, promotions, billing: Object.fromEntries(billingPairs) }
}

export async function loadPadron({ year, month }) {
  const sources = await getPadronSources(year, month)
  return buildPadron(sources, { year, month, today: todayStr() })
}
