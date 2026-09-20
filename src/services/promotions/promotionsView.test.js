import {
  promoOrdinal, promoState, promoMonthIndex, promoMonthCollection, promoKpis
} from './promotionsView'

// month es 0-indexed (0 = enero), salvo dentro de 'YYYY-MM-DD'.
const promo = (over) => ({
  id: 'p', clientId: 'c', discountPercent: 15,
  startYear: 2026, startMonth: 5, endYear: 2026, endMonth: 7, // 2026-06 .. 2026-08
  paidDate: null, paidAmount: null, totalAmount: 90000, discountAmount: 4500, ...over
})

describe('promoOrdinal', () => {
  test('year*12+month', () => {
    expect(promoOrdinal(2026, 0)).toBe(24312)
    expect(promoOrdinal(2026, 5)).toBe(24317)
  })
})

describe('promoState', () => {
  test('empieza después del ref -> upcoming', () => {
    expect(promoState(promo({ startYear: 2026, startMonth: 9, endYear: 2026, endMonth: 11 }), 2026, 6)).toBe('upcoming')
  })
  test('termina antes del ref -> expired', () => {
    expect(promoState(promo({ startYear: 2026, startMonth: 0, endYear: 2026, endMonth: 2 }), 2026, 6)).toBe('expired')
  })
  test('dentro del rango y lejos del final -> active', () => {
    expect(promoState(promo(), 2026, 5)).toBe('active')
  })
  test('termina en el ref -> expiring', () => {
    expect(promoState(promo(), 2026, 7)).toBe('expiring')
  })
  test('termina en ref+1 -> expiring', () => {
    expect(promoState(promo(), 2026, 6)).toBe('expiring')
  })
  test('devuelve un solo estado: nunca active y expiring a la vez', () => {
    const states = [5, 6, 7].map(m => promoState(promo(), 2026, m))
    expect(states).toEqual(['active', 'expiring', 'expiring'])
  })
  test('cruza el año correctamente', () => {
    const p = promo({ startYear: 2026, startMonth: 11, endYear: 2027, endMonth: 1 }) // dic .. feb
    expect(promoState(p, 2026, 10)).toBe('upcoming')
    expect(promoState(p, 2026, 11)).toBe('active')
    expect(promoState(p, 2027, 0)).toBe('expiring')
    expect(promoState(p, 2027, 2)).toBe('expired')
  })
})

describe('promoMonthIndex', () => {
  test('1-based dentro del rango', () => {
    expect(promoMonthIndex(promo(), 2026, 5)).toBe(1)
    expect(promoMonthIndex(promo(), 2026, 7)).toBe(3)
  })
  test('null fuera del rango', () => {
    expect(promoMonthIndex(promo(), 2026, 4)).toBeNull()
    expect(promoMonthIndex(promo(), 2026, 8)).toBeNull()
  })
})

describe('promoMonthCollection', () => {
  test('el mes ancla cobra el paquete entero y tacha su nominal', () => {
    expect(promoMonthCollection({ promoIndex: 1, promoTotalAmount: 81000, monthAmount: 27000 }))
      .toEqual({ due: 81000, struck: 27000 })
  })
  test('los meses siguientes no cobran nada', () => {
    expect(promoMonthCollection({ promoIndex: 2, promoTotalAmount: 81000, monthAmount: 27000 }))
      .toEqual({ due: 0, struck: 27000 })
    expect(promoMonthCollection({ promoIndex: 3, promoTotalAmount: 81000, monthAmount: 27000 }))
      .toEqual({ due: 0, struck: 27000 })
  })
  test('un mes sin promo cobra lo suyo y no tacha nada', () => {
    expect(promoMonthCollection({ promoIndex: null, promoTotalAmount: null, monthAmount: 27000 }))
      .toEqual({ due: 27000, struck: null })
  })
  test('tolera montos ausentes', () => {
    expect(promoMonthCollection({ promoIndex: null, promoTotalAmount: null, monthAmount: null }))
      .toEqual({ due: 0, struck: null })
    expect(promoMonthCollection({ promoIndex: 1, promoTotalAmount: null, monthAmount: 27000 }))
      .toEqual({ due: 0, struck: 27000 })
  })
})

describe('promoKpis', () => {
  test('cuenta activas y por vencer por separado, sin solaparse', () => {
    const promos = [
      promo({ id: 'a' }),                                                             // active en 2026-05
      promo({ id: 'b', startYear: 2026, startMonth: 4, endYear: 2026, endMonth: 5 }), // termina en el ref -> expiring
      promo({ id: 'c', startYear: 2026, startMonth: 9, endYear: 2026, endMonth: 11 }) // upcoming
    ]
    const k = promoKpis(promos, 2026, 5)
    expect(k.activeCount).toBe(1)
    expect(k.expiringCount).toBe(1)
  })

  test('el descuento otorgado suma sólo las promos vigentes (activas + por vencer)', () => {
    const promos = [
      promo({ id: 'a', discountAmount: 4500 }),                                                             // active
      promo({ id: 'b', startYear: 2026, startMonth: 4, endYear: 2026, endMonth: 5, discountAmount: 1000 }),  // expiring
      promo({ id: 'c', startYear: 2025, startMonth: 0, endYear: 2025, endMonth: 2, discountAmount: 9999 })   // expired
    ]
    expect(promoKpis(promos, 2026, 5).totalDiscountGranted).toBe(5500)
  })

  test('prepaidCashInPeriod sólo cuenta promos COBRADAS en el mes', () => {
    const promos = [
      promo({ id: 'a', paidDate: '2026-06-05', paidAmount: 90000 }),
      promo({ id: 'b', paidDate: null, paidAmount: null }),            // pactada, sin cobrar
      promo({ id: 'c', paidDate: '2026-07-02', paidAmount: 50000 })    // otro mes
    ]
    expect(promoKpis(promos, 2026, 5).prepaidCashInPeriod).toBe(90000)
  })

  test('lista vacía no rompe', () => {
    expect(promoKpis([], 2026, 5)).toEqual({
      activeCount: 0, prepaidCashInPeriod: 0, totalDiscountGranted: 0, expiringCount: 0
    })
  })
})
