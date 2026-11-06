import { supabase } from '../supabase/client'
import { getEmployees, getStandaloneExtraCosts } from '../salaries/salaryService'
import { getFixedExpenses } from '../expenses/fixedExpenseService'
import { getExpensesByMonth } from '../expenses/expenseService'
import { getExtraordinaryByMonth } from '../expenses/extraordinaryExpenseService'
import { getSetting } from '../settings/appSettingsService'
import { monthBounds } from './padron'
import { unwrap } from './queries'

// Lecturas de la pestaña Finanzas. Todo sale de lo que ya existe en la base: sin
// funciones, vistas ni tablas nuevas. Se calcula en el navegador. month es 0-indexed.

const PAYMENT_FIELDS = 'client_id, year, month, payment_status, paid_amount, paid_date, promo_id, attendance_chargeable_gross, transport_chargeable_gross'

// Lo de un mes: el panel (una llamada por mes, la misma población que el padrón de
// Gestión CFP), los cobros con fecha de pago en el mes y los gastos variables y
// extraordinarios del mes. Por mes y no de una vez: cada lectura queda en pocas
// filas, lejos del tope de filas de la API.
export async function getFinanceMonthSources(year, month) {
  const { first, last } = monthBounds(year, month)
  const [panel, payments, variableRows, extraordinaryRows] = await Promise.all([
    supabase.rpc('get_month_collection_panel', { p_year: year, p_month: month }).then(unwrap),
    supabase
      .from('monthly_invoices')
      .select(PAYMENT_FIELDS)
      .eq('payment_status', 'paid')
      .gte('paid_date', first)
      .lte('paid_date', last)
      .then(unwrap),
    getExpensesByMonth(year, month),
    getExtraordinaryByMonth(year, month)
  ])
  return { year, month, panel, payments, variableRows: variableRows || [], extraordinaryRows: extraordinaryRows || [] }
}

// Prestadores con sus fechas: la vigencia sale de created_at y, si está dado de
// baja, de updated_at (B6). El servicio de Costos no expone updated_at.
async function getServiceProvidersWithDates() {
  const rows = await supabase
    .from('service_providers')
    .select('id, name, role, monthly_amount, active, created_at, updated_at')
    .then(unwrap)
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    role: r.role,
    monthlyAmount: Number(r.monthly_amount) || 0,
    active: r.active !== false,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }))
}

// Lo que no depende del mes: empleadas con su historia de sueldos y extras, los
// extraordinarios sin empleado (con el aporte de directores), los prestadores, las
// plantillas de gastos fijos y el mes ancla del aporte de directores. Un error no se
// tapa con una lista vacía: faltaría un gasto y el resultado saldría inflado.
export async function getFinanceCosts() {
  const [employees, extraCosts, providers, fixedTemplates, directorStart] = await Promise.all([
    getEmployees(),
    getStandaloneExtraCosts(),
    getServiceProvidersWithDates(),
    getFixedExpenses(),
    getSetting('director_contribution_start')
  ])
  return { employees, extraCosts, providers, fixedTemplates, directorStart }
}

// La programación de transporte de un mes: autos por turno y día con sus pasajeros,
// los viajes por cliente y día, y la banda de distancia de cada cliente.
export async function getTransportMonthSources(year, month) {
  const { first, last } = monthBounds(year, month)
  const [arrangements, tripCounts, clients] = await Promise.all([
    supabase.from('transport_day_arrangements').select('id, date').gte('date', first).lte('date', last).then(unwrap),
    supabase.from('transport_trip_counts').select('client_id, date, trip_count').gte('date', first).lte('date', last).then(unwrap),
    supabase.from('clients_full').select('id, address').then(unwrap)
  ])
  const dateById = new Map(arrangements.map(a => [a.id, a.date]))
  const cars = dateById.size
    ? await supabase
      .from('transport_shift_cars')
      .select('arrangement_id, shift, seat_count, transport_shift_assignments ( client_id )')
      .in('arrangement_id', [...dateById.keys()])
      .then(unwrap)
    : []
  return {
    year,
    month,
    cars: cars.map(c => ({
      date: dateById.get(c.arrangement_id),
      shift: c.shift,
      seatCount: Number(c.seat_count) || 0,
      clientIds: (c.transport_shift_assignments || []).map(a => a.client_id)
    })),
    tripCounts: tripCounts.map(t => ({ clientId: t.client_id, date: t.date, tripCount: Number(t.trip_count) || 0 })),
    clients: clients.map(c => ({ id: c.id, distanceRange: c.address?.distanceRange || null }))
  }
}
