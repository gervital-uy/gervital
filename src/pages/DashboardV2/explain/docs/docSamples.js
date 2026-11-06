import { buildPadron, collectionTotals, invoicingTotals } from '../../../../services/dashboardV2/padron'
import { buildCommercial } from '../../../../services/dashboardV2/commercialView'

// Contextos de muestra para el test de integridad de las explicaciones (solo lo
// importa docs.test.js). Uno por explicación registrada en index.js:
//   id: { full: ctx o lista de ctx con todos los datos, partial: ctx a medio cargar }
// Con `full` la explicación tiene que cerrar (valores en todas las filas y la suma
// igual al total); con `partial` y con {} alcanza con que no se rompa.

// Un padrón chico pero completo: cuota cobrada, cuota pendiente, ancla de promo
// cobrada y facturada por el paquete, mes cubierto, y una fila sin CI.
const PROMO = { promo_id: 'p1', promo_total: 3, promo_percent: 10, promo_total_amount: 81000, attendance_gross: 27000, transport_gross: 0 }
const panel = [
  { client_id: 'a', attendance_gross: 24400, transport_gross: 11000, payment_status: 'paid', paid_amount: 35400, invoice_status: 'invoiced', invoiced_amount: 35400 },
  { client_id: 'b', attendance_gross: 30000, transport_gross: 0, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'c', ...PROMO, promo_index: 1, payment_status: 'paid', paid_amount: 81000, invoice_status: 'invoiced', invoiced_amount: 81000 },
  { client_id: 'd', ...PROMO, promo_index: 2, payment_status: 'prepaid', paid_amount: 0, invoice_status: 'pending' },
  { client_id: 'e', attendance_gross: 20000, transport_gross: 0, payment_status: 'paid', paid_amount: 20000, invoice_status: 'pending' }
]
const clients = ['a', 'b', 'c', 'd', 'e'].map(id => ({
  id, firstName: 'X', lastName: id, documentNumber: id === 'e' ? null : '1', email: 'x@y.com', address: { street: 's' }
}))
const breakdown = panel.map(p => ({ clientId: p.client_id, frequency: 3, schedule: 'afternoon', hasTransport: p.transport_gross > 0 }))
const rows = buildPadron({ panel, clients, breakdown }, { year: 2026, month: 9, today: '2026-10-30' })
const cfp = { collection: collectionTotals(rows), invoicing: invoicingTotals(rows) }
const base = { cfp, monthLabel: 'octubre 2026' }
// Una fila con el emitido distinto del servicio (el ancla facturada por el paquete)
// hace que la fila de "monto distinto" de la explicación no sea un cero.

// Una cartera chica para Comercial (hoy = 6 de noviembre de 2026):
//   a heredado, 2× tarde con transporte y 10% de descuento en octubre
//   b heredado de día completo, se va el 15 de octubre (en pausa temporal)
//   c alta de septiembre, 1× tarde, sin fecha de nacimiento
//   d alta de octubre, 2× tarde, tier C
//   e heredado que en octubre baja de 2× a 1× (mueve el MRR sin entrar ni salir)
const person = (id, over = {}) => ({ id, firstName: id, lastName: 'X', clientType: 'regular', startDate: '2026-06-01', birthDate: '1941-03-02', cognitiveLevel: 'B', distanceRange: '0_to_2km', ...over })
const planOf = (clientId, over = {}) => ({ clientId, effectiveFrom: '2026-06-01', frequency: 2, schedule: 'afternoon', hasTransport: false, assignedDays: ['tuesday', 'thursday'], ...over })
const price = (frequency, schedule, priceNet) => ({ frequency, schedule, priceNet, effectiveYear: 2000, effectiveMonth: 0 })
const commercialModel = buildCommercial({
  clients: [
    person('a'),
    person('b', { cognitiveLevel: 'D', birthDate: '1931-02-01' }),
    person('c', { startDate: '2026-09-10', cognitiveLevel: 'A', birthDate: null }),
    person('d', { startDate: '2026-10-05', cognitiveLevel: 'C' }),
    person('e', { birthDate: '1950-08-20' })
  ],
  periods: [{ clientId: 'b', fromDate: '2026-10-15', toDate: null, reason: 'health_decline' }],
  followups: [{ clientId: 'b', stage: 'temporary_pause', deactivationDate: '2026-10-15' }],
  plans: [
    planOf('a', { hasTransport: true }),
    planOf('b', { frequency: 5, schedule: 'full_day', assignedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }),
    planOf('c', { effectiveFrom: '2026-09-01', frequency: 1, assignedDays: ['friday'] }),
    planOf('d', { effectiveFrom: '2026-10-01', assignedDays: ['monday', 'wednesday'] }),
    planOf('e'),
    planOf('e', { effectiveFrom: '2026-10-01', frequency: 1, assignedDays: ['tuesday'] })
  ],
  discounts: [{ clientId: 'a', year: 2026, month: 9, discountPercent: 10 }],
  planPricing: [price(1, 'afternoon', 16393.44), price(2, 'afternoon', 24590.16), price(5, 'full_day', 66393.44)],
  transportPricing: [{ frequency: 2, distanceRange: '0_to_2km', priceNet: 4654.55, effectiveYear: 2000, effectiveMonth: 0 }],
  reasons: [{ key: 'health_decline', label: 'Deterioro de salud', color: '#dc2626', sortOrder: 3 }],
  shiftCapacity: '20'
}, { today: '2026-11-06' })

