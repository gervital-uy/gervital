import { supabase } from '../supabase/client'
import { getPlanPricing } from '../pricing/pricingService'
import { getTransportPricing } from '../pricing/transportPricingService'
import { getReasons } from '../churn/deactivationReasonService'
import { getSetting, setSetting } from '../settings/appSettingsService'
import { todayStr } from '../../utils/date'
import { buildCommercial } from './commercialView'
import { isValidShiftCapacity, SHIFT_CAPACITY_KEY, SHIFT_CAPACITY_RANGE } from './occupancy'
import { unwrap } from './queries'

// Lecturas en bloque de la pestaña Comercial. Todo sale de lo que ya existe en la
// base (la v2 no agrega funciones, vistas ni tablas) y se calcula en el navegador:
// son tablas chicas y alcanza con una lectura de cada una para todos los meses.
// No se usa get_churn_board: además de leer, crea tarjetas de seguimiento.

const CLIENT_FIELDS = 'id, firstName, lastName, avatarUrl, birthDate, cognitiveLevel, startDate, clientType, deactivationDate, trialStartedAt, trialConvertedAt, address'

// PostgREST corta cada respuesta en 1.000 filas. client_plans suma una versión por
// cliente casi todos los meses, así que se lee por páginas (con un orden fijo para
// que las páginas no se pisen).
export const PAGE_SIZE = 1000

async function readAll(query) {
  const out = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = await query().range(from, from + PAGE_SIZE - 1).then(unwrap)
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
}

export async function getCommercialSources() {
  const [clients, periods, plans, discounts, followups, planPricing, transportPricing, reasons, shiftCapacity] = await Promise.all([
    supabase.from('clients_full').select(CLIENT_FIELDS).then(unwrap),
    supabase.from('client_inactivity_periods').select('client_id, from_date, to_date, reason').then(unwrap),
    readAll(() => supabase
      .from('client_plans')
      .select('id, client_id, effective_from, frequency, schedule, has_transport, assigned_days')
      .order('id')),
    supabase.from('invoices_view').select('clientId, year, month, discountPercent').gt('discountPercent', 0).then(unwrap),
    supabase.from('churn_followups').select('client_id, stage, deactivation_date').then(unwrap),
    getPlanPricing(),
    getTransportPricing(),
    getReasons({ includeInactive: true }),
    // Sin el aforo guardado (o sin poder leerlo) la ocupación usa el de por defecto
    // y lo avisa: no tiene que frenar el resto de la pestaña.
    getSetting(SHIFT_CAPACITY_KEY).catch(() => null)
  ])

  return {
    clients: clients.map(({ address, ...c }) => ({ ...c, distanceRange: address?.distanceRange || null })),
    periods: periods.map(p => ({ clientId: p.client_id, fromDate: p.from_date, toDate: p.to_date, reason: p.reason })),
    plans: plans.map(p => ({
      clientId: p.client_id,
      effectiveFrom: p.effective_from,
      frequency: p.frequency,
      schedule: p.schedule,
      hasTransport: !!p.has_transport,
      assignedDays: p.assigned_days || []
    })),
    discounts: discounts.map(d => ({ clientId: d.clientId, year: d.year, month: d.month, discountPercent: Number(d.discountPercent) || 0 })),
    followups: followups.map(f => ({ clientId: f.client_id, stage: f.stage, deactivationDate: f.deactivation_date })),
    planPricing,
    transportPricing,
    reasons: reasons.map(r => ({ key: r.key, label: r.label, color: r.color, sortOrder: r.sortOrder })),
    shiftCapacity
  }
}

// El modelo entero de la pestaña: una sola carga para todos los meses.
export async function loadCommercial() {
  const sources = await getCommercialSources()
  return buildCommercial(sources, { today: todayStr() })
}

// Guarda el aforo por turno, solo cuando alguien lo pide desde la pantalla (la RLS
// de app_settings deja escribir a admin y superadmin).
export async function saveShiftCapacity(value) {
  const text = String(value ?? '').trim()
  if (!isValidShiftCapacity(text)) {
    throw new Error(`El aforo tiene que ser un número entero de lugares por turno, entre ${SHIFT_CAPACITY_RANGE.min} y ${SHIFT_CAPACITY_RANGE.max}`)
  }
  await setSetting(SHIFT_CAPACITY_KEY, text)
}
