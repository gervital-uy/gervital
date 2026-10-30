import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import CfpSection from './CfpSection'
import { MonthDataProvider } from '../../useMonthData'
import { buildPadron } from '../../../../services/dashboardV2/padron'
import { markMonthPaid, unmarkMonthPaid } from '../../../../services/invoices/invoiceService'
import { collectPromo, uncollectPromo } from '../../../../services/promotions/promotionService'

jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>
}), { virtual: true })
jest.mock('../../../../services/dashboardV2/queries', () => ({ loadPadron: jest.fn(), getMonthPaymentStates: jest.fn() }))
jest.mock('../../../../services/invoices/invoiceService', () => ({ markMonthPaid: jest.fn(), unmarkMonthPaid: jest.fn() }))
jest.mock('../../../../services/promotions/promotionService', () => ({ collectPromo: jest.fn(), uncollectPromo: jest.fn() }))
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), todayStr: () => '2026-10-30' }))
// Permisos reales por rol: un nombre de feature equivocado rompe los tests del ancla.
let mockRole = 'superadmin'
jest.mock('../../../../context/AuthContext', () => {
  const { roleHasAccess } = jest.requireActual('../../../../context/AuthContext')
  return { useAuth: () => ({ hasAccess: f => roleHasAccess(mockRole, f) }) }
})
const { loadPadron, getMonthPaymentStates } = jest.requireMock('../../../../services/dashboardV2/queries')

// Octubre 2026:
//   a, b: cuotas pendientes · p: ancla pendiente de una promo de 3 meses (p2 su mes 2)
//   x: cuota cobrada sin factura · y: cuota cobrada y facturada · z: ancla cobrada sin factura
const PROMO = { promo_total: 3, promo_percent: 10, promo_total_amount: 60000, attendance_gross: 20000, transport_gross: 0 }
const PANEL = [
  { client_id: 'a', attendance_gross: 30000, transport_gross: 0, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'b', attendance_gross: 25000, transport_gross: 0, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'p', ...PROMO, promo_id: 'promo-p', promo_index: 1, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'p2', ...PROMO, promo_id: 'promo-p', promo_index: 2, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'x', attendance_gross: 15000, transport_gross: 0, payment_status: 'paid', paid_amount: 15000, paid_date: '2026-10-04', invoice_status: 'pending' },
  { client_id: 'y', attendance_gross: 15000, transport_gross: 0, payment_status: 'paid', paid_amount: 15000, paid_date: '2026-10-04', invoice_status: 'invoiced', invoiced_amount: 15000 },
  { client_id: 'z', ...PROMO, promo_id: 'promo-z', promo_index: 1, payment_status: 'paid', paid_amount: 60000, paid_date: '2026-10-02', invoice_status: 'pending' }
]
const NAMES = { a: 'Ana', b: 'Beto', p: 'Pía', p2: 'Pía2', x: 'Ximena', y: 'Yamila', z: 'Zoe' }
const padron = (panel, month = 9) => buildPadron({
  panel,
  clients: Object.entries(NAMES).map(([id, firstName]) => ({
    id, firstName, lastName: 'Test', documentNumber: '1', email: 'x@y.com', address: { street: 's' }, startDate: '2026-07-01', inactivityPeriods: []
  })),
  breakdown: panel.map(p => ({ clientId: p.client_id, frequency: 2, schedule: 'afternoon', hasTransport: false }))
}, { year: 2026, month, today: '2026-10-30' })
const ROWS = padron(PANEL)
// Lo que dice la base hoy: lo mismo que el padrón
const LIVE = new Map(PANEL.map(p => [p.client_id, { client_id: p.client_id, payment_status: p.payment_status, invoice_status: p.invoice_status, promo_id: p.promo_id || null }]))
const paidIn = ids => padron(PANEL.map(p => (ids.includes(p.client_id) ? { ...p, payment_status: 'paid', paid_amount: 30000, paid_date: '2026-10-03' } : p)))

const deferred = () => {
  let resolve
  const promise = new Promise(res => { resolve = res })
  return { promise, resolve }
}