// El contexto que arma CommercialSection para un mes, con lo elegido en cada tarjeta.
const commercialCtx = (month, { capacity, compositionDim = 'frequency', mixDim = 'schedule', exitWindow = 12, cohortView = 'quarter' } = {}) => {
  const m = commercialModel.month(commercialModel.indexOf(2026, month))
  return {
    month: m,
    occupancy: capacity ? m.simulateOccupancy(capacity) : m.occupancy,
    composition: { dimension: compositionDim, rows: m.composition[compositionDim] },
    mix: { dimension: mixDim, rows: m.mix[mixDim] },
    exits: m.exitsByReason(exitWindow),
    cohorts: m.cohorts(cohortView),
    monthLabel: `${['junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre'][month - 5]} 2026`
  }
}
// Octubre (con baja en pausa, alta, cambio de plan y descuento), junio (el mes del
// lanzamiento, con la base heredada) y noviembre en curso con un aforo a prueba.
const COMMERCIAL_FULL = [
  commercialCtx(9),
  commercialCtx(5, { compositionDim: 'age', mixDim: 'cognitiveLevel', exitWindow: null, cohortView: 'month' }),
  commercialCtx(10, { capacity: 8, compositionDim: 'cognitiveLevel', mixDim: 'frequency', exitWindow: 6 })
]
const commercialSample = partial => ({ full: COMMERCIAL_FULL, partial: { monthLabel: 'octubre 2026', ...partial } })

export const DOC_SAMPLES = {
  cfp: {
    full: [{ ...base, domain: 'collection' }, { ...base, domain: 'invoicing' }],
    partial: { domain: 'invoicing', monthLabel: 'octubre 2026' }
  },
  monthVat: { full: base, partial: { cfp: { invoicing: {} } } },
  activeClients: commercialSample({ month: { counts: { opening: 3 } } }),
  mrr: commercialSample({ month: { mrr: { closing: { total: 1000 } } } }),
  mrrFlow: commercialSample({ month: { mrr: { opening: 1000 }, counts: {} } }),
  churn: commercialSample({ month: { churn: { window: { months: 4 } } } }),
  tenure: commercialSample({ month: { tenure: { measured: 0 } } }),
  occupancy: commercialSample({ occupancy: { capacity: 30 } }),
  heatmapSeats: commercialSample({ occupancy: { capacity: 30 } }),
  heatmapTiers: commercialSample({ occupancy: {} }),
  composition: commercialSample({ composition: { dimension: 'age' } }),
  revenueMix: commercialSample({ mix: { dimension: 'schedule', rows: [] } }),
  clientFlow: commercialSample({ month: { counts: { altas: 1 } } }),
  exitsByReason: commercialSample({ exits: { requested: 12 } }),
  cohorts: commercialSample({ cohorts: { mode: 'month' } })
}
