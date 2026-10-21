import { buildBulkRows } from './bulkRows'

const row = (patch = {}) => ({
  id: 'c1', firstName: 'Ana', lastName: 'Pérez', transferResponsible: 'Hija',
  documentNumber: '12345678', amount: 27000, paidAmount: 0,
  paymentStatus: 'pending', invoiceStatus: 'pending',
  promoId: null, promoIndex: null, promoTotal: null, promoTotalAmount: null,
  ...patch
})

const anchor = (patch = {}) => row({ promoId: 'p1', promoIndex: 1, promoTotal: 3, promoTotalAmount: 81000, ...patch })

describe('buildBulkRows — cobrar', () => {
  test('a month outside any promo charges its own amount', () => {
    const [r] = buildBulkRows([row()], 'pay')
    expect(r).toMatchObject({ id: 'c1', name: 'Ana Pérez', amount: 27000, eligibility: 'listo', promoId: null })
  })

  test('the anchor month charges the whole package and is collected as a promo', () => {
    const [r] = buildBulkRows([anchor()], 'pay')
    expect(r.amount).toBe(81000)
    expect(r.promoId).toBe('p1')
    expect(r.eligibility).toBe('listo')
  })

  test('months 2..N of a promo owe nothing and are not chargeable on their own', () => {
    const [r] = buildBulkRows([row({ promoId: 'p1', promoIndex: 2, promoTotal: 3, promoTotalAmount: 81000 })], 'pay')
    expect(r.amount).toBe(0)
    expect(r.eligibility).toBe('en promo')
    expect(r.promoId).toBeNull()
  })

  test('leaves out paid and prepaid months', () => {
    const rows = buildBulkRows([
      row({ id: 'paid', paymentStatus: 'paid' }),
      row({ id: 'prepaid', paymentStatus: 'prepaid' }),
      row({ id: 'pending' })
    ], 'pay')
    expect(rows.map(r => r.id)).toEqual(['pending'])
  })

  test('a zero amount is not chargeable', () => {
    const [r] = buildBulkRows([row({ amount: 0 })], 'pay')
    expect(r.eligibility).toBe('monto 0')
  })
})

describe('buildBulkRows — facturar', () => {
  test('invoices the collected amount when the month was already paid', () => {
    const [r] = buildBulkRows([row({ paymentStatus: 'paid', paidAmount: 25000 })], 'emit')
    expect(r.amount).toBe(25000)
    expect(r.eligibility).toBe('listo')
  })

  test('requires a document', () => {
    const [r] = buildBulkRows([row({ documentNumber: null })], 'emit')
    expect(r.eligibility).toBe('sin CI')
  })

  test('leaves out invoiced months and never collects promos', () => {
    const rows = buildBulkRows([anchor({ id: 'a' }), row({ id: 'inv', invoiceStatus: 'invoiced' })], 'emit')
    expect(rows.map(r => r.id)).toEqual(['a'])
    expect(rows[0].promoId).toBeNull()
  })
})
