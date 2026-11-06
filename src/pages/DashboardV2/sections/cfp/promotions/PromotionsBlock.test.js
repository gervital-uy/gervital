import { render, screen, fireEvent, within } from '@testing-library/react'
import PromotionsBlock from './PromotionsBlock'
import { MonthDataProvider } from '../../../useMonthData'

// react-router-dom 7 solo publica `exports`, que el resolver de jest de CRA no lee.
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>
}), { virtual: true })
jest.mock('../../../../../services/dashboardV2/benefitsQueries', () => ({ loadBenefitSources: jest.fn() }))
jest.mock('../../../useToday', () => ({ useToday: () => '2026-11-06' }))
const { loadBenefitSources } = jest.requireMock('../../../../../services/dashboardV2/benefitsQueries')

// Octubre 2026 en chico:
//   a: arranca una promo de 3 meses (oct–dic), paquete cobrado
//   b: mes 2 de una promo (sep–nov): se queda sin beneficio en noviembre
//   c: 25% en octubre y sigue con 20% en noviembre
//   d: 10% sep–oct, sin cálculo del mes (su lista se reconstruye)
//   g: 100% en octubre, sin cálculo (no suma al descuento)
//   k: sin beneficio, con una promo vieja de jun–ago
//   e: 15% jul–ago, ya no está en el padrón
const promo = (id, clientId, [sy, sm], [ey, em], over = {}) => ({
  id, clientId, firstName: '', lastName: '', discountPercent: 10, discountAmount: 9000, totalAmount: 81000,
  startYear: sy, startMonth: sm, endYear: ey, endMonth: em, paidDate: null, paidAmount: null, ...over
})
const month = (clientId, m, discountPercent, over = {}) => ({
  clientId, year: 2026, month: m, discountPercent, promoId: null, paymentStatus: 'pending', attendanceChargeableGross: null, ...over
})
const paid = att => ({ paymentStatus: 'paid', attendanceChargeableGross: att })
const prow = (id, over = {}) => {
  const row = { id, firstName: id.toUpperCase(), lastName: 'Test', attendanceGross: 30000, transportGross: 0, promoId: null, promoIndex: null, promoTotal: null, promoPercent: null, discountPercent: null, ...over }
  return { ...row, amount: row.attendanceGross + row.transportGross }
}
const bill = (rate, charged) => ({ attendanceMonthlyRateGross: rate, chargeableDays: 8, daysPerMonth: 8, attendanceChargeableGross: charged })

const PADRON = [
  prow('a', { promoId: 'pA', promoIndex: 1, promoTotal: 3, promoPercent: 10, attendanceGross: 27000 }),
  prow('b', { promoId: 'pB', promoIndex: 2, promoTotal: 3, promoPercent: 10, attendanceGross: 27000, transportGross: 5000 }),
  prow('c', { discountPercent: 25, attendanceGross: 36000 }),
  prow('d', { discountPercent: 10, attendanceGross: 27000 }),
  prow('g', { discountPercent: 100, attendanceGross: 0 }),
  prow('k')
]
const SOURCES = {
  promotions: [
    promo('pA', 'a', [2026, 9], [2026, 11], { paidDate: '2026-10-05', paidAmount: 81000 }),
    promo('pB', 'b', [2026, 8], [2026, 10], { paidDate: '2026-09-05', paidAmount: 81000 }),
    promo('pOld', 'k', [2026, 5], [2026, 7], { paidDate: '2026-06-05', paidAmount: 81000 })
  ],
  ledger: [
    month('c', 9, 25), month('c', 10, 20),
    month('d', 8, 10, paid(27000)), month('d', 9, 10),
    month('g', 9, 100),
    month('e', 6, 15, paid(17000)), month('e', 7, 15, paid(17000))
  ],
  clients: ['a', 'b', 'c', 'd', 'e', 'g', 'k'].map(id => ({ id, firstName: id.toUpperCase(), lastName: 'Test' })),
  billing: { a: bill(30000, 27000), b: bill(30000, 27000), c: bill(48000, 36000) },
  pastBase: null
}

const ready = data => ({ status: 'ready', data, error: null, refreshing: false, refreshError: null, reload: jest.fn() })
const renderBlock = (padron = ready(PADRON)) => render(
  <MonthDataProvider>
    <PromotionsBlock selected={{ year: 2026, month: 9 }} padron={padron} monthLabel="octubre 2026" />
  </MonthDataProvider>
)
// Las tarjetas no tienen rol propio: se busca la tarjeta que contiene el título.
// eslint-disable-next-line testing-library/no-node-access
const card = label => screen.getByText(label, { selector: 'span.truncate' }).closest('.rounded-2xl')
// eslint-disable-next-line testing-library/no-node-access
const tableOf = title => screen.getByRole('heading', { name: new RegExp(title) }).closest('.rounded-2xl')

