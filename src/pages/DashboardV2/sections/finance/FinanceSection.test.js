import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react'
import FinanceSection from './FinanceSection'
import { MonthDataProvider } from '../../useMonthData'

// react-router-dom 7 solo publica `exports`, que el resolver de jest de CRA no lee.
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>
}), { virtual: true })

jest.mock('../../../../services/dashboardV2/financeQueries', () => ({ loadFinanceData: jest.fn() }))
jest.mock('../../../../services/settings/appSettingsService', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }))
// Hoy fijo: septiembre de 2026 es el mes en curso.
jest.mock('../../useToday', () => ({ useToday: () => '2026-09-20' }))

const { loadFinanceData } = jest.requireMock('../../../../services/dashboardV2/financeQueries')
const { getSetting, setSetting } = jest.requireMock('../../../../services/settings/appSettingsService')

// Cuatro meses (montos con IVA que netean redondo: 30.500 / 1,22 = 25.000):
//   jun: dos cuotas · jul: más transporte (11.000 / 1,10 = 10.000) y el seguro anual
//   ago: arranca una promo de 3 meses (paquete de 91.500)
//   sep: el mes 2 de la promo no aporta y un gasto variable de 80.000 lo deja en rojo
const row = (id, over = {}) => ({
  client_id: id, attendance_gross: 30500, transport_gross: 0, payment_status: 'paid', paid_amount: 30500,
  promo_index: null, promo_total_amount: null, promo_id: null, ...over
})
const source = (month, panel, variable = 0) => ({
  year: 2026,
  month,
  panel,
  payments: [],
  variableRows: variable ? [{ year: 2026, month, amount: variable, categoryName: 'Alimentación' }] : [],
  extraordinaryRows: []
})
const PROMO = { promo_id: 'p1', promo_total_amount: 91500 }
const DATA = {
  sources: [
    source(5, [row('a'), row('b')]),
    source(6, [row('a'), row('b', { transport_gross: 11000, paid_amount: 41500 })]),
    source(7, [row('a'), row('b'), row('c', { ...PROMO, promo_index: 1, paid_amount: 91500 })]),
    source(8, [row('a'), row('b', { payment_status: 'pending', paid_amount: null }), row('c', { ...PROMO, promo_index: 2, payment_status: 'prepaid', paid_amount: 0 })], 80000)
  ],
  costs: {
    employees: [],
    extraCosts: [],
    providers: [{ id: 'p', name: 'Ana', role: 'Chofer', monthlyAmount: 10000, active: true, createdAt: '2026-06-01T12:00:00Z' }],
    fixedTemplates: [{ amount: 12000, periodMonths: 12, startYear: 2026, startMonth: 6, categoryName: 'Seguros' }],
    directorStart: null
  }
}

const renderSection = (selected = { year: 2026, month: 8 }, onSelectMonth = () => {}) => render(
  <MonthDataProvider>
    <FinanceSection selected={selected} onSelectMonth={onSelectMonth} />
  </MonthDataProvider>
)
// Deja correr las promesas pendientes (la serie y la meta guardada).
const flush = () => act(() => Promise.resolve())
const kpi = label => within(screen.getByRole('group', { name: label }))

