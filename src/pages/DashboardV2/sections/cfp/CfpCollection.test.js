import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import CfpSection from './CfpSection'
import { MonthDataProvider } from '../../useMonthData'
import { buildPadron } from '../../../../services/dashboardV2/padron'
import { markMonthPaid, unmarkMonthPaid } from '../../../../services/invoices/invoiceService'
import { collectPromo, uncollectPromo } from '../../../../services/promotions/promotionService'

jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>
}), { virtual: true })
jest.mock('../../../../services/dashboardV2/queries', () => ({ loadPadron: jest.fn() }))
jest.mock('../../../../services/invoices/invoiceService', () => ({ markMonthPaid: jest.fn(), unmarkMonthPaid: jest.fn() }))
jest.mock('../../../../services/promotions/promotionService', () => ({ collectPromo: jest.fn(), uncollectPromo: jest.fn() }))
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), todayStr: () => '2026-10-30' }))
jest.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ hasAccess: () => true }) }))
const { loadPadron } = jest.requireMock('../../../../services/dashboardV2/queries')

// Octubre 2026:
//   a, b: cuotas pendientes · p: ancla pendiente de una promo de 3 meses (p2 su mes 2)
//   x: cuota cobrada sin factura · y: cuota cobrada y facturada · z: ancla cobrada sin factura
const PROMO = { promo_total: 3, promo_percent: 10, promo_total_amount: 60000, attendance_gross: 20000, transport_gross: 0 }
const panel = [
  { client_id: 'a', attendance_gross: 30000, transport_gross: 0, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'b', attendance_gross: 25000, transport_gross: 0, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'p', ...PROMO, promo_id: 'promo-p', promo_index: 1, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'p2', ...PROMO, promo_id: 'promo-p', promo_index: 2, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'x', attendance_gross: 15000, transport_gross: 0, payment_status: 'paid', paid_amount: 15000, paid_date: '2026-10-04', invoice_status: 'pending' },
  { client_id: 'y', attendance_gross: 15000, transport_gross: 0, payment_status: 'paid', paid_amount: 15000, paid_date: '2026-10-04', invoice_status: 'invoiced', invoiced_amount: 15000 },
  { client_id: 'z', ...PROMO, promo_id: 'promo-z', promo_index: 1, payment_status: 'paid', paid_amount: 60000, paid_date: '2026-10-02', invoice_status: 'pending' }
]
const NAMES = { a: 'Ana', b: 'Beto', p: 'Pía', p2: 'Pía2', x: 'Ximena', y: 'Yamila', z: 'Zoe' }
const clients = Object.entries(NAMES).map(([id, firstName]) => ({
  id, firstName, lastName: 'Test', documentNumber: '1', email: 'x@y.com', address: { street: 's' }, startDate: '2026-07-01', inactivityPeriods: []
}))
const breakdown = panel.map(p => ({ clientId: p.client_id, frequency: 2, schedule: 'afternoon', hasTransport: false }))
const ROWS = buildPadron({ panel, clients, breakdown }, { year: 2026, month: 9, today: '2026-10-30' })

const renderSection = async () => {
  render(<MonthDataProvider><CfpSection selected={{ year: 2026, month: 9 }} /></MonthDataProvider>)
  await screen.findByRole('table')
}
const row = name => screen.getByRole('row', { name: new RegExp(`${name} Test`) })
const setDate = (name, value) => fireEvent.change(screen.getByLabelText(`Fecha de pago de ${name} Test`), { target: { value } })

