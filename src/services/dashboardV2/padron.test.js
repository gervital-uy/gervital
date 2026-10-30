import {
  buildPadron, collectionTotals, invoicingTotals, sortRows, monthEvents, needsProration,
  isPastDue, ivaOf, blockOf, receiverWarnings, paymentOffset, rowAmount
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
  startDate: '2026-07-01',
  deactivationDate: null,
  inactivityPeriods: [],
  ...over
})

// rows: [id, panel overrides, client overrides, plan overrides]
const build = (rows, extra = {}, ctx = OCT) => buildPadron({
  panel: rows.map(([id, over]) => panelRow(id, over)),
  clients: rows.map(([id, , c]) => client(id, c)),
  breakdown: rows.map(([id, , , plan]) => ({ clientId: id, frequency: 3, schedule: 'afternoon', hasTransport: false, ...plan })),
  invoices: [],
  promotions: [],
  ...extra
}, ctx)

const PROMO = { promo_id: 'p1', promo_total: 3, promo_percent: 10, promo_total_amount: 81000, attendance_gross: 27000 }

describe('buildPadron — qué se cobra y qué se factura', () => {
  test('cuota común pendiente: se debe y se factura el cálculo en vivo', () => {
    const [r] = build([['a']])
    expect(r).toMatchObject({ due: 30000, expected: 30000, billable: 30000, isCollected: false, collectionBucket: 'pending', invoiceBucket: 'uncollected', canEmit: false })
  })

  test('cuota cobrada: cuenta lo que entró y se factura lo cobrado', () => {
    const [r] = build([['a', { payment_status: 'paid', paid_amount: 28000, paid_date: '2026-10-04' }]])
    expect(r).toMatchObject({ expected: 28000, billable: 28000, collectionBucket: 'done', invoiceBucket: 'pending', canEmit: true })
  })

  test('promo: el ancla cobra el paquete y cada mes factura su propio servicio', () => {
    const [ancla, mes2] = build([
      ['ancla', { ...PROMO, promo_index: 1, payment_status: 'paid', paid_amount: 81000, paid_date: '2026-10-05' }],
      ['mes2', { ...PROMO, promo_index: 2, payment_status: 'prepaid', paid_amount: 0 }]
    ], { promotions: [{ id: 'p1', paid_date: '2026-10-05' }] })
    expect(ancla).toMatchObject({ due: 81000, expected: 81000, billable: 27000, promoPaidDate: '2026-10-05' })
    expect(mes2).toMatchObject({ due: 0, expected: 0, billable: 27000, isCollected: true, collectionBucket: 'done', canEmit: true })
  })

  test('promo pactada sin cobrar: los meses 2..N esperan el paquete, no se cobran sueltos ni se facturan', () => {
    const rows = build([['ancla', { ...PROMO, promo_index: 1 }], ['mes2', { ...PROMO, promo_index: 2 }]])
    const [ancla, mes2] = rows
    expect(ancla).toMatchObject({ due: 81000, collectionBucket: 'pending', awaitingPackage: false })
    expect(mes2).toMatchObject({ due: 0, awaitingPackage: true, collectionBucket: 'pending', invoiceBucket: 'uncollected', canEmit: false })
    // Ni "por cobrar" (no debe nada propio) ni "al día" (el paquete no entró)
    expect(collectionTotals(rows)).toMatchObject({ dueCount: 1, upToDate: 0, awaitingPackage: 1, coveredCount: 0 })
  })

  test('un mes en $0 no se cobra ni se factura: queda en los hechos', () => {
    const [r] = build([['a', { attendance_gross: 0 }]])
    expect(r).toMatchObject({ due: 0, billable: 0, collectionBucket: 'done', invoiceBucket: 'issued', canEmit: false })
    expect(collectionTotals([r]).dueCount).toBe(0)
    expect(invoicingTotals([r]).notIssued).toBe(0)
  })

  test('descuento puntual: viene de invoices_view; en un mes de promo no se duplica', () => {
    const [r, p] = build(
      [['a'], ['b', { promo_id: 'p1', promo_index: 1, promo_total: 1, promo_total_amount: 25000 }]],
      { invoices: [{ clientId: 'a', discountPercent: 20 }, { clientId: 'b', discountPercent: 10 }] }
    )
    expect(r.discountPercent).toBe(20)
    expect(p.discountPercent).toBeNull()
  })

  test('el plan es el del mes (desglose), no el de hoy; el transporte cobrado manda', () => {
    const [r] = buildPadron({
      panel: [panelRow('a', { transport_gross: 11000 })],
      clients: [client('a', { plan: { frequency: 5, schedule: 'full_day' } })],
      breakdown: [{ clientId: 'a', frequency: 2, schedule: 'morning', hasTransport: false }]
    }, OCT)
    expect(r).toMatchObject({ frequency: 2, schedule: 'morning', hasTransport: true })
  })
})