const tree = month => <MonthDataProvider><CfpSection selected={{ year: 2026, month }} /></MonthDataProvider>
const renderSection = async () => {
  const utils = render(tree(9))
  await screen.findByRole('table')
  return utils
}
const row = name => screen.getByRole('row', { name: new RegExp(`${name} Test`) })
const dateInput = name => screen.getByLabelText(`Fecha de pago de ${name} Test`)
const setDate = (name, value) => fireEvent.change(dateInput(name), { target: { value } })

describe('Gestión CFP: cobros desde la tabla', () => {
  beforeEach(() => {
    mockRole = 'superadmin'
    loadPadron.mockReset().mockResolvedValue(ROWS)
    getMonthPaymentStates.mockReset().mockResolvedValue(LIVE)
    markMonthPaid.mockReset().mockResolvedValue({ success: true })
    collectPromo.mockReset().mockResolvedValue({ success: true })
    unmarkMonthPaid.mockReset().mockResolvedValue()
    uncollectPromo.mockReset().mockResolvedValue({ success: true })
  })

  test('cobro por fila: pide la fecha, cobra sin monto, recarga y limpia lo cobrado', async () => {
    loadPadron.mockResolvedValueOnce(ROWS).mockResolvedValueOnce(paidIn(['a']))
    await renderSection()
    const button = within(row('Ana')).getByRole('button', { name: 'Marcar cobrado' })
    expect(button).toBeDisabled()
    setDate('Ana', '2026-10-03')
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(await screen.findByText('1 cobro registrado.', { exact: false })).toBeInTheDocument()
    expect(markMonthPaid).toHaveBeenCalledWith('a', 2026, 9, null, null, null, '2026-10-03')
    await waitFor(() => expect(loadPadron).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByLabelText('Fecha de pago de Ana Test')).not.toBeInTheDocument())
    expect(screen.queryByText(/con fecha cargada/)).not.toBeInTheDocument()
  })

  test('mientras se registra, nada se puede volver a mandar', async () => {
    const pending = deferred()
    markMonthPaid.mockReturnValueOnce(pending.promise)
    await renderSection()
    setDate('Ana', '2026-10-03')
    setDate('Beto', '2026-10-04')
    fireEvent.click(within(row('Ana')).getByRole('button', { name: 'Marcar cobrado' }))
    await waitFor(() => expect(markMonthPaid).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Registrando…' })).toBeDisabled()
    expect(within(row('Beto')).getByRole('button', { name: 'Marcar cobrado' })).toBeDisabled()
    expect(dateInput('Beto')).toBeDisabled()
    fireEvent.click(within(row('Ana')).getByRole('button', { name: 'Marcar cobrado' }))
    expect(markMonthPaid).toHaveBeenCalledTimes(1)
    pending.resolve({ success: true })
    expect(await screen.findByText('1 cobro registrado.', { exact: false })).toBeInTheDocument()
  })

  test('una fecha fuera de la ventana se marca y no habilita el cobro', async () => {
    await renderSection()
    setDate('Ana', '2026-11-05')
    expect(dateInput('Ana')).toHaveAttribute('aria-invalid', 'true')
    expect(within(row('Ana')).getByText('fuera de rango')).toBeInTheDocument()
    const button = within(row('Ana')).getByRole('button', { name: 'Marcar cobrado' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringMatching(/ficha del cliente/))
    setDate('Beto', '2026-10-03')
    expect(screen.getByText('1 fecha fuera de rango', { exact: false })).toBeInTheDocument()
  })

  test('lote preparado: cada fila con su fecha, también las que el filtro esconde', async () => {
    await renderSection()
    setDate('Ana', '2026-10-03')
    setDate('Beto', '2026-09-30')
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'beto' } })
    expect(screen.getByText('1 fuera de este filtro', { exact: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar cobrados (2)' }))
    expect(await screen.findByText('2 cobros registrados.', { exact: false })).toBeInTheDocument()
    expect(markMonthPaid).toHaveBeenCalledWith('a', 2026, 9, null, null, null, '2026-10-03')
    expect(markMonthPaid).toHaveBeenCalledWith('b', 2026, 9, null, null, null, '2026-09-30')
  })

  test('el ancla de una promo cobra el paquete; sus meses siguientes no se cobran sueltos', async () => {
    await renderSection()
    expect(within(row('Pía2')).queryByRole('button')).not.toBeInTheDocument()
    expect(within(row('Pía2')).queryByRole('checkbox')).not.toBeInTheDocument()
    setDate('Pía', '2026-10-06')
    fireEvent.click(within(row('Pía')).getByRole('button', { name: 'Cobrar paquete' }))
    expect(await screen.findByText('1 cobro registrado.', { exact: false })).toBeInTheDocument()
    expect(collectPromo).toHaveBeenCalledWith('promo-p', '2026-10-06', null, null, null)
    expect(markMonthPaid).not.toHaveBeenCalled()
  })

  test('un admin cobra cuotas pero no paquetes ni su reversión', async () => {
    mockRole = 'admin'
    await renderSection()
    expect(within(row('Pía')).queryByRole('button', { name: 'Cobrar paquete' })).not.toBeInTheDocument()
    expect(within(row('Ana')).getByRole('button', { name: 'Marcar cobrado' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cobrados' }))
    expect(within(row('Zoe')).queryByRole('button', { name: 'Revertir' })).not.toBeInTheDocument()
    expect(within(row('Ximena')).getByRole('button', { name: 'Revertir' })).toBeInTheDocument()
  })

  test('selección + hoja de cobro: una misma fecha y la nota para todos', async () => {
    await renderSection()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar a Ana Test' }))
    fireEvent.click(row('Beto'))
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cobro (2)' }))
    const sheet = screen.getByRole('dialog', { name: 'Registrar cobro' })
    const date = within(sheet).getByLabelText(/Fecha del depósito/)
    // La fecha propuesta es hoy (dentro de la ventana); se cambia por la real
    expect(date).toHaveValue('2026-10-30')
    fireEvent.change(date, { target: { value: '2026-10-08' } })
    fireEvent.change(within(sheet).getByLabelText(/Nota/), { target: { value: 'efectivo' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Registrar cobro' }))
    expect(await screen.findByText('2 cobros registrados.', { exact: false })).toBeInTheDocument()
    expect(markMonthPaid).toHaveBeenCalledWith('a', 2026, 9, null, null, 'efectivo', '2026-10-08')
    expect(markMonthPaid).toHaveBeenCalledWith('b', 2026, 9, null, null, 'efectivo', '2026-10-08')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('la hoja no registra sin fecha válida', async () => {
    await renderSection()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar a Ana Test' }))
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cobro (1)' }))
    const sheet = screen.getByRole('dialog', { name: 'Registrar cobro' })
    fireEvent.change(within(sheet).getByLabelText(/Fecha del depósito/), { target: { value: '2025-10-08' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Registrar cobro' }))
    expect(within(sheet).getByRole('alert')).toHaveTextContent('fuera del rango')
    fireEvent.change(within(sheet).getByLabelText(/Fecha del depósito/), { target: { value: '' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Registrar cobro' }))
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Poné la fecha')
    expect(markMonthPaid).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Registrar cobro' })).toBeInTheDocument()
  })

  test('cambiar de estado limpia la selección', async () => {
    await renderSection()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar a Ana Test' }))
    expect(screen.getByRole('button', { name: 'Registrar cobro (1)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(screen.queryByRole('button', { name: /Registrar cobro/ })).not.toBeInTheDocument()
  })

  test('un cobro que falla se informa con su nombre, queda marcado en la fila y conserva la fecha', async () => {
    markMonthPaid.mockRejectedValueOnce(new Error('Factura no encontrada'))
    await renderSection()
    setDate('Ana', '2026-10-03')
    fireEvent.click(within(row('Ana')).getByRole('button', { name: 'Marcar cobrado' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ana Test: Factura no encontrada')
    expect(within(row('Ana')).getByText('no se registró')).toBeInTheDocument()
    expect(dateInput('Ana')).toHaveValue('2026-10-03')
    // Se recarga igual: el fallo puede venir de un padrón viejo
    await waitFor(() => expect(loadPadron).toHaveBeenCalledTimes(2))
  })

  test('si otra persona ya lo cobró, no lo pisa', async () => {
    getMonthPaymentStates.mockResolvedValue(new Map([...LIVE, ['a', { ...LIVE.get('a'), payment_status: 'paid' }]]))
    await renderSection()
    setDate('Ana', '2026-10-03')
    fireEvent.click(within(row('Ana')).getByRole('button', { name: 'Marcar cobrado' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya figura cobrado')
    expect(markMonthPaid).not.toHaveBeenCalled()
  })

  test('las fechas de la hoja quedan cargadas en las filas que fallan', async () => {
    markMonthPaid.mockImplementation(async id => { if (id === 'b') throw new Error('se cayó') })
    await renderSection()
    fireEvent.click(row('Ana'))
    fireEvent.click(row('Beto'))
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cobro (2)' }))
    const sheet = screen.getByRole('dialog', { name: 'Registrar cobro' })
    fireEvent.change(within(sheet).getByLabelText(/Fecha del depósito/), { target: { value: '2026-10-08' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Registrar cobro' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Beto Test: se cayó')
    expect(dateInput('Beto')).toHaveValue('2026-10-08')
  })

  test('revertir pide confirmación, recarga, y lo facturado no se revierte', async () => {
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Cobrados' }))
    expect(within(row('Yamila')).queryByRole('button', { name: 'Revertir' })).not.toBeInTheDocument()
    expect(within(row('Yamila')).getByText('facturada')).toHaveAttribute('title', expect.stringMatching(/anularla/))

    fireEvent.click(within(row('Ximena')).getByRole('button', { name: 'Revertir' }))
    const sheet = screen.getByRole('dialog', { name: 'Revertir el cobro' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Revertir' }))
    expect(await screen.findByText('Se revirtió el cobro de Ximena Test.', { exact: false })).toBeInTheDocument()
    expect(unmarkMonthPaid).toHaveBeenCalledWith('x', 2026, 9)
    await waitFor(() => expect(loadPadron).toHaveBeenCalledTimes(2))
  })

  test('revertir el ancla deshace el paquete; si falla, se informa', async () => {
    uncollectPromo.mockRejectedValueOnce(new Error('Hay meses ya facturados a DGI'))
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Cobrados' }))
    fireEvent.click(within(row('Zoe')).getByRole('button', { name: 'Revertir' }))
    const sheet = screen.getByRole('dialog', { name: 'Deshacer el cobro del paquete' })
    expect(sheet).toHaveTextContent('La promo sigue pactada')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Revertir' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Zoe Test: Hay meses ya facturados a DGI')
    expect(uncollectPromo).toHaveBeenCalledWith('promo-z')
    expect(unmarkMonthPaid).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('cambiar de mes limpia fechas, selección y avisos', async () => {
    const { rerender } = await renderSection()
    setDate('Ana', '2026-10-03')
    fireEvent.click(row('Beto'))
    expect(screen.getByText(/con fecha cargada/)).toBeInTheDocument()
    loadPadron.mockResolvedValueOnce(padron(PANEL, 8)).mockResolvedValueOnce(ROWS)
    rerender(tree(8))
    await screen.findByRole('table')
    rerender(tree(9))
    await screen.findByRole('table')
    expect(screen.queryByText(/con fecha cargada/)).not.toBeInTheDocument()
    expect(dateInput('Ana')).toHaveValue('')
    expect(screen.queryByRole('button', { name: /Registrar cobro/ })).not.toBeInTheDocument()
  })

  test('Facturación sigue de solo lectura', async () => {
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Facturación' }))
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(within(screen.getByRole('table')).queryAllByRole('button')).toEqual([])
    expect(within(screen.getByRole('table')).queryAllByRole('checkbox')).toEqual([])
  })
})
