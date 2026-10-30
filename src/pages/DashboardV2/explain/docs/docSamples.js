import { buildPadron, collectionTotals, invoicingTotals } from '../../../../services/dashboardV2/padron'

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

export const DOC_SAMPLES = {
  cfp: {
    full: [{ ...base, domain: 'cobranza' }, { ...base, domain: 'facturacion' }],
    partial: { domain: 'facturacion', monthLabel: 'octubre 2026' }
  },
  ivaMes: { full: base, partial: { cfp: { invoicing: {} } } }
}
