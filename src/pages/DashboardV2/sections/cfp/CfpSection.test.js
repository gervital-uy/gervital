import { render, screen, fireEvent, within } from '@testing-library/react'
import CfpSection from './CfpSection'
import { MonthDataProvider } from '../../useMonthData'
import { buildPadron } from '../../../../services/dashboardV2/padron'

// react-router-dom 7 solo publica `exports`, que el resolver de jest de CRA no lee:
// se reemplaza Link por un <a> (las rutas no son lo que se prueba acá).
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>
}), { virtual: true })

// Octubre 2026 en chico:
//   a: cuota cobrada el 29/9 (anticipado), titular Marta
//   b: cuota pendiente y vencida, sin CI
//   c: ancla de una promo cobrada y facturada por el paquete (81.000 contra 27.000)
//   d: mes 2 de esa promo, prepago
//   e: cuota cobrada sin CI
const PROMO = { promo_id: 'p1', promo_total: 3, promo_percent: 10, promo_total_amount: 81000, attendance_gross: 27000, transport_gross: 0 }
const panel = [
  { client_id: 'a', attendance_gross: 30000, transport_gross: 0, payment_status: 'paid', paid_amount: 30000, paid_date: '2026-09-29', invoice_status: 'pending' },
  { client_id: 'b', attendance_gross: 20000, transport_gross: 0, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'c', ...PROMO, promo_index: 1, payment_status: 'paid', paid_amount: 81000, paid_date: '2026-10-05', invoice_status: 'invoiced', invoiced_amount: 81000, invoice_number: 'A-4000', invoice_date: '2026-10-30' },
  { client_id: 'd', ...PROMO, promo_index: 2, payment_status: 'prepaid', paid_amount: 0, invoice_status: 'pending' },
  { client_id: 'e', attendance_gross: 15000, transport_gross: 0, payment_status: 'paid', paid_amount: 15000, invoice_status: 'pending' }
]
const NAMES = { a: 'Ana Alfa', b: 'Beto Beta', c: 'Carla Gama', d: 'Dora Delta', e: 'Eva Epsilon' }
const clients = Object.entries(NAMES).map(([id, name]) => ({
  id,
  firstName: name.split(' ')[0],
  lastName: name.split(' ')[1],
  documentNumber: id === 'b' || id === 'e' ? null : '1',
  email: 'x@y.com',
  address: { street: 's' },
  transferResponsible: id === 'a' ? 'Marta Alfa' : null,
  startDate: '2026-07-01',
  inactivityPeriods: []
}))
const breakdown = panel.map(p => ({ clientId: p.client_id, frequency: 3, schedule: 'afternoon', hasTransport: false }))
const ROWS = buildPadron({ panel, clients, breakdown, promotions: [{ id: 'p1', paid_date: '2026-10-05' }] }, { year: 2026, month: 9, today: '2026-10-30' })

jest.mock('../../../../services/dashboardV2/queries', () => ({ loadPadron: jest.fn() }))
jest.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ hasAccess: () => true }) }))
const { loadPadron } = jest.requireMock('../../../../services/dashboardV2/queries')

const renderSection = () => render(
  <MonthDataProvider>
    <CfpSection selected={{ year: 2026, month: 9 }} />
  </MonthDataProvider>
)

// Las queries de Testing Library normalizan el espacio duro (U+00A0) de Intl a un
// espacio común: los montos se buscan con espacio común.
const tableNames = () => within(screen.getByRole('table')).queryAllByRole('link').map(a => a.textContent)
const rowOf = name => screen.getByRole('row', { name: new RegExp(name) })

