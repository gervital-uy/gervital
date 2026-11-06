import {
  PLATFORM_START_ORD, ymOfOrdinal, agreementState, paidMonthDiscount, discountRuns, buildAgreements,
  listAttendance, monthDiscountOf, buildBenefits, benefitTables, sortBenefitRows, historyRange, benefitHistory
} from './benefitsView'
import { promoOrdinal } from '../promotions/promotionsView'

// Octubre 2026 (month 9). Montos con IVA, como los devuelve calculate_month_billing.
const OCT = { year: 2026, month: 9 }
const ord = (year, month) => promoOrdinal(year, month)

const promo = (id, clientId, [sy, sm], [ey, em], over = {}) => ({
  id, clientId, firstName: '', lastName: '', discountPercent: 10, discountAmount: 9000, totalAmount: 81000,
  startYear: sy, startMonth: sm, endYear: ey, endMonth: em, paidDate: null, paidAmount: null, ...over
})

const month = (clientId, year, m, discountPercent, over = {}) => ({
  clientId, year, month: m, discountPercent, promoId: null, paymentStatus: 'pending', attendanceChargeableGross: null, ...over
})
const paid = att => ({ paymentStatus: 'paid', attendanceChargeableGross: att })

// Una fila del padrón (buildPadron) con lo que usa el bloque.
const prow = (id, over = {}) => {
  const row = { id, firstName: id.toUpperCase(), lastName: id, attendanceGross: 30000, transportGross: 0, promoId: null, promoIndex: null, promoTotal: null, promoPercent: null, discountPercent: null, ...over }
  return { ...row, amount: row.attendanceGross + row.transportGross }
}
const promoRow = (id, promoId, promoIndex, promoTotal, promoPercent, over = {}) => prow(id, { promoId, promoIndex, promoTotal, promoPercent, ...over })
const bill = (rate, days, daysPerMonth, charged) => ({ attendanceMonthlyRateGross: rate, chargeableDays: days, daysPerMonth, attendanceChargeableGross: charged })

describe('ordinales', () => {
  test('el lanzamiento es junio 2026 y el ordinal vuelve a año y mes', () => {
    expect(PLATFORM_START_ORD).toBe(ord(2026, 5))
    expect(ymOfOrdinal(ord(2027, 0))).toEqual({ year: 2027, month: 0 })
  })
})

describe('descuento de un mes cobrado', () => {
  test('se reconstruye de lo cobrado: cobrado × p / (100 − p)', () => {
    expect(paidMonthDiscount({ ...paid(27000), discountPercent: 10 })).toBe(3000)
    expect(paidMonthDiscount({ ...paid(36000), discountPercent: 25 })).toBe(12000)
    expect(paidMonthDiscount({ ...paid(17000), discountPercent: 15 })).toBe(3000)
  })

  test('sin cobrar, sin foto o al 100% no hay dato', () => {
    expect(paidMonthDiscount({ paymentStatus: 'pending', attendanceChargeableGross: 27000, discountPercent: 10 })).toBeNull()
    expect(paidMonthDiscount({ paymentStatus: 'paid', attendanceChargeableGross: null, discountPercent: 10 })).toBeNull()
    expect(paidMonthDiscount({ ...paid(0), discountPercent: 100 })).toBeNull()
  })
})

describe('corridas de descuento suelto', () => {
  test('meses consecutivos con el mismo % forman una corrida; un cambio de % o un hueco la cortan', () => {
    const runs = discountRuns([
      month('d', 2026, 11, 15),
      month('d', 2026, 9, 25),
      month('d', 2026, 10, 20),
      month('e', 2026, 6, 10), month('e', 2026, 7, 10), month('e', 2026, 9, 10)
    ])
    expect(runs.map(r => [r.clientId, r.percent, r.startOrd, r.endOrd])).toEqual([
      ['d', 25, ord(2026, 9), ord(2026, 9)],
      ['d', 20, ord(2026, 10), ord(2026, 10)],
      ['d', 15, ord(2026, 11), ord(2026, 11)],
      ['e', 10, ord(2026, 6), ord(2026, 7)],
      ['e', 10, ord(2026, 9), ord(2026, 9)]
    ])
    expect(runs[0]).toMatchObject({ id: `d:${ord(2026, 9)}`, kind: 'discount' })
  })

  test('los meses de promo y los de antes del lanzamiento no son descuento suelto', () => {
    const runs = discountRuns([
      month('a', 2026, 4, 10),
      month('a', 2026, 5, 10, { promoId: 'p1' }),
      month('a', 2026, 6, 0)
    ])
    expect(runs).toEqual([])
  })

  test('el total de una corrida suma sus meses cobrados y cuenta los que no tienen dato', () => {
    const [run] = discountRuns([
      month('e', 2026, 6, 10, paid(27000)),
      month('e', 2026, 7, 10, paid(27000)),
      month('e', 2026, 8, 10)
    ])
    expect(run).toMatchObject({ discountTotal: 6000, discountTotalMissing: 1 })
  })
})