describe('Finanzas', () => {
  beforeEach(() => {
    loadFinanceData.mockResolvedValue(DATA)
    getSetting.mockResolvedValue(null)
    setSetting.mockResolvedValue(undefined)
  })

  test('pide la serie hasta el mes en curso, una sola vez', async () => {
    renderSection()
    await screen.findByText('Total gastos')
    expect(loadFinanceData).toHaveBeenCalledTimes(1)
    expect(loadFinanceData).toHaveBeenCalledWith({ year: 2026, month: 8 })
  })

  test('muestra el gráfico y los KPIs con la base bien rotulada, sin "próximamente"', async () => {
    renderSection()
    expect(await screen.findByText('Ingresos, gastos y resultado')).toBeInTheDocument()
    expect(screen.getByText('Mes a mes, en pesos')).toBeInTheDocument()
    expect(screen.getByText('Mes en curso')).toBeInTheDocument()
    // sep: 25.000 + 25.000 (pendiente) + 0 del mes cubierto; gastos 10.000 + 1.000 + 80.000
    expect(kpi('A ingresar al banco').getByText('$ 50.000')).toBeInTheDocument()
    expect(kpi('A ingresar al banco').getByText(/Ya entró \$ 25k · falta \$ 25k/)).toBeInTheDocument()
    expect(kpi('A ingresar al banco').getByText(/cubiertos −\$ 25k/)).toBeInTheDocument()
    expect(kpi('Total gastos').getByText('$ 91.000')).toBeInTheDocument()
    expect(kpi('Resultado del mes').getByText('−$ 41.000')).toBeInTheDocument()
    expect(screen.getByText('Margen promedio 4 m')).toBeInTheDocument()
    expect(screen.queryByText(/cobrado/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/próximamente/i)).not.toBeInTheDocument()
  })

  test('la cifra de Pesos es el resultado con los fijos en caja del mes elegido', async () => {
    renderSection({ year: 2026, month: 6 })
    await screen.findByText('Total gastos')
    // jul: 60.000 − 10.000 − 12.000 del seguro anual (en el KPI va 1.000 por mes)
    expect(screen.getByText('Resultado de jul · fijos en caja')).toBeInTheDocument()
    expect(screen.getAllByText('$ 38.000').length).toBeGreaterThan(0)
    expect(kpi('Resultado del mes').getByText('$ 49.000')).toBeInTheDocument()
  })

  test('tocar una barra elige ese mes', async () => {
    const onSelectMonth = jest.fn()
    renderSection(undefined, onSelectMonth)
    await screen.findByText('Total gastos')
    fireEvent.click(screen.getByRole('button', { name: 'jul 2026' }))
    expect(onSelectMonth).toHaveBeenCalledWith({ year: 2026, month: 6 })
  })

  test('las tres vistas comparten el período', async () => {
    renderSection()
    await screen.findByText('Total gastos')
    fireEvent.click(screen.getByRole('button', { name: 'Tendencia' }))
    expect(screen.getByText('A ingresar al banco contra costo total')).toBeInTheDocument()
    expect(screen.getByText(/jun 26 – sep 26 · 4 de 12 meses con datos/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Márgenes' }))
    expect(screen.getByText('Evolución de márgenes')).toBeInTheDocument()
    expect(screen.getByText(/jun 26 – sep 26/)).toBeInTheDocument()
  })

  test('Años e Interanual quedan deshabilitados y explicados sin año anterior', async () => {
    renderSection()
    await screen.findByText('Total gastos')
    expect(screen.getByRole('button', { name: 'Interanual' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Años/ })).toBeDisabled()
    expect(screen.getByText(/Años e Interanual se habilitan cuando la serie tenga más de un año/)).toBeInTheDocument()
  })

  test('el filtro de meses recorta, avisa y Limpiar vuelve al arranque', async () => {
    const onSelectMonth = jest.fn()
    renderSection({ year: 2026, month: 7 }, onSelectMonth)
    await screen.findByText('Total gastos')
    fireEvent.click(screen.getByRole('button', { name: /^Meses/ }))
    fireEvent.click(screen.getByRole('button', { name: 'jul' }))
    expect(screen.getByText(/queda un solo mes \(julio 2026\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'jul 2026' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ago 2026' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Limpiar/ }))
    expect(screen.getByRole('button', { name: 'ago 2026' })).toBeInTheDocument()
    expect(onSelectMonth).toHaveBeenCalledWith({ year: 2026, month: 8 })
  })

  test('dos o más meses filtrados muestran la tabla de períodos', async () => {
    renderSection()
    await screen.findByText('Total gastos')
    fireEvent.click(screen.getByRole('button', { name: /^Meses/ }))
    fireEvent.click(screen.getByRole('button', { name: 'jul' }))
    fireEvent.click(screen.getByRole('button', { name: 'ago' }))
    expect(screen.getByText('Comparación de períodos')).toBeInTheDocument()
  })

  test('la "i" de un KPI explica la cuenta del mes', async () => {
    renderSection()
    await screen.findByText('Total gastos')
    fireEvent.click(kpi('Total gastos').getByRole('button', { name: 'Cómo se calcula' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Gastos variables')).toBeInTheDocument()
    expect(within(dialog).getByText('$ 80.000')).toBeInTheDocument()
  })
})

describe('Finanzas: meta de margen neto', () => {
  beforeEach(() => {
    loadFinanceData.mockResolvedValue(DATA)
    setSetting.mockResolvedValue(undefined)
  })

  const openTarget = async () => {
    renderSection()
    await screen.findByText('Total gastos')
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Márgenes' }))
    fireEvent.click(screen.getByRole('button', { name: /Meta neto/ }))
    return screen.getByRole('dialog', { name: 'Meta de margen neto' })
  }

  test('arranca sin definir y solo se guarda con Guardar', async () => {
    getSetting.mockResolvedValue(null)
    const panel = await openTarget()
    expect(screen.getByRole('button', { name: /Meta neto/ })).toHaveTextContent('sin definir')
    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: '20' } })
    // Probar no escribe: el gráfico muestra la meta, la base no se toca
    expect(setSetting).not.toHaveBeenCalled()
    expect(screen.getByText('meta 20%')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Meta neto/ })).toHaveTextContent('20%'))
    expect(setSetting).toHaveBeenCalledWith('net_margin_target', '20')
  })

  test('"Sin meta" guarda texto vacío, nunca null', async () => {
    getSetting.mockResolvedValue('15')
    const panel = await openTarget()
    fireEvent.click(within(panel).getByRole('button', { name: 'Sin meta' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Meta neto/ })).toHaveTextContent('sin definir'))
    expect(setSetting).toHaveBeenCalledWith('net_margin_target', '')
  })

  test('cancelar descarta lo probado', async () => {
    getSetting.mockResolvedValue('15')
    const panel = await openTarget()
    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: '30' } })
    expect(screen.getByText('meta 30%')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancelar' }))
    expect(setSetting).not.toHaveBeenCalled()
    expect(screen.getByText('meta 15%')).toBeInTheDocument()
  })

  test('si no se puede leer la meta guardada, el control solo simula', async () => {
    getSetting.mockRejectedValue(new Error('sin permiso'))
    const panel = await openTarget()
    expect(within(panel).getByText(/acá solo se prueba en el gráfico, no se guarda/)).toBeInTheDocument()
    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: '12' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Probar' }))
    expect(setSetting).not.toHaveBeenCalled()
    expect(screen.getByText('meta 12%')).toBeInTheDocument()
  })
})

describe('Finanzas: carga', () => {
  test('un error se muestra con reintento', async () => {
    getSetting.mockResolvedValue(null)
    loadFinanceData.mockRejectedValueOnce(new Error('se cayó')).mockResolvedValue(DATA)
    renderSection()
    expect(await screen.findByText('No se pudieron cargar los datos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Total gastos')).toBeInTheDocument()
  })
})
