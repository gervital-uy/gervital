import {
  buildPadron, collectionTotals, invoicingTotals, sortRows, monthEvents, needsProration,
  isPastDue, ivaOf, blockOf, receiverWarnings, paymentOffset
} from './padron'

// Octubre 2026 (month 9). Montos con IVA, como los devuelve get_month_collection_panel.
const OCT = { year: 2026, month: 9, today: '2026-10-30' }

const panelRow = (id, over = {}) => ({
  client_id: id,
  attendance_gross: 30000,
  transport_gross: 0,
  payment_status: 'pending',
  invoice_status: 'pending',
  paid_amount: null,
  paid_date: null,
  invoice_number: null,
  invoice_date: null,
  invoiced_amount: null,
  promo_index: null,
  promo_total: null,
  promo_percent: null,
  promo_total_amount: null,
  promo_id: null,
  ...over
})

const client = (id, over = {}) => ({
  id,
  firstName: 'Ana',
  lastName: id.toUpperCase(),
  documentNumber: '12345678',
  email: 'ana@gmail.com',
  address: { street: 'Av. Italia 2345', distanceRange: null },
  startDate: '2026-06-01',
  deactivationDate: null,
  ...over
})

const build = (rows, extra = {}, ctx = OCT) => buildPadron({
  panel: rows.map(([id, over]) => panelRow(id, over)),
  clients: rows.map(([id, , c]) => client(id, c)),
  breakdown: rows.map(([id]) => ({ clientId: id, frequency: 3, schedule: 'afternoon', hasTransport: false })),
  invoices: [],
  promotions: [],
  ...extra
}, ctx)

describe('buildPadron — qué se cobra y qué se factura', () => {
  test('cuota común pendiente: se debe y se factura el cálculo en vivo', () => {
    const [r] = build([['a']])
    expect(r).toMatchObject({ due: 30000, expected: 30000, billable: 30000, isCollected: false, collectionBucket: 'pendientes', invoiceBucket: 'nocobrado', canEmit: false })
  })

  test('cuota cobrada: cuenta lo que entró y se factura lo cobrado', () => {
    const [r] = build([['a', { payment_status: 'paid', paid_amount: 28000, paid_date: '2026-10-04' }]])
    expect(r).toMatchObject({ expected: 28000, billable: 28000, collectionBucket: 'hechas', invoiceBucket: 'pendientes', canEmit: true })
  })

  test('promo: el ancla cobra el paquete y cada mes factura su propio servicio', () => {
    const promo = { promo_id: 'p1', promo_total: 3, promo_percent: 10, promo_total_amount: 81000, attendance_gross: 27000 }
    const rows = build([
      ['ancla', { ...promo, promo_index: 1, payment_status: 'paid', paid_amount: 81000, paid_date: '2026-10-05' }],
      ['mes2', { ...promo, promo_index: 2, payment_status: 'prepaid', paid_amount: 0 }]
    ], { promotions: [{ id: 'p1', paid_date: '2026-10-05' }] })
    const [ancla, mes2] = rows
    expect(ancla).toMatchObject({ due: 81000, expected: 81000, billable: 27000, promoPaidDate: '2026-10-05' })
    expect(mes2).toMatchObject({ due: 0, expected: 0, billable: 27000, isCollected: true, collectionBucket: 'hechas', canEmit: true })
  })

  test('promo pactada sin cobrar: los meses 2..N no se cobran sueltos ni se facturan', () => {
    const promo = { promo_id: 'p1', promo_total: 3, promo_percent: 10, promo_total_amount: 81000, attendance_gross: 27000 }
    const [ancla, mes2] = build([['ancla', { ...promo, promo_index: 1 }], ['mes2', { ...promo, promo_index: 2 }]])
    expect(ancla).toMatchObject({ due: 81000, collectionBucket: 'pendientes' })
    expect(mes2).toMatchObject({ due: 0, collectionBucket: 'pendientes', invoiceBucket: 'nocobrado', canEmit: false })
    expect(collectionTotals([ancla, mes2]).pendientes).toBe(1)
  })

  test('un mes en $0 no se cobra ni se factura: queda en los hechos', () => {
    const [r] = build([['a', { attendance_gross: 0 }]])
    expect(r).toMatchObject({ due: 0, billable: 0, collectionBucket: 'hechas', invoiceBucket: 'emitidas', canEmit: false })
    expect(collectionTotals([r]).pendientes).toBe(0)
    expect(invoicingTotals([r]).sinEmitir).toBe(0)
  })

  test('descuento puntual: viene de invoices_view; en un mes de promo no se duplica', () => {
    const [r, p] = build(
      [['a'], ['b', { promo_id: 'p1', promo_index: 1, promo_total: 1, promo_total_amount: 25000 }]],
      { invoices: [{ clientId: 'a', discountPercent: 20 }, { clientId: 'b', discountPercent: 10 }] }
    )
    expect(r.discountPercent).toBe(20)
    expect(p.discountPercent).toBeNull()
  })

  test('lo emitido distinto de lo que corresponde queda marcado (ancla facturada por el paquete)', () => {
    const [r] = build([['a', {
      promo_id: 'p1', promo_index: 1, promo_total: 3, promo_total_amount: 96360, attendance_gross: 32120,
      payment_status: 'paid', paid_amount: 96360, invoice_status: 'invoiced', invoiced_amount: 96360, invoice_number: 'A-3475'
    }]])
    expect(r).toMatchObject({ billable: 32120, invoicedAmount: 96360, invoiceMismatch: true })
    expect(invoicingTotals([r]).distintas).toBe(1)
  })

  test('el plan es el del mes (desglose), no el de hoy', () => {
    const [r] = buildPadron({
      panel: [panelRow('a')],
      clients: [client('a', { plan: { frequency: 5, schedule: 'full_day' } })],
      breakdown: [{ clientId: 'a', frequency: 2, schedule: 'morning', hasTransport: false }]
    }, OCT)
    expect(r).toMatchObject({ frequency: 2, schedule: 'morning' })
  })
})