describe('acuerdos', () => {
  const promotions = [
    promo('p1', 'a', [2026, 7], [2026, 9], { firstName: 'Ana', lastName: 'Promo' }),
    promo('p2', 'a', [2026, 10], [2027, 0]),
    promo('p3', 'x', [2026, 8], [2026, 10], { firstName: 'Xime', lastName: 'Baja' })
  ]
  const ledger = [month('a', 2026, 5, 10), month('a', 2026, 6, 10), month('d', 2026, 9, 25), month('d', 2026, 10, 20)]
  const clients = [{ id: 'a', firstName: 'Lucía', lastName: 'Pérez', avatarUrl: 'http://img/a' }, { id: 'd', firstName: 'Delia', lastName: 'Suárez' }]
  const all = buildAgreements({ promotions, ledger, clients })
  const byId = id => all.find(a => a.id === id)

  test('el nombre sale de la ficha y, si no está, de la promo', () => {
    expect(byId('p1')).toMatchObject({ firstName: 'Lucía', lastName: 'Pérez', avatarUrl: 'http://img/a' })
    expect(byId('p3')).toMatchObject({ firstName: 'Xime', lastName: 'Baja', avatarUrl: null })
  })

  test('rango, duración real y lo que trae la promo', () => {
    expect(byId('p2')).toMatchObject({ kind: 'promo', startYear: 2026, startMonth: 10, endYear: 2027, endMonth: 0, months: 3, percent: 10, packageAmount: 81000, collected: false, discountTotal: 9000 })
  })

  test('la cadena de beneficio sigue por promos renovadas, escalones y descuentos que pasan a promo', () => {
    // a: descuento jun–jul, promo ago–oct, promo nov–ene, todo pegado
    expect(byId(`a:${ord(2026, 5)}`)).toMatchObject({ benefitEndOrd: ord(2027, 0), next: { kind: 'promo', id: 'p1', percent: 10, months: 3 } })
    expect(byId('p1')).toMatchObject({ benefitEndOrd: ord(2027, 0), next: { kind: 'promo', id: 'p2' } })
    expect(byId('p2')).toMatchObject({ benefitEndOrd: ord(2027, 0), next: null })
    // d: 25% en oct, 20% en nov
    expect(byId(`d:${ord(2026, 9)}`)).toMatchObject({ benefitEndOrd: ord(2026, 10), next: { kind: 'discount', percent: 20, months: 1 } })
  })

  test('estado respecto del mes: por renovar si el beneficio se corta este mes o el siguiente', () => {
    const at = (a, y, m) => agreementState(a, ord(y, m))
    expect(at(byId('p2'), 2026, 9)).toBe('upcoming')
    expect(at(byId('p3'), 2026, 8)).toBe('active') // termina en dos meses
    expect(at(byId('p3'), 2026, 9)).toBe('expiring') // termina el mes siguiente
    expect(at(byId('p3'), 2026, 10)).toBe('expiring') // último mes
    expect(at(byId('p3'), 2026, 11)).toBe('expired')
    // Termina este mes, pero ya está renovada: sigue vigente
    expect(at(byId('p1'), 2026, 9)).toBe('active')
    // Un escalón que termina este mes con otro pegado: cuenta el final de la cadena
    // (nov, el mes siguiente), no el del escalón
    expect(at(byId(`d:${ord(2026, 9)}`), 2026, 9)).toBe('expiring')
    expect(agreementState({ ...byId(`d:${ord(2026, 9)}`), benefitEndOrd: ord(2026, 11) }, ord(2026, 9))).toBe('active')
  })
})