describe('Gestión CFP: cobros desde la tabla', () => {
  beforeEach(() => {
    loadPadron.mockReset().mockResolvedValue(ROWS)
    markMonthPaid.mockReset().mockResolvedValue({ success: true })
    collectPromo.mockReset().mockResolvedValue({ success: true })
    unmarkMonthPaid.mockReset().mockResolvedValue()
    uncollectPromo.mockReset().mockResolvedValue({ success: true })
  })

  test('cobro por fila: pide la fecha, cobra sin monto y recarga el padrón', async () => {
    await renderSection()
    const button = within(row('Ana')).getByRole('button', { name: 'Marcar cobrado' })
    expect(button).toBeDisabled()
    setDate('Ana', '2026-10-03')
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(await screen.findByText('1 cobro registrado.', { exact: false })).toBeInTheDocument()
    expect(markMonthPaid).toHaveBeenCalledWith('a', 2026, 9, null, null, null, '2026-10-03')
    await waitFor(() => expect(loadPadron).toHaveBeenCalledTimes(2))
  })

  test('una fecha fuera de la ventana no habilita el cobro', async () => {
    await renderSection()
    setDate('Ana', '2026-11-05')
    expect(within(row('Ana')).getByRole('button', { name: 'Marcar cobrado' })).toBeDisabled()
    expect(screen.queryByText(/con fecha cargada/)).not.toBeInTheDocument()
  })

  test('lote preparado: cada fila se registra con su propia fecha', async () => {
    await renderSection()
    setDate('Ana', '2026-10-03')
    setDate('Beto', '2026-09-30')
    expect(screen.getByText('cobros con fecha cargada', { exact: false })).toBeInTheDocument()
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

  test('selección + hoja de cobro: una misma fecha y la nota para todos', async () => {
    await renderSection()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar a Ana Test' }))
    fireEvent.click(row('Beto'))
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cobro (2)' }))
    const sheet = screen.getByRole('dialog', { name: 'Registrar cobro' })
    // La fecha propuesta es hoy (dentro de la ventana); se cambia por la real
    expect(within(sheet).getByLabelText(/Fecha del depósito/)).toHaveValue('2026-10-30')
    fireEvent.change(within(sheet).getByLabelText(/Fecha del depósito/), { target: { value: '2026-10-08' } })
    fireEvent.change(within(sheet).getByLabelText(/Nota/), { target: { value: 'efectivo' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Registrar cobro' }))
    expect(await screen.findByText('2 cobros registrados.', { exact: false })).toBeInTheDocument()
    expect(markMonthPaid).toHaveBeenCalledWith('a', 2026, 9, null, null, 'efectivo', '2026-10-08')
    expect(markMonthPaid).toHaveBeenCalledWith('b', 2026, 9, null, null, 'efectivo', '2026-10-08')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('un cobro que falla se informa con su nombre y conserva la fecha para reintentar', async () => {
    markMonthPaid.mockRejectedValueOnce(new Error('Factura no encontrada'))
    await renderSection()
    setDate('Ana', '2026-10-03')
    fireEvent.click(within(row('Ana')).getByRole('button', { name: 'Marcar cobrado' }))
    expect(await screen.findByText('Factura no encontrada', { exact: false })).toBeInTheDocument()
    expect(screen.getByLabelText('Fecha de pago de Ana Test')).toHaveValue('2026-10-03')
    expect(loadPadron).toHaveBeenCalledTimes(1)
  })

  test('revertir pide confirmación; el ancla deshace el paquete y lo facturado no se revierte', async () => {
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Cobrados' }))
    expect(within(row('Yamila')).queryByRole('button', { name: 'Revertir' })).not.toBeInTheDocument()

    fireEvent.click(within(row('Ximena')).getByRole('button', { name: 'Revertir' }))
    const sheet = screen.getByRole('dialog', { name: 'Revertir el cobro' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Revertir' }))
    expect(await screen.findByText('Se revirtió el cobro de Ximena Test.', { exact: false })).toBeInTheDocument()
    expect(unmarkMonthPaid).toHaveBeenCalledWith('x', 2026, 9)

    fireEvent.click(within(row('Zoe')).getByRole('button', { name: 'Revertir' }))
    const packageSheet = screen.getByRole('dialog', { name: 'Deshacer el cobro del paquete' })
    expect(packageSheet).toHaveTextContent('La promo sigue pactada')
    fireEvent.click(within(packageSheet).getByRole('button', { name: 'Revertir' }))
    await waitFor(() => expect(uncollectPromo).toHaveBeenCalledWith('promo-z'))
    expect(unmarkMonthPaid).toHaveBeenCalledTimes(1)
  })

  test('Facturación sigue de solo lectura', async () => {
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Facturación' }))
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(within(screen.getByRole('table')).queryAllByRole('button')).toEqual([])
    expect(within(screen.getByRole('table')).queryAllByRole('checkbox')).toEqual([])
  })
})
