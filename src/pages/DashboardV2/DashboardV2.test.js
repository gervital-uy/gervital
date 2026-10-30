import { render, screen, fireEvent } from '@testing-library/react'
import DashboardV2 from './DashboardV2'

// react-router-dom 7 solo publica `exports`, que el resolver de jest de CRA no lee:
// se reemplaza Link por un <a> (las rutas no son lo que se prueba acá).
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>
}), { virtual: true })

// date-fns/locale es ESM y jest (CRA) no lo transforma; el navegador de meses no es lo
// que se prueba acá.
jest.mock('../../components/ui/MonthNavigator', () => () => null)
// Gestión CFP lee el padrón real; acá alcanza con uno vacío.
jest.mock('../../services/dashboardV2/queries', () => ({ loadPadron: jest.fn() }))
const { loadPadron } = jest.requireMock('../../services/dashboardV2/queries')

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

  test('cambiar de pestaña muestra sus tarjetas', () => {
    loadPadron.mockImplementation(() => new Promise(() => {}))
    mockRole = 'superadmin'
    render(<DashboardV2 />)
    fireEvent.click(screen.getByRole('button', { name: 'Finanzas' }))
    expect(screen.getByText('Punto de equilibrio')).toBeInTheDocument()
    expect(screen.queryByText('Cobranza y facturación')).not.toBeInTheDocument()
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