describe('precio de lista y descuento del mes', () => {
  test('la lista son los días cobrables sobre el mes pactado por la tarifa', () => {
    expect(listAttendance(bill(30000, 8, 8, 27000))).toBe(30000)
    expect(listAttendance(bill(30000, 6, 8, 20250))).toBe(22500)
    expect(listAttendance(bill(30000, 6, 0, 0))).toBeNull()
    expect(listAttendance(undefined)).toBeNull()
  })

  test('con el cálculo del mes: lista − cobrable, también al 100%', () => {
    expect(monthDiscountOf({ attendanceGross: 20250, percent: 10 }, bill(30000, 6, 8, 20250))).toEqual({ list: 22500, charged: 20250, discount: 2250, estimated: false })
    expect(monthDiscountOf({ attendanceGross: 0, percent: 100 }, bill(30000, 8, 8, 0))).toMatchObject({ discount: 30000, estimated: false })
  })

  test('sin el cálculo se reconstruye de lo cobrable, salvo al 100%', () => {
    expect(monthDiscountOf({ attendanceGross: 27000, percent: 10 }, undefined)).toEqual({ list: 30000, charged: 27000, discount: 3000, estimated: true })
    expect(monthDiscountOf({ attendanceGross: 0, percent: 100 }, undefined)).toBeNull()
    expect(monthDiscountOf({ attendanceGross: 30000, percent: 0 }, undefined)).toBeNull()
  })
})

// Escenario de octubre 2026:
//   a: promo ago–oct (mes 3 de 3), ya renovada por otra nov–ene
//   b: promo oct–dic al 15%, arranca este mes sin cobrar
//   c: promo sep–nov (mes 2), cuota prorrateada, con transporte
//   h: promo de 6 meses oct–mar, cobrada por un monto ajustado
//   x: promo sep–nov de un cliente que no cobra este mes (baja)
//   i: promo de un mes en dic (todavía no arrancó)
//   d: descuento escalonado 25% oct, 20% nov, 15% dic
//   e: descuento 10% jul–oct; g: descuento del 100% en oct; f: descuento viejo (jun)
//   k, l: sin beneficio
const promotions = [
  promo('pA1', 'a', [2026, 7], [2026, 9], { paidDate: '2026-08-05', paidAmount: 81000 }),
  promo('pA2', 'a', [2026, 10], [2027, 0]),
  promo('pB', 'b', [2026, 9], [2026, 11], { discountPercent: 15, totalAmount: 76500, discountAmount: 13500 }),
  promo('pC', 'c', [2026, 8], [2026, 10], { totalAmount: 96360, paidDate: '2026-09-09', paidAmount: 96360 }),
  promo('pH', 'h', [2026, 9], [2027, 2], { discountPercent: 20, totalAmount: 144000, discountAmount: 36000, paidDate: '2026-10-03', paidAmount: 140000 }),
  promo('pX', 'x', [2026, 8], [2026, 10], { paidDate: '2026-09-02', paidAmount: 81000 }),
  promo('pU', 'i', [2026, 11], [2026, 11], { totalAmount: 27000, discountAmount: 3000 })
]
const ledger = [
  month('d', 2026, 9, 25, paid(36000)), month('d', 2026, 10, 20), month('d', 2026, 11, 15),
  month('e', 2026, 6, 10, paid(27000)), month('e', 2026, 7, 10, paid(27000)), month('e', 2026, 8, 10, paid(27000)), month('e', 2026, 9, 10),
  month('g', 2026, 9, 100),
  month('f', 2026, 5, 15, paid(17000))
]
const clients = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'x'].map(id => ({ id, firstName: id.toUpperCase(), lastName: `Apellido ${id}` }))
const padron = [
  promoRow('a', 'pA1', 3, 3, 10, { attendanceGross: 27000 }),
  promoRow('b', 'pB', 1, 3, 15, { attendanceGross: 25500 }),
  promoRow('c', 'pC', 2, 3, 10, { attendanceGross: 20250, transportGross: 5120 }),
  promoRow('h', 'pH', 1, 6, 20, { attendanceGross: 24000 }),
  prow('d', { discountPercent: 25, attendanceGross: 36000 }),
  prow('e', { discountPercent: 10, attendanceGross: 27000 }),
  prow('g', { discountPercent: 100, attendanceGross: 0, transportGross: 8320 }),
  prow('k'),
  prow('l')
]
const billing = {
  a: bill(30000, 8, 8, 27000),
  b: bill(30000, 8, 8, 25500),
  c: bill(30000, 6, 8, 20250),
  h: bill(30000, 8, 8, 24000),
  d: bill(48000, 8, 8, 36000),
  // e sin cálculo: se reconstruye
  g: bill(30000, 8, 8, 0)
}
const view = buildBenefits({ padron, promotions, ledger, clients, billing }, OCT)
const rowOf = id => view.rows.find(a => a.id === id)