describe('lo emitido', () => {
  const anchorInvoiced = ['a', {
    ...PROMO, attendance_gross: 27000, transport_gross: 5120, promo_index: 1, promo_total_amount: 96360,
    payment_status: 'paid', paid_amount: 96360, invoice_status: 'invoiced', invoiced_amount: 96360, invoice_number: 'A-3475'
  }, {}, { hasTransport: true }]

  test('emitido distinto de lo que corresponde queda marcado; igual o a un peso, no', () => {
    const rows = build([
      anchorInvoiced,
      ['b', { payment_status: 'paid', paid_amount: 30000, invoice_status: 'invoiced', invoiced_amount: 30000 }],
      ['c', { payment_status: 'paid', paid_amount: 30000, invoice_status: 'invoiced', invoiced_amount: 30001 }]
    ])
    expect(rows.map(r => r.invoiceMismatch)).toEqual([true, false, false])
    expect(invoicingTotals(rows)).toMatchObject({ mismatchCount: 1, issuedMismatch: 96360 - 32120 + 1 })
  })

  test('el IVA de lo emitido sale de las líneas tal como se emitieron', () => {
    const [r] = build([anchorInvoiced], { invoices: [{ clientId: 'a', attendanceChargeableGross: 81000, transportChargeableGross: 15360 }] })
    expect(r.invoicedIva).toBe(ivaOf({ attGross: 81000, transGross: 15360 }))
    // Sin las líneas guardadas, se reparte lo emitido como la emisión
    const [fallback] = build([anchorInvoiced])
    expect(fallback.invoicedIva).toBeGreaterThan(0)
    expect(invoicingTotals([r])).toMatchObject({ issuedVat: r.invoicedIva, vat: r.invoicedIva, pendingVat: 0 })
  })

  test('las cuentas cierran: a facturar − emitido + distinto = falta emitir', () => {
    const rows = build([anchorInvoiced, ['b', { payment_status: 'paid', paid_amount: 30000 }], ['c']])
    const f = invoicingTotals(rows)
    expect(f.billable - f.issued + f.issuedMismatch).toBe(f.toIssue)
    expect(f.toIssue).toBe(60000)
  })
})

describe('vencimiento, altas, bajas y reingresos', () => {
  test('vencido pasado el día 11 del mes, como la ficha del cliente', () => {
    expect(isPastDue(2026, 9, '2026-10-11')).toBe(false)
    expect(isPastDue(2026, 9, '2026-10-12')).toBe(true)
    expect(isPastDue(2026, 10, '2026-10-30')).toBe(false)
    const [late] = build([['a']])
    const [early] = build([['a']], {}, { ...OCT, today: '2026-10-05' })
    expect(late.isOverdue).toBe(true)
    expect(early.isOverdue).toBe(false)
    expect(collectionTotals([late]).overdueCount).toBe(1)
  })

  test('alta del mes por fecha; los heredados (fecha de lanzamiento) no son alta', () => {
    expect(monthEvents({ startDate: '2026-10-01' }, 2026, 9)).toMatchObject({ startDay: 1 })
    expect(monthEvents({ startDate: '2026-06-01' }, 2026, 5)).toMatchObject({ startDay: null })
    expect(monthEvents({ startDate: '2026-06-15' }, 2026, 5)).toMatchObject({ startDay: 15 })
  })

  test('bajas y reingresos salen de los períodos de inactividad', () => {
    const periods = [{ fromDate: '2026-06-26', toDate: '2026-09-29' }]
    expect(monthEvents({ startDate: '2026-06-01', inactivityPeriods: periods }, 2026, 5)).toMatchObject({ leaveDay: 26, returnDay: null, inactive: true })
    expect(monthEvents({ startDate: '2026-06-01', inactivityPeriods: periods }, 2026, 7)).toMatchObject({ leaveDay: null, returnDay: null, inactive: true })
    expect(monthEvents({ startDate: '2026-06-01', inactivityPeriods: periods }, 2026, 8)).toMatchObject({ returnDay: 29, inactive: true })
    expect(monthEvents({ startDate: '2026-06-01', inactivityPeriods: periods }, 2026, 9)).toMatchObject({ leaveDay: null, returnDay: null, inactive: false })
    // Sin períodos en la ficha, la fecha de baja cacheada
    expect(monthEvents({ deactivationDate: '2026-10-29' }, 2026, 9)).toMatchObject({ leaveDay: 29, inactive: true })
  })

  test('solo las filas que pueden ser parciales piden días', () => {
    expect(needsProration({ startDay: 1, inactive: false })).toBe(false)
    expect(needsProration({ startDay: 12, inactive: false })).toBe(true)
    expect(needsProration({ startDay: null, inactive: true })).toBe(true)
  })

  test('los días prorrateados son los que cobra el cálculo: cobrables sobre 4 × frecuencia', () => {
    const rows = build(
      [['a', {}, { startDate: '2026-10-19' }, { frequency: 2 }], ['b', {}, { startDate: '2026-10-02' }, { frequency: 2 }]],
      { billing: { a: { isProrated: true, chargeableDays: 4 }, b: { isProrated: false, chargeableDays: 8 } } }
    )
    expect(rows[0]).toMatchObject({ startDay: 19, proration: { days: 4, of: 8 } })
    // Entró el 2 pero cobra el mes entero: no es proporcional
    expect(rows[1]).toMatchObject({ startDay: 2, proration: null })
  })
})