describe('Gestión CFP: vistas', () => {
  beforeEach(() => loadPadron.mockReset().mockResolvedValue(ROWS))

  test('KPIs de cobranza sobre el padrón entero y la tabla arranca en Pendientes', async () => {
    renderSection()
    expect(await screen.findByText('5 clientes en el padrón del mes', { exact: false })).toBeInTheDocument()
    // previsto = 30.000 + 20.000 + 81.000 (paquete) + 0 + 15.000
    expect(screen.getByText('$ 146.000')).toBeInTheDocument()
    expect(screen.getByText('1 cliente por cobrar')).toBeInTheDocument()
    expect(screen.getByText('1 vencido', { exact: false })).toBeInTheDocument()
    expect(tableNames()).toEqual(['Beto Beta'])
    expect(within(rowOf('Beto Beta')).getByText('vencido')).toBeInTheDocument()
  })

  test('Cobrados muestra el mes cubierto tachado, la fecha del paquete y el giro anticipado', async () => {
    renderSection()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Cobrados' }))
    expect(tableNames()).toHaveLength(4)
    const covered = within(rowOf('Dora Delta'))
    expect(covered.getByText('$ 27.000')).toHaveClass('line-through')
    expect(covered.getByText('pago del paquete')).toBeInTheDocument()
    expect(within(rowOf('Ana Alfa')).getByText('anticipado')).toBeInTheDocument()
    expect(screen.getByText('Marta Alfa')).toBeInTheDocument()
  })

  test('Facturación: cada mes de promo factura su servicio y lo emitido por el paquete queda marcado', async () => {
    renderSection()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Facturación' }))
    // a facturar = 30.000 + 20.000 + 27.000 + 27.000 + 15.000
    expect(screen.getByText('$ 119.000')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Emitidas' }))
    const anchor = within(rowOf('Carla Gama'))
    expect(anchor.getByText('facturada')).toBeInTheDocument()
    expect(anchor.getByText('monto distinto')).toBeInTheDocument()
    expect(anchor.getByText('$ 81.000')).toBeInTheDocument()
    expect(anchor.getByText(/corresponde \$ 27\.000/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pendientes' }))
    expect(within(rowOf('Dora Delta')).getByText('$ 27.000')).not.toHaveClass('line-through')
  })

  test('el modo trabadas ignora el estado, muestra justo las del aviso y se apaga al cambiar de panel', async () => {
    renderSection()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Facturación' }))
    expect(screen.getByText('2 facturas no pueden emitirse')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver solo las trabadas (2)' }))
    // Beto no cobró y Eva sí: están en estados distintos y las dos aparecen
    expect(tableNames().sort()).toEqual(['Beto Beta', 'Eva Epsilon'])
    expect(screen.getByRole('button', { name: 'Pendientes' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Cobranza' }))
    expect(tableNames()).toEqual(['Beto Beta'])
    expect(screen.getByRole('button', { name: 'Pendientes' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Facturación' }))
    expect(screen.getByRole('button', { name: 'Ver solo las trabadas (2)' })).toBeInTheDocument()
  })

  test('el buscador barre titular, estado y monto tal como se ven', async () => {
    renderSection()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    const search = screen.getByLabelText('Buscar')
    fireEvent.change(search, { target: { value: 'marta' } })
    expect(tableNames()).toEqual(['Ana Alfa'])
    fireEvent.change(search, { target: { value: 'prepago' } })
    expect(tableNames()).toEqual(['Dora Delta'])
    fireEvent.change(search, { target: { value: '$ 20.000' } })
    expect(tableNames()).toEqual(['Beto Beta'])
    // El mes cubierto se encuentra por el valor tachado que muestra
    fireEvent.change(search, { target: { value: '27.000' } })
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
    expect(dialog).toHaveTextContent('$ 146.000')
    expect(dialog).toHaveTextContent('Pendiente de cobro$ 20.000')
  })

  test('si la carga falla se puede reintentar', async () => {
    loadPadron.mockReset().mockRejectedValueOnce(new Error('sin conexión')).mockResolvedValueOnce(ROWS)
    renderSection()
    expect(await screen.findByText('No se pudieron cargar los datos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})