describe('buildBenefits — KPIs del mes', () => {
  test('con beneficio sobre el padrón, agrupado por la duración real de cada promo', () => {
    expect(view.kpis).toMatchObject({ base: 9, withBenefit: 7, promoCount: 4, discountCount: 3, without: 2 })
    expect(view.kpis.coveragePct).toBeCloseTo(77.78, 2)
    expect(view.kpis.promoGroups).toEqual([{ months: 6, count: 1 }, { months: 3, count: 3 }])
    expect(view.kpis.segments.map(s => [s.key, s.count, s.label])).toEqual([
      ['promo-6', 1, 'Promo de 6 meses'],
      ['promo-3', 3, 'Promo de 3 meses'],
      ['discount', 3, 'Otros descuentos'],
      ['none', 2, 'Sin beneficio']
    ])
  })

  test('descuento del mes: lista − cobrable de cada mes con beneficio, partido por clase', () => {
    expect(view.kpis.discount).toMatchObject({
      total: 60750,
      promos: 15750, // 3000 + 4500 + 2250 (prorrateado) + 6000
      discounts: 45000, // 12000 + 3000 (reconstruido) + 30000 (100%)
      missing: 0,
      estimated: 1,
      attendanceCharged: 219750,
      listAttendance: 280500
    })
    expect(view.kpis.discount.sharePct).toBeCloseTo((60750 / 280500) * 100, 6)
  })

  test('un 100% sin cálculo queda sin dato y no suma', () => {
    const { g, ...rest } = billing
    const k = buildBenefits({ padron, promotions, ledger, clients, billing: rest }, OCT).kpis.discount
    expect(k).toMatchObject({ total: 30750, discounts: 15000, missing: 1 })
  })

  test('paquetes que arrancan: lo cobrado manda sobre el pactado', () => {
    expect(view.kpis.packages).toEqual({ count: 2, amount: 216500, collectedCount: 1, collected: 140000, pendingCount: 1, pending: 76500 })
  })

  test('por renovar: el beneficio se corta este mes o el siguiente; las renovadas y los escalones no', () => {
    expect(view.kpis.renewals).toEqual({ count: 3, promos: 1, discounts: 2, atStake: 25370 + 27000 + 8320 })
    expect(rowOf('pA1').state).toBe('active')
    expect(rowOf(`d:${ord(2026, 9)}`).state).toBe('active')
    expect(rowOf('pC').state).toBe('expiring')
  })

  test('conteos de los chips y acuerdos vigentes fuera del padrón', () => {
    expect(view.kpis.counts).toEqual({ current: 7, expiring: 3, upcoming: 4 })
    expect(view.kpis.offPadron).toBe(1)
    expect(view.kpis.upcomingAway).toBe(0)
    expect(rowOf('pX')).toMatchObject({ state: 'expiring', inPadron: false, monthAmount: null, monthDiscount: null })
  })

  test('cada acuerdo vigente lleva su avance y lo del mes', () => {
    expect(rowOf('pC')).toMatchObject({ index: 2, months: 3, inPadron: true, monthAmount: 25370, monthList: 22500, monthDiscount: 2250, monthDiscountEstimated: false })
    expect(rowOf(`e:${ord(2026, 6)}`)).toMatchObject({ index: 4, months: 4, monthDiscount: 3000, monthDiscountEstimated: true })
    expect(rowOf('pA2')).toMatchObject({ state: 'upcoming', index: null, inPadron: false })
  })

  test('sin cobertura de hace seis meses si no hay base de ese mes', () => {
    expect(view.kpis.previousCoverage).toBeNull()
  })

  test('cobertura de hace seis meses con la población que cobraba ese mes', () => {
    const dec = { year: 2026, month: 11 }
    const pastLedger = [...ledger, month('m', 2026, 5, 10), month('n', 2026, 5, 10, { promoId: 'pN' }), month('z', 2026, 5, 10)]
    const pastBase = { year: 2026, month: 5, clientIds: ['f', 'm', 'n', 'o'] }
    expect(buildBenefits({ padron: [], promotions: [], ledger: pastLedger, pastBase }, dec).kpis.previousCoverage)
      .toEqual({ year: 2026, month: 5, base: 4, withBenefit: 3, pct: 75 })
    // Una base de otro mes no se compara
    expect(buildBenefits({ padron: [], promotions: [], ledger: pastLedger, pastBase: { ...pastBase, month: 6 } }, dec).kpis.previousCoverage).toBeNull()
  })

  test('sin datos no se rompe', () => {
    const empty = buildBenefits({}, OCT)
    expect(empty.kpis).toMatchObject({ base: 0, withBenefit: 0, coveragePct: null, previousCoverage: null })
    expect(empty.kpis.discount).toMatchObject({ total: 0, sharePct: null })
    expect(empty.rows).toEqual([])
  })
})

