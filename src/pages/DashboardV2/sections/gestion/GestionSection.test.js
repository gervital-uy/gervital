import { render, screen, fireEvent, within } from '@testing-library/react'
import GestionSection from './GestionSection'
import { MonthDataProvider } from '../../useMonthData'
import { buildPadron } from '../../../../services/dashboardV2/padron'

// react-router-dom 7 solo publica `exports`, que el resolver de jest de CRA no lee:
// se reemplaza Link por un <a> (las rutas no son lo que se prueba acá).
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>
}), { virtual: true })

// Octubre 2026 en chico: una cuota cobrada, una pendiente y vencida, el ancla de
// una promo cobrada, su mes 2 prepago y una cobrada sin CI.
const PROMO = { promo_id: 'p1', promo_total: 3, promo_percent: 10, promo_total_amount: 81000, attendance_gross: 27000, transport_gross: 0 }
const panel = [
  { client_id: 'a', attendance_gross: 30000, transport_gross: 0, payment_status: 'paid', paid_amount: 30000, paid_date: '2026-09-29', invoice_status: 'pending' },
  { client_id: 'b', attendance_gross: 20000, transport_gross: 0, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'c', ...PROMO, promo_index: 1, payment_status: 'paid', paid_amount: 81000, paid_date: '2026-10-05', invoice_status: 'pending' },
  { client_id: 'd', ...PROMO, promo_index: 2, payment_status: 'prepaid', paid_amount: 0, invoice_status: 'pending' },
  { client_id: 'e', attendance_gross: 15000, transport_gross: 0, payment_status: 'paid', paid_amount: 15000, invoice_status: 'pending' }
]
const NAMES = { a: 'Ana Alfa', b: 'Beto Beta', c: 'Carla Gama', d: 'Dora Delta', e: 'Eva Epsilon' }
const clients = Object.entries(NAMES).map(([id, name]) => ({
  id,
  firstName: name.split(' ')[0],
  lastName: name.split(' ')[1],
  documentNumber: id === 'e' ? null : '1',
  email: 'x@y.com',
  address: { street: 's' },
  transferResponsible: id === 'a' ? 'Marta Alfa' : null
}))
const breakdown = panel.map(p => ({ clientId: p.client_id, frequency: 3, schedule: 'afternoon', hasTransport: false }))
const ROWS = buildPadron({ panel, clients, breakdown, promotions: [{ id: 'p1', paid_date: '2026-10-05' }] }, { year: 2026, month: 9, today: '2026-10-30' })

jest.mock('../../../../services/dashboardV2/queries', () => ({ loadPadron: jest.fn() }))
const { loadPadron } = jest.requireMock('../../../../services/dashboardV2/queries')

const renderSection = () => render(
  <MonthDataProvider>
    <GestionSection selected={{ year: 2026, month: 9 }} />
  </MonthDataProvider>
)

// Las queries de Testing Library normalizan el espacio duro (U+00A0) de Intl a un
// espacio común: los montos se buscan con espacio común.
const tableNames = () => within(screen.getByRole('table')).queryAllByRole('link').map(a => a.textContent)

describe('Gestión CFP (solo lectura)', () => {
  beforeEach(() => loadPadron.mockReset().mockResolvedValue(ROWS))

  test('KPIs de cobranza sobre el padrón entero y la tabla arranca en Pendientes', async () => {
    renderSection()
    expect(await screen.findByText('5 clientes en el padrón del mes', { exact: false })).toBeInTheDocument()
    // previsto = 30.000 + 20.000 + 81.000 (paquete) + 0 + 15.000
    expect(screen.getByText('$ 146.000')).toBeInTheDocument()
    expect(screen.getByText('1 cliente por cobrar')).toBeInTheDocument()
    expect(screen.getByText('1 vencido', { exact: false })).toBeInTheDocument()
    expect(tableNames()).toEqual(['Beto Beta'])
    expect(screen.getByText('vencido')).toBeInTheDocument()
  })

  test('Cobrados muestra el mes cubierto tachado y la fecha del paquete', async () => {
    renderSection()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Cobrados' }))
    expect(tableNames()).toHaveLength(4)
    expect(screen.getByText('pago del paquete')).toBeInTheDocument()
    // El giro de Ana entró el 29 de septiembre: anticipado
    expect(screen.getByText('anticipado')).toBeInTheDocument()
    expect(screen.getByText('Marta Alfa')).toBeInTheDocument()
  })

  test('Facturación: cada mes de promo factura su servicio, no el paquete', async () => {
    renderSection()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Facturación' }))
    // a facturar = 30.000 + 20.000 + 27.000 + 27.000 + 15.000
    expect(screen.getByText('$ 119.000')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    const ancla = screen.getByRole('row', { name: /Carla Gama/ })
    expect(within(ancla).getByText('$ 27.000')).toBeInTheDocument()
  })

  test('el aviso de trabadas filtra justo las filas que cuenta', async () => {
    renderSection()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Facturación' }))
    expect(screen.getByText('1 factura no puede emitirse')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver solo las trabadas (1)' }))
    expect(tableNames()).toEqual(['Eva Epsilon'])
    expect(screen.getByText('falta CI')).toBeInTheDocument()
    // Tocar un estado sale del modo trabadas
    fireEvent.click(screen.getByRole('button', { name: 'No cobrado' }))
    expect(tableNames()).toEqual(['Beto Beta'])
  })

  test('el buscador barre titular, estado y monto', async () => {
    renderSection()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    const search = screen.getByLabelText('Buscar')
    fireEvent.change(search, { target: { value: 'marta' } })
    expect(tableNames()).toEqual(['Ana Alfa'])
    fireEvent.change(search, { target: { value: 'prepago' } })
    expect(tableNames()).toEqual(['Dora Delta'])
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(tableNames()).toHaveLength(5)
  })

  test('la "i" explica el previsto con los números del mes', async () => {
    renderSection()
    await screen.findByRole('table')
    fireEvent.click(screen.getAllByRole('button', { name: 'Cómo se calcula' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Cobranza del mes' })
    expect(dialog).toHaveTextContent('octubre 2026')
    expect(dialog).toHaveTextContent('Pendiente de cobro')
  })

  test('si la carga falla se puede reintentar', async () => {
    loadPadron.mockReset().mockRejectedValueOnce(new Error('sin conexión')).mockResolvedValueOnce(ROWS)
    renderSection()
    expect(await screen.findByText('No se pudieron cargar los datos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})