describe('bloqueos y avisos de facturación', () => {
  test('sin CI no se emite; un rechazo de Biller se puede reintentar pero no está "lista"', () => {
    expect(blockOf({ invoiceStatus: 'pending', documentNumber: null })).toMatchObject({ chip: 'falta CI', family: 'record' })
    expect(blockOf({ invoiceStatus: 'pending', documentNumber: '1', emitError: 'HTTP 400' })).toMatchObject({ chip: 'error Biller', family: 'biller' })
    expect(blockOf({ invoiceStatus: 'invoiced', documentNumber: null })).toBeNull()
    const rows = build([
      ['a', { payment_status: 'paid', paid_amount: 30000 }, { documentNumber: null }],
      ['b', { payment_status: 'paid', paid_amount: 30000 }],
      ['c', {}, { documentNumber: null }],
      ['d', { payment_status: 'paid', paid_amount: 30000 }]
    ], { invoices: [{ clientId: 'b', emitError: 'HTTP 400' }] })
    expect(rows.map(r => r.canEmit)).toEqual([false, true, false, true])
    expect(invoicingTotals(rows)).toMatchObject({
      notIssued: 4, ready: 1, awaitingPayment: 1, missingRecordData: 1, rejected: 1,
      blockedRecord: 2, blockedBiller: 1, blockedCollected: 2, blockedUncollected: 1,
      blockedReasons: ['2 falta CI', '1 error Biller']
    })
  })

  test('correo y dirección avisan pero no frenan', () => {
    expect(receiverWarnings({ invoiceStatus: 'pending', email: null, street: null })).toEqual(['sin correo', 'sin dirección'])
    expect(receiverWarnings({ invoiceStatus: 'pending', email: 'familia@gmial', street: 'x' })).toEqual(['correo inválido'])
    expect(receiverWarnings({ invoiceStatus: 'invoiced', email: null, street: null })).toEqual([])
    const [r] = build([['a', { payment_status: 'paid', paid_amount: 30000 }, { email: null, address: { street: null } }]])
    expect(r).toMatchObject({ block: null, canEmit: true, invoiceBucket: 'pending' })
    expect(invoicingTotals([r])).toMatchObject({ ready: 1, withWarnings: 1, blockedRecord: 0 })
  })
})