// Dar de baja no borra los descuentos ni las promos de meses futuros: en Próximos
// solo queda lo de un cliente que va a estar activo algún día del acuerdo.
describe('próximos de clientes dados de baja', () => {
  const awayPromotions = [...promotions, promo('pY', 'y', [2026, 11], [2027, 1])]
  const awayLedger = [
    ...ledger,
    // y: baja abierta desde el 15-11, con descuento ene–mar
    month('y', 2027, 0, 10), month('y', 2027, 1, 10), month('y', 2027, 2, 10),
    // r: pausa hasta el 01-02, con descuento ene–mar (vuelve en febrero)
    month('r', 2027, 0, 10), month('r', 2027, 1, 10), month('r', 2027, 2, 10),
    // w: pausa hasta el 01-04, con descuento ene–mar (no vuelve antes de que termine)
    month('w', 2027, 0, 10), month('w', 2027, 1, 10), month('w', 2027, 2, 10)
  ]
  const awayClients = [
    ...clients,
    { id: 'y', firstName: 'Y', lastName: 'Baja', deactivationDate: '2026-11-15', inactivityPeriods: [{ fromDate: '2026-11-15', toDate: null }] },
    { id: 'r', firstName: 'R', lastName: 'Pausa', inactivityPeriods: [{ fromDate: '2026-11-15', toDate: '2027-02-01' }] },
    { id: 'w', firstName: 'W', lastName: 'Pausa larga', inactivityPeriods: [{ fromDate: '2026-11-15', toDate: '2027-04-01' }] }
  ]
  const awayView = buildBenefits({ padron, promotions: awayPromotions, ledger: awayLedger, clients: awayClients, billing }, OCT)
  const awayRow = id => awayView.rows.find(a => a.id === id)

  test('el acuerdo sigue siendo próximo, pero marcado: el cliente no va a estar activo en su rango', () => {
    expect(awayRow('pY')).toMatchObject({ state: 'upcoming', clientAway: true })
    expect(awayRow(`y:${ord(2027, 0)}`)).toMatchObject({ state: 'upcoming', clientAway: true })
    expect(awayRow(`w:${ord(2027, 0)}`)).toMatchObject({ state: 'upcoming', clientAway: true })
    // Vuelve en febrero, dentro del acuerdo: cuenta
    expect(awayRow(`r:${ord(2027, 0)}`)).toMatchObject({ state: 'upcoming', clientAway: false })
    // Sin períodos, nada cambia
    expect(awayRow('pA2')).toMatchObject({ clientAway: false })
  })

  test('no entra en el conteo del chip ni en la tabla de próximos; se cuenta aparte', () => {
    expect(awayView.kpis.counts).toEqual({ current: 7, expiring: 3, upcoming: 5 })
    expect(awayView.kpis.upcomingAway).toBe(3)
    const upcoming = benefitTables(awayView.rows, 'upcoming')
    expect(upcoming.promos.map(a => a.id)).toEqual(['pA2', 'pU'])
    expect(upcoming.discounts.map(a => a.clientId)).toEqual(['d', 'd', 'r'])
  })

  test('lo vigente no cambia: se sigue midiendo con el padrón', () => {
    expect(awayView.kpis).toMatchObject({ base: 9, withBenefit: 7, offPadron: 1 })
    expect(benefitTables(awayView.rows, 'current').promos.map(a => a.id)).toEqual(['pC', 'pH', 'pB', 'pA1'])
  })
})