describe('Promociones y otros descuentos', () => {
  beforeEach(() => loadBenefitSources.mockReset().mockResolvedValue(SOURCES))

  test('KPIs del mes sobre el padrón', async () => {
    renderBlock()
    expect(await screen.findByText('5 de 6')).toBeInTheDocument()
    expect(within(card('Con beneficio')).getByText('2 promos prepagas · 3 otros descuentos')).toBeInTheDocument()
    // 3.000 + 3.000 de promos + 12.000 (c) + 3.000 (d, reconstruido); g al 100% no suma
    expect(within(card('Descuento del mes')).getByText('$ 21.000')).toBeInTheDocument()
    expect(within(card('Paquetes que arrancan')).getByText('$ 81.000')).toBeInTheDocument()
    expect(within(card('Paquetes que arrancan')).getByText('1 paquete, todo cobrado')).toBeInTheDocument()
    // b (termina nov), c (el escalón de 20% termina nov), d y g (terminan oct)
    expect(within(card('Por renovar')).getByText('4')).toBeInTheDocument()
    expect(within(card('Por renovar')).getByText('$ 95.000 de cuota del mes en juego')).toBeInTheDocument()
    expect(screen.getByText('83%')).toBeInTheDocument()
  })

  test('las tablas del mes: avance, paquete, escalón y link a la ficha', async () => {
    renderBlock()
    await screen.findByText('5 de 6')
    const promos = tableOf('Promos prepagas')
    expect(within(promos).getByRole('link', { name: 'A Test' })).toHaveAttribute('href', '/clientes/a')
    expect(within(promos).getByText('Mes 1 de 3')).toBeInTheDocument()
    expect(within(promos).getByText('cobrado 5 oct 2026')).toBeInTheDocument()
    const discounts = tableOf('Otros descuentos')
    expect(within(discounts).getByText(/sigue con 20%/, { selector: 'span' })).toBeInTheDocument()
    expect(within(discounts).getAllByText('estimado')).toHaveLength(1)
  })

  test('los chips filtran: próximos y por renovar', async () => {
    renderBlock()
    await screen.findByText('5 de 6')
    fireEvent.click(screen.getByRole('button', { name: /Próximos/ }))
    expect(within(tableOf('Otros descuentos')).getByText('Arranca nov 26')).toBeInTheDocument()
    expect(within(tableOf('Promos prepagas')).getByText('Ninguna promo arranca más adelante')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Por renovar/ }))
    expect(within(tableOf('Promos prepagas')).queryByRole('link', { name: 'A Test' })).not.toBeInTheDocument()
    expect(within(tableOf('Promos prepagas')).getByRole('link', { name: 'B Test' })).toBeInTheDocument()
  })

  test('el historial tiene su propio rango y no sigue al mes', async () => {
    renderBlock()
    await screen.findByText('5 de 6')
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    expect(screen.getByText('Terminados entre')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desde: junio 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hasta: octubre 2026' })).toBeInTheDocument()
    const promos = tableOf('Promos prepagas')
    expect(within(promos).getByRole('link', { name: 'K Test' })).toBeInTheDocument()
    expect(within(promos).getByText('Dto total')).toBeInTheDocument()
    // e (jul–ago) ya no está en el padrón pero su tramo terminado sí está en el historial
    expect(within(tableOf('Otros descuentos')).getByRole('link', { name: 'E Test' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hasta: octubre 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'ago' }))
    expect(within(tableOf('Otros descuentos')).queryByRole('link', { name: 'D Test' })).not.toBeInTheDocument()
  })

  test('sin "próximamente" ni piezas omitidas', async () => {
    const { container } = renderBlock()
    await screen.findByText('5 de 6')
    expect(container.textContent).not.toMatch(/pr[oó]ximamente/i)
    expect(container.textContent).not.toMatch(/Reactivar|Motivo/)
  })

  test('mientras cargan las fuentes y si fallan', async () => {
    let fail
    loadBenefitSources.mockReturnValue(new Promise((_, reject) => { fail = reject }))
    renderBlock()
    expect(screen.getByText('Cargando promociones y descuentos…')).toBeInTheDocument()
    fail(new Error('sin conexión'))
    expect(await screen.findByText('No se pudieron cargar los datos.')).toBeInTheDocument()
    loadBenefitSources.mockResolvedValue(SOURCES)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('5 de 6')).toBeInTheDocument()
  })
})