describe('vencimiento, altas y bajas', () => {
  test('vencido pasado el día 11 del mes, como la ficha del cliente', () => {
    expect(isPastDue(2026, 9, '2026-10-11')).toBe(false)
    expect(isPastDue(2026, 9, '2026-10-12')).toBe(true)
    expect(isPastDue(2026, 10, '2026-10-30')).toBe(false)
    const [late] = build([['a']])
    const [early] = build([['a']], {}, { ...OCT, today: '2026-10-05' })
    expect(late.isOverdue).toBe(true)
    expect(early.isOverdue).toBe(false)
    expect(collectionTotals([late]).vencidos).toBe(1)
  })

  test('alta y baja del mes por fecha; solo las parciales piden días', () => {
    expect(monthEvents({ startDate: '2026-10-01' }, 2026, 9)).toEqual({ startDay: 1, leaveDay: null })
    expect(monthEvents({ startDate: '2026-09-20', deactivationDate: '2026-10-29' }, 2026, 9)).toEqual({ startDay: null, leaveDay: 29 })
    expect(needsProration({ startDay: 1, leaveDay: null })).toBe(false)
    expect(needsProration({ startDay: 12, leaveDay: null })).toBe(true)
    expect(needsProration({ startDay: null, leaveDay: 29 })).toBe(true)
  })

  test('días prorrateados solo cuando son menos que el mes completo', () => {
    const rows = build(
      [['a', {}, { startDate: '2026-10-19' }], ['b', {}, { startDate: '2026-10-01' }]],
      { billing: { a: { plannedDays: 4, fullMonthDays: 9 }, b: { plannedDays: 9, fullMonthDays: 9 } } }
    )
    expect(rows[0]).toMatchObject({ startDay: 19, proration: { days: 4, of: 9 } })
    expect(rows[1]).toMatchObject({ startDay: 1, proration: null })
  })
})

describe('bloqueos y avisos de facturación', () => {
  test('sin CI no se emite; un rechazo de Biller se puede reintentar', () => {
    expect(blockOf({ invoiceStatus: 'pending', documentNumber: null })).toMatchObject({ chip: 'falta CI', family: 'ficha' })
    expect(blockOf({ invoiceStatus: 'pending', documentNumber: '1', emitError: 'HTTP 400' })).toMatchObject({ chip: 'error Biller', family: 'facturador' })
    expect(blockOf({ invoiceStatus: 'invoiced', documentNumber: null })).toBeNull()
    const [noCi, rejected] = build([
      ['a', { payment_status: 'paid', paid_amount: 30000 }, { documentNumber: null }],
      ['b', { payment_status: 'paid', paid_amount: 30000 }]
    ], { invoices: [{ clientId: 'b', emitError: 'HTTP 400' }] })
    expect(noCi.canEmit).toBe(false)
    expect(rejected.canEmit).toBe(true)
    expect(invoicingTotals([noCi, rejected])).toMatchObject({ trabadasFicha: 1, trabadasFacturador: 1, detalleTrabadas: ['1 falta CI', '1 error Biller'] })
  })

  test('correo y dirección avisan pero no frenan', () => {
    expect(receiverWarnings({ invoiceStatus: 'pending', email: null, street: null })).toEqual(['sin correo', 'sin dirección'])
    expect(receiverWarnings({ invoiceStatus: 'pending', email: 'familia@gmial', street: 'x' })).toEqual(['correo inválido'])
    expect(receiverWarnings({ invoiceStatus: 'invoiced', email: null, street: null })).toEqual([])
  })
})