describe('tablas del mes', () => {
  test('vigentes: solo lo del padrón, primero lo que hay que renovar y después el mayor descuento', () => {
    const { promos, discounts } = benefitTables(view.rows, 'current')
    expect(promos.map(a => a.id)).toEqual(['pC', 'pH', 'pB', 'pA1'])
    expect(discounts.map(a => a.clientId)).toEqual(['g', 'e', 'd'])
  })

  test('por renovar y próximos', () => {
    const expiring = benefitTables(view.rows, 'expiring')
    expect(expiring.promos.map(a => a.id)).toEqual(['pC'])
    expect(expiring.discounts.map(a => a.clientId)).toEqual(['g', 'e'])
    const upcoming = benefitTables(view.rows, 'upcoming')
    expect(upcoming.promos.map(a => a.id)).toEqual(['pA2', 'pU'])
    expect(upcoming.discounts.map(a => a.percent)).toEqual([20, 15])
  })

  test('el historial no es un chip del mes', () => {
    expect(benefitTables(view.rows, 'history')).toEqual({ promos: [], discounts: [] })
  })

  test('a igual estado y descuento, por apellido', () => {
    const rows = [
      { state: 'active', monthDiscount: 3000, firstName: 'A', lastName: 'Zapata' },
      { state: 'active', monthDiscount: 3000, firstName: 'B', lastName: 'Álvarez' }
    ]
    expect(sortBenefitRows(rows).map(r => r.lastName)).toEqual(['Álvarez', 'Zapata'])
  })
})

describe('historial', () => {
  test('rango por defecto: meses cerrados, desde el lanzamiento como mucho', () => {
    expect(historyRange('2026-06-15')).toBeNull()
    expect(historyRange('2026-11-06')).toEqual({ from: { year: 2026, month: 5 }, to: { year: 2026, month: 9 } })
    expect(historyRange('2027-12-02', 6)).toEqual({ from: { year: 2027, month: 5 }, to: { year: 2027, month: 10 } })
    expect(historyRange('2027-12-02', null)).toEqual({ from: { year: 2026, month: 5 }, to: { year: 2027, month: 10 } })
  })

  test('acuerdos terminados antes del mes en curso, del más reciente al más viejo', () => {
    const h = benefitHistory(view.agreements, { ...historyRange('2026-11-06', null), today: '2026-11-06' })
    // pC y pX terminan en noviembre (el mes en curso): todavía no terminaron
    expect(h.promos.map(a => a.id)).toEqual(['pA1'])
    expect(h.discounts.map(a => a.clientId)).toEqual(['d', 'e', 'g', 'f'])
    expect(h.promos.every(a => a.state === 'expired')).toBe(true)
    expect(h.totals).toEqual({
      count: 5,
      promos: 1,
      discounts: 4,
      promoDiscount: 9000,
      looseDiscount: 12000 + 9000 + 0 + 3000,
      discount: 33000,
      missingMonths: 2
    })
  })

  test('el rango recorta por el último mes del acuerdo', () => {
    const h = benefitHistory(view.agreements, { from: { year: 2026, month: 8 }, to: { year: 2026, month: 11 }, today: '2026-11-06' })
    expect([...h.promos, ...h.discounts].map(a => a.clientId)).toEqual(['a', 'd', 'e', 'g'])
  })
})
