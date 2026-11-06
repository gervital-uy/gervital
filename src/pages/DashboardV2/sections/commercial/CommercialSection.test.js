import { act, render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import CommercialSection from './CommercialSection'
import { MonthDataProvider } from '../../useMonthData'
import { buildCommercial } from '../../../../services/dashboardV2/commercialView'

// react-router-dom 7 solo publica `exports`, que el resolver de jest de CRA no lee:
// se reemplaza Link por un <a> (las rutas no son lo que se prueba acá).
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>
}), { virtual: true })

jest.mock('../../../../services/dashboardV2/commercialQueries', () => ({ loadCommercial: jest.fn(), saveShiftCapacity: jest.fn() }))
const { loadCommercial, saveShiftCapacity } = jest.requireMock('../../../../services/dashboardV2/commercialQueries')

let mockCanWriteSettings = true
jest.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ hasAccess: feature => feature !== 'expense_settings' || mockCanWriteSettings })
}))

// El día que ve la pantalla, fijo: el modelo de cada test se arma con el mismo día.
let mockToday = '2026-11-06'
jest.mock('../../useToday', () => ({ useToday: () => mockToday }))

// Una cartera chica (hoy = 6 de noviembre de 2026):
//   Ana: heredada, 2× tarde con transporte y 10% de descuento en octubre
//   Beto: heredado de día completo, se va el 15 de octubre por salud
//   Carla: alta del 10 de septiembre, 1× tarde (viernes)
const PRICING = {
  planPricing: [
    { frequency: 1, schedule: 'afternoon', priceNet: 16393.44, effectiveYear: 2000, effectiveMonth: 0 },
    { frequency: 2, schedule: 'afternoon', priceNet: 24590.16, effectiveYear: 2000, effectiveMonth: 0 },
    { frequency: 5, schedule: 'full_day', priceNet: 66393.44, effectiveYear: 2000, effectiveMonth: 0 }
  ],
  transportPricing: [{ frequency: 2, distanceRange: '0_to_2km', priceNet: 4654.55, effectiveYear: 2000, effectiveMonth: 0 }]
}
const client = (id, firstName, over = {}) => ({
  id, firstName, lastName: 'Test', clientType: 'regular', startDate: '2026-06-01', birthDate: '1940-05-10', cognitiveLevel: 'B', distanceRange: '0_to_2km', ...over
})
const plan = (clientId, over = {}) => ({
  clientId, effectiveFrom: '2026-06-01', frequency: 2, schedule: 'afternoon', hasTransport: false, assignedDays: ['tuesday', 'thursday'], ...over
})
const SOURCES = {
  ...PRICING,
  clients: [
    client('a', 'Ana'),
    client('b', 'Beto', { cognitiveLevel: 'D', birthDate: '1931-02-01' }),
    client('c', 'Carla', { startDate: '2026-09-10', cognitiveLevel: 'A', birthDate: null })
  ],
  periods: [{ clientId: 'b', fromDate: '2026-10-15', toDate: null, reason: 'health_decline' }],
  followups: [],
  plans: [
    plan('a', { hasTransport: true }),
    plan('b', { frequency: 5, schedule: 'full_day', assignedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }),
    plan('c', { effectiveFrom: '2026-09-01', frequency: 1, assignedDays: ['friday'] })
  ],
  discounts: [{ clientId: 'a', year: 2026, month: 9, discountPercent: 10 }],
  reasons: [{ key: 'health_decline', label: 'Deterioro de salud', color: '#dc2626', sortOrder: 3 }],
  shiftCapacity: '20'
}
const model = (over = {}, today = '2026-11-06') => buildCommercial({ ...SOURCES, ...over }, { today })

const tree = (selected = { year: 2026, month: 9 }, mounted = true) => (
  <MonthDataProvider>
    {mounted && <CommercialSection selected={{ ...selected }} />}
  </MonthDataProvider>
)
const renderSection = selected => render(tree(selected))

// Cada KPI y cada tarjeta es un grupo con su nombre.
const cardOf = name => screen.getByRole('group', { name })