describe('totales', () => {
  test('cobranza: previsto = cobrado + pendiente; los paquetes ya están en el previsto', () => {
    const promo = { promo_id: 'p1', promo_total: 3, promo_percent: 10, promo_total_amount: 81000, attendance_gross: 27000 }
    const rows = build([
      ['a', { payment_status: 'paid', paid_amount: 30000 }],
      ['b'],
      ['ancla', { ...promo, promo_index: 1, payment_status: 'paid', paid_amount: 81000 }],
      ['mes3', { ...promo, promo_index: 3, payment_status: 'prepaid', paid_amount: 0 }]
    ])
    const t = collectionTotals(rows)
    expect(t).toMatchObject({ clientes: 4, previsto: 141000, cobrado: 111000, pendiente: 30000, pendientes: 1, alDia: 3, paquetes: 81000, paquetesCount: 1, previstoCuotas: 60000, prepagasNominal: 27000 })
    expect(t.pctCobro).toBeCloseTo(78.72, 1)
  })

  test('sin padrón los porcentajes no inventan un 0%', () => {
    expect(collectionTotals([]).pctCobro).toBeNull()
  })

  test('facturación: IVA por línea al 22% y al 10%', () => {
    expect(ivaOf({ attGross: 30000, transGross: 0 })).toBe(30000 - Math.round(30000 / 1.22))
    expect(ivaOf({ attGross: 0, transGross: 11000 })).toBe(1000)
    const [r] = buildPadron({
      panel: [panelRow('a', { attendance_gross: 24400, transport_gross: 11000, payment_status: 'paid', paid_amount: 35400 })],
      clients: [client('a')],
      breakdown: [{ clientId: 'a', frequency: 3, schedule: 'afternoon', hasTransport: true }]
    }, OCT)
    expect(r.iva).toBe(4400 + 1000)
    expect(invoicingTotals([r])).toMatchObject({ facturableTotal: 35400, ivaDelMes: 5400, sinEmitir: 1, listas: 1 })
  })
})

describe('orden y desfase de fecha', () => {
  test('plan y promos: cuotas por frecuencia, después promos (ancla primero), después descuentos', () => {
    const rows = [
      { id: 'dto', discountPercent: 20, frequency: 5, due: 1, billable: 1 },
      { id: 'mes2', promoIndex: 2, frequency: 5, due: 0, billable: 1 },
      { id: 'ancla', promoIndex: 1, frequency: 1, due: 1, billable: 1 },
      { id: 'f2', frequency: 2, due: 1, billable: 1 },
      { id: 'f5', frequency: 5, due: 1, billable: 1 }
    ]
    expect(sortRows(rows, 'plan', 'cobranza').map(r => r.id)).toEqual(['f5', 'f2', 'ancla', 'mes2', 'dto'])
    expect(sortRows([{ id: 'x', due: 1 }, { id: 'y', due: 9 }], 'monto', 'cobranza').map(r => r.id)).toEqual(['y', 'x'])
    expect(sortRows([{ id: 'x', lastName: 'Ñandú' }, { id: 'y', lastName: 'Nuñez' }], 'nombre').map(r => r.id)).toEqual(['y', 'x'])
  })

  test('un giro antes del mes es anticipado y después, atrasado', () => {
    expect(paymentOffset('2026-09-28', 2026, 9)).toBe('anticipado')
    expect(paymentOffset('2026-10-05', 2026, 9)).toBeNull()
    expect(paymentOffset('2026-11-02', 2026, 9)).toBe('atrasado')
    expect(paymentOffset(null, 2026, 9)).toBeNull()
  })
})