describe('totales', () => {
  test('cobranza: previsto = cobrado + pendiente; cuotas + paquetes = previsto', () => {
    const rows = build([
      ['a', { payment_status: 'paid', paid_amount: 30000 }],
      ['b'],
      ['ancla', { ...PROMO, promo_index: 1, payment_status: 'paid', paid_amount: 81000 }],
      ['mes3', { ...PROMO, promo_index: 3, payment_status: 'prepaid', paid_amount: 0 }]
    ])
    const t = collectionTotals(rows)
    expect(t).toMatchObject({ clients: 4, expected: 141000, collected: 111000, outstanding: 30000, dueCount: 1, upToDate: 3, packages: 81000, packageCount: 1, monthlyExpected: 60000, coveredNominal: 27000, coveredCount: 1 })
    expect(t.monthlyExpected + t.packages).toBe(t.expected)
    expect(t.collectedPct).toBeCloseTo(78.72, 1)
  })

  test('sin padrón los porcentajes no inventan un 0%', () => {
    expect(collectionTotals([]).collectedPct).toBeNull()
  })

  test('IVA por línea al 22% y al 10%, también repartiendo lo cobrado y en un mes de promo', () => {
    expect(ivaOf({ attGross: 30000, transGross: 0 })).toBe(30000 - Math.round(30000 / 1.22))
    expect(ivaOf({ attGross: 0, transGross: 11000 })).toBe(1000)
    const [same, prorated, promo] = build([
      ['a', { attendance_gross: 24400, transport_gross: 11000, payment_status: 'paid', paid_amount: 35400 }, {}, { hasTransport: true }],
      // Cobró 30.000 sobre un vivo de 24.400 + 11.000: se reparte como la emisión
      ['b', { attendance_gross: 24400, transport_gross: 11000, payment_status: 'paid', paid_amount: 30000 }, {}, { hasTransport: true }],
      // Ancla cobrada por el paquete: el IVA es el del servicio del mes, no el del paquete
      ['c', { ...PROMO, promo_index: 1, payment_status: 'paid', paid_amount: 81000 }]
    ])
    expect(same.iva).toBe(4400 + 1000)
    expect(prorated.iva).toBe(ivaOf({ attGross: 30000 - 9322, transGross: 9322 }))
    expect(promo.iva).toBe(ivaOf({ attGross: 27000, transGross: 0 }))
    expect(invoicingTotals([same, prorated, promo]).pendingVat).toBe(same.iva + prorated.iva + promo.iva)
  })
})

describe('orden y desfase de fecha', () => {
  test('plan y promos: cuotas por frecuencia, después promos (ancla primero), después descuentos; empates por monto', () => {
    const rows = [
      { id: 'dto', discountPercent: 20, frequency: 5, expected: 1, billable: 1 },
      { id: 'mes2', promoIndex: 2, frequency: 5, expected: 0, billable: 1 },
      { id: 'ancla', promoIndex: 1, frequency: 1, expected: 1, billable: 1 },
      { id: 'f2', frequency: 2, expected: 1, billable: 1 },
      { id: 'f5chica', frequency: 5, expected: 10, billable: 10 },
      { id: 'f5grande', frequency: 5, expected: 90, billable: 90 }
    ]
    expect(sortRows(rows, 'plan', 'collection').map(r => r.id)).toEqual(['f5grande', 'f5chica', 'f2', 'ancla', 'mes2', 'dto'])
  })

  test('mayor monto ordena por el monto que se ve en cada panel', () => {
    const paidMore = { id: 'cobro39', expected: 39000, due: 30000, billable: 39000, invoiceStatus: 'pending' }
    const other = { id: 'cuota38', expected: 38320, due: 38320, billable: 38320, invoiceStatus: 'pending' }
    expect(sortRows([other, paidMore], 'amount', 'collection').map(r => r.id)).toEqual(['cobro39', 'cuota38'])
    const issuedPackage = { id: 'ancla', invoiceStatus: 'invoiced', invoicedAmount: 96360, billable: 32120 }
    const prepaidMonth = { id: 'mes2', invoiceStatus: 'pending', billable: 27000, expected: 0 }
    const cuota = { id: 'cuota', invoiceStatus: 'pending', billable: 20000, expected: 20000 }
    expect(sortRows([cuota, prepaidMonth, issuedPackage], 'amount', 'invoicing').map(r => r.id)).toEqual(['ancla', 'mes2', 'cuota'])
    expect(rowAmount(issuedPackage, 'invoicing')).toBe(96360)
    expect(sortRows([{ id: 'x', lastName: 'Ñandú' }, { id: 'y', lastName: 'Nuñez' }], 'name').map(r => r.id)).toEqual(['y', 'x'])
  })

  test('un giro antes del mes es anticipado y después, atrasado', () => {
    expect(paymentOffset('2026-09-28', 2026, 9)).toBe('anticipado')
    expect(paymentOffset('2026-10-05', 2026, 9)).toBeNull()
    expect(paymentOffset('2026-11-02', 2026, 9)).toBe('atrasado')
    expect(paymentOffset(null, 2026, 9)).toBeNull()
  })
})
