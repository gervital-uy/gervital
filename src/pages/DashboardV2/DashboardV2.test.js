import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DashboardV2 from './DashboardV2'

// react-router-dom 7 solo publica `exports`, que el resolver de jest de CRA no lee:
// se reemplaza Link por un <a> (las rutas no son lo que se prueba acá).
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>
}), { virtual: true })

// date-fns/locale es ESM y jest (CRA) no lo transforma; el navegador de meses no es lo
// que se prueba acá.
jest.mock('../../components/ui/MonthNavigator', () => () => null)
// Gestión CFP lee el padrón real; acá alcanza con uno vacío. Finanzas, una serie vacía.
jest.mock('../../services/dashboardV2/queries', () => ({ loadPadron: jest.fn() }))
const { loadPadron } = jest.requireMock('../../services/dashboardV2/queries')
jest.mock('../../services/dashboardV2/financeQueries', () => ({ loadFinanceData: jest.fn(), getTransportMonthSources: jest.fn() }))
const { loadFinanceData } = jest.requireMock('../../services/dashboardV2/financeQueries')
jest.mock('../../services/settings/appSettingsService', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }))
// Comercial se carga de una sola vez; acá alcanza con que nunca termine.
jest.mock('../../services/dashboardV2/commercialQueries', () => ({ loadCommercial: jest.fn(), saveShiftCapacity: jest.fn() }))
const { loadCommercial } = jest.requireMock('../../services/dashboardV2/commercialQueries')

let mockRole = 'superadmin'
jest.mock('../../context/AuthContext', () => {
  const actual = jest.requireActual('../../context/AuthContext')
  return { ...actual, useAuth: () => ({ hasAccess: f => actual.roleHasAccess(mockRole, f) }) }
})

const tabLabels = () => screen.queryAllByRole('button')
  .map(b => b.textContent)
  .filter(t => ['Gestión CFP', 'Finanzas', 'Comercial', 'Asistencia'].includes(t))

describe('DashboardV2 — shell', () => {
  // CRA resetea los mocks antes de cada test: el padrón vacío se fija acá.
  beforeEach(() => loadPadron.mockResolvedValue([]))

  test('superadmin ve las cuatro pestañas en el orden de la maqueta y abre en Gestión CFP', async () => {
    mockRole = 'superadmin'
    render(<DashboardV2 />)
    expect(tabLabels()).toEqual(['Gestión CFP', 'Finanzas', 'Comercial', 'Asistencia'])
    expect(screen.getByText('Cobranza y facturación')).toBeInTheDocument()
    // Esperar la carga del padrón (vacío) para que no quede un render fuera de act
    expect(await screen.findByText('No hay clientes para cobrar en este mes.')).toBeInTheDocument()
  })

  test('cambiar de pestaña muestra su sección: Finanzas ya no es un placeholder', async () => {
    loadPadron.mockImplementation(() => new Promise(() => {}))
    loadFinanceData.mockResolvedValue({ sources: [], costs: {} })
    mockRole = 'superadmin'
    render(<DashboardV2 />)
    fireEvent.click(screen.getByRole('button', { name: 'Finanzas' }))
    expect(screen.getByText('Ingresos, gastos y resultado')).toBeInTheDocument()
    expect(screen.queryByText('Cobranza y facturación')).not.toBeInTheDocument()
    expect(await screen.findByText('Todavía no hay meses con datos.')).toBeInTheDocument()
    expect(screen.queryByText(/próximamente/)).not.toBeInTheDocument()
  })

  test('Comercial ya no es un placeholder: abre la sección real', async () => {
    loadPadron.mockImplementation(() => new Promise(() => {}))
    loadCommercial.mockImplementation(() => new Promise(() => {}))
    mockRole = 'superadmin'
    render(<DashboardV2 />)
    fireEvent.click(screen.getByRole('button', { name: 'Comercial' }))
    expect(screen.getByText('Cargando la cartera…')).toBeInTheDocument()
    expect(screen.queryByText(/próximamente/i)).not.toBeInTheDocument()
    await waitFor(() => expect(loadCommercial).toHaveBeenCalledTimes(1))
  })

  test('cada pestaña respeta su feature: admin ve solo Gestión CFP y Asistencia', async () => {
    mockRole = 'admin'
    render(<DashboardV2 />)
    expect(tabLabels()).toEqual(['Gestión CFP', 'Asistencia'])
    expect(await screen.findByText('No hay clientes para cobrar en este mes.')).toBeInTheDocument()
  })

  test('un rol sin secciones ve un aviso y no se rompe', () => {
    mockRole = 'operador'
    render(<DashboardV2 />)
    expect(tabLabels()).toEqual([])
    expect(screen.getByText(/no tiene acceso/)).toBeInTheDocument()
  })
})