describe('Comercial', () => {
  beforeEach(() => {
    mockCanWriteSettings = true
    mockToday = '2026-11-06'
    loadCommercial.mockReset().mockResolvedValue(model())
    saveShiftCapacity.mockReset().mockResolvedValue()
  })

  test('muestra la cartera del mes con todas sus tarjetas y nada "próximamente"', async () => {
    renderSection()
    expect(screen.getByRole('status')).toHaveTextContent('Cargando la cartera')
    const active = await screen.findByRole('group', { name: 'Clientes activos' })
    // Octubre: base 3, una baja (Beto) y ninguna alta
    expect(within(active).getByText('2')).toBeInTheDocument()
    expect(within(active).getByText('0 altas y 1 baja sobre una base de 3')).toBeInTheDocument()
    // MRR: Ana 24.590,16 × 0,9 + 4.654,55 de transporte; Carla 16.393,44
    expect(within(cardOf('MRR contratado')).getByText('$ 43.180')).toBeInTheDocument()
    expect(within(cardOf('MRR perdido')).getByText('−$ 66.393')).toBeInTheDocument()
    for (const title of ['Churn 12 meses', 'MRR ganado', 'Permanencia media', 'Ocupación y rendimiento por lugar', 'Mapa de calor de ocupación',
      'Composición de la base', 'Aporte a la facturación', 'Altas vs Bajas', 'Bajas por motivo', 'Retención por cohortes']) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
    expect(screen.getByText('Deterioro de salud')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver seguimiento/ })).toHaveAttribute('href', '/bajas')
    expect(screen.queryByText(/próximamente/i)).not.toBeInTheDocument()
    // Una sola carga para todos los meses
    expect(loadCommercial).toHaveBeenCalledTimes(1)
  })

  test('un error se puede reintentar', async () => {
    loadCommercial.mockRejectedValueOnce(new Error('sin conexión'))
    renderSection()
    expect(await screen.findByText('sin conexión')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Clientes activos')).toBeInTheDocument()
    expect(loadCommercial).toHaveBeenCalledTimes(2)
  })

  test('un mes sin datos lo dice', async () => {
    renderSection({ year: 2026, month: 3 })
    expect(await screen.findByText('No hay datos comerciales para este mes.')).toBeInTheDocument()
  })

  test('el mes en curso avisa que va hasta hoy y no compara sus flujos con el promedio', async () => {
    renderSection({ year: 2026, month: 10 })
    expect(await screen.findByText(/Mes en curso: los números van hasta hoy, 6 nov 2026/)).toBeInTheDocument()
    for (const name of ['MRR ganado', 'MRR perdido']) {
      expect(within(cardOf(name)).getByText('mes en curso')).toBeInTheDocument()
      expect(within(cardOf(name)).queryByText(/vs promedio/)).not.toBeInTheDocument()
    }
    expect(within(cardOf('Churn 12 meses')).getByText('bajas: mes en curso')).toBeInTheDocument()
    // El promedio es de los meses cerrados (jun–oct), sin noviembre
    expect(within(cardOf('MRR ganado')).getByText(/por mes en promedio · 5 meses cerrados/)).toBeInTheDocument()
  })

  test('un mes cerrado se compara con el promedio de los meses cerrados', async () => {
    renderSection()
    await screen.findByText('Clientes activos')
    // Octubre: la baja de Beto (66.393) contra un promedio de 66.393 / 5
    const lost = cardOf('MRR perdido')
    expect(within(lost).getByText('vs promedio 5 m')).toBeInTheDocument()
    expect(within(lost).getByText('↑400%')).toBeInTheDocument()
    expect(within(cardOf('Churn 12 meses')).getByText('bajas vs promedio')).toBeInTheDocument()
  })

  test('al volver a la pestaña otro día, rehace la cartera', async () => {
    const { rerender } = render(tree({ year: 2026, month: 10 }))
    expect(await screen.findByText(/van hasta hoy, 6 nov 2026/)).toBeInTheDocument()
    // Se va a otra pestaña (la sección se desmonta, el caché queda) y vuelve al otro día
    rerender(tree({ year: 2026, month: 10 }, false))
    mockToday = '2026-11-07'
    loadCommercial.mockResolvedValue(model({}, '2026-11-07'))
    rerender(tree({ year: 2026, month: 10 }))
    expect(await screen.findByText(/van hasta hoy, 7 nov 2026/)).toBeInTheDocument()
    expect(loadCommercial).toHaveBeenCalledTimes(2)
  })

  test('al empezar un mes con la pestaña abierta, rehace la cartera una sola vez y sin vaciarla', async () => {
    mockToday = '2026-11-30'
    loadCommercial.mockResolvedValue(model({}, '2026-11-30'))
    const { rerender } = render(tree())
    await screen.findByText('Clientes activos')
    mockToday = '2026-12-01'
    loadCommercial.mockResolvedValue(model({}, '2026-12-01'))
    rerender(tree())
    // Lo que está en pantalla se queda mientras se rehace
    expect(screen.getByText('Clientes activos')).toBeInTheDocument()
    expect(screen.queryByText('Cargando la cartera…')).not.toBeInTheDocument()
    await waitFor(() => expect(loadCommercial).toHaveBeenCalledTimes(2))
    // El mes nuevo ya está en el modelo
    rerender(tree({ year: 2026, month: 11 }))
    expect(await screen.findByText(/van hasta hoy, 1 dic 2026/)).toBeInTheDocument()
    expect(loadCommercial).toHaveBeenCalledTimes(2)
  })

  test('probar un aforo no guarda nada; guardarlo es un botón aparte', async () => {
    renderSection()
    await screen.findByText('Clientes activos')
    expect(screen.queryByText(/Probando/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Subir el aforo' }))
    expect(screen.getByText(/Probando/)).toHaveTextContent('Probando 21 lugares por turno: no está guardado. El guardado es 20.')
    expect(screen.getByText(/aforo 21 por turno \(a prueba\)/)).toBeInTheDocument()
    expect(saveShiftCapacity).not.toHaveBeenCalled()

    // Volver deja el guardado
    fireEvent.click(screen.getByRole('button', { name: 'Volver a 20' }))
    expect(screen.queryByText(/Probando/)).not.toBeInTheDocument()

    // Escribir otro valor y guardarlo: recarga la cartera
    const input = screen.getByRole('textbox', { name: 'Aforo por turno' })
    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.blur(input)
    loadCommercial.mockResolvedValue(model({ shiftCapacity: '25' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 25 como aforo' }))
    expect(saveShiftCapacity).toHaveBeenCalledWith(25)
    expect(await screen.findByText('Aforo guardado: 25 lugares por turno.')).toBeInTheDocument()
    await waitFor(() => expect(loadCommercial).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/aforo 25 por turno$/)).toBeInTheDocument()
  })

  test('sin permiso de escritura el aforo solo se simula', async () => {
    mockCanWriteSettings = false
    loadCommercial.mockResolvedValue(model({ shiftCapacity: null }))
    renderSection()
    expect(await screen.findByText('Sin aforo guardado: se usan 30 lugares por turno por defecto.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bajar el aforo' }))
    expect(screen.getByText(/Probando/)).toHaveTextContent('Probando 29 lugares por turno: no está guardado. Sin aforo guardado se usan 30.')
    expect(screen.queryByRole('button', { name: /como aforo/ })).not.toBeInTheDocument()
  })

  test('mientras se guarda el aforo no se puede probar otro', async () => {
    let finish
    saveShiftCapacity.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    renderSection()
    await screen.findByText('Clientes activos')
    fireEvent.click(screen.getByRole('button', { name: 'Subir el aforo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 21 como aforo' }))
    expect(screen.getByText('Guardando el aforo…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subir el aforo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar el aforo' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Aforo por turno' })).toBeDisabled()
    loadCommercial.mockResolvedValue(model({ shiftCapacity: '21' }))
    await act(async () => finish())
    expect(await screen.findByText('Aforo guardado: 21 lugares por turno.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subir el aforo' })).toBeEnabled()
  })

  test('un aforo que no se pudo guardar lo avisa y sigue a prueba', async () => {
    saveShiftCapacity.mockRejectedValueOnce(new Error('sin permiso'))
    renderSection()
    await screen.findByText('Clientes activos')
    fireEvent.click(screen.getByRole('button', { name: 'Subir el aforo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 21 como aforo' }))
    expect(await screen.findByText('No se pudo guardar el aforo: sin permiso')).toBeInTheDocument()
    expect(screen.getByText(/aforo 21 por turno \(a prueba\)/)).toBeInTheDocument()
  })

  test('los selectores cambian la dimensión, la ventana y la vista', async () => {
    renderSection()
    await screen.findByText('Clientes activos')
    const composition = cardOf('Composición de la base')
    fireEvent.click(within(composition).getByRole('button', { name: 'Edad' }))
    // Ana tiene 86 al cierre de octubre; Carla no tiene fecha de nacimiento
    expect(within(composition).getByText('85 a 89')).toBeInTheDocument()
    expect(within(composition).getByText('Sin dato')).toBeInTheDocument()

    const exits = cardOf('Bajas por motivo')
    fireEvent.click(within(exits).getByRole('button', { name: 'Histórico' }))
    expect(within(exits).getByText(/Toda la historia cargada · 1 baja/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tiers' }))
    expect(screen.getByText('Quiénes ocupan cada casillero, por tier')).toBeInTheDocument()

    // Cohorte de septiembre (Carla): el detalle dice quién sigue
    fireEvent.click(screen.getByRole('button', { name: 'Mensual' }))
    fireEvent.click(screen.getByRole('button', { name: 'sep 26, mes 1: 1 de 1 siguen activos' }))
    expect(screen.getByText('Carla Test')).toBeInTheDocument()

    // Interanual: con un solo año no hay con qué comparar
    fireEvent.click(screen.getByRole('button', { name: 'Interanual' }))
    expect(screen.getByText(/todavía no hay con qué comparar/)).toBeInTheDocument()
  })

  test('la "i" del MRR abre su explicación con los números del mes', async () => {
    renderSection()
    await screen.findByText('Clientes activos')
    fireEvent.click(within(cardOf('MRR contratado')).getByRole('button', { name: 'Cómo se calcula' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Descuentos del mes (promos y sueltos)')).toBeInTheDocument()
    expect(within(dialog).getByText('$ 2.459')).toBeInTheDocument()
    expect(within(dialog).getAllByText('$ 43.180').length).toBeGreaterThan(0)
  })
})
