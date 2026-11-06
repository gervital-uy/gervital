import { StrictMode } from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import CfpSection from './CfpSection'
import { MonthDataProvider } from '../../useMonthData'
import { buildPadron } from '../../../../services/dashboardV2/padron'
import { calculateMonthBilling } from '../../../../services/invoices/invoiceService'
import { emitInvoice } from '../../../../services/biller/billerService'
import { STALE_ISSUED } from '../../../../services/dashboardV2/invoicing'

jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>
}), { virtual: true })
// El bloque de promociones carga sus fuentes aparte: acá no es lo que se prueba.
jest.mock('../../../../services/dashboardV2/benefitsQueries', () => ({ loadBenefitSources: () => new Promise(() => {}) }))
jest.mock('../../../../services/dashboardV2/queries', () => ({ loadPadron: jest.fn(), getMonthPaymentStates: jest.fn() }))
jest.mock('../../../../services/invoices/invoiceService', () => ({ markMonthPaid: jest.fn(), unmarkMonthPaid: jest.fn(), calculateMonthBilling: jest.fn() }))
jest.mock('../../../../services/promotions/promotionService', () => ({ collectPromo: jest.fn(), uncollectPromo: jest.fn() }))
jest.mock('../../../../services/biller/billerService', () => ({ emitInvoice: jest.fn() }))
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), todayStr: () => '2026-10-30' }))
let mockRole = 'superadmin'
jest.mock('../../../../context/AuthContext', () => {
  const { roleHasAccess } = jest.requireActual('../../../../context/AuthContext')
  return { useAuth: () => ({ hasAccess: f => roleHasAccess(mockRole, f) }) }
})
const { loadPadron, getMonthPaymentStates } = jest.requireMock('../../../../services/dashboardV2/queries')

// Octubre 2026 (la factura sale con fecha del viernes 30, último día hábil):
//   x: cuota cobrada sin factura · z: ancla cobrada por el paquete (60.000; su servicio es 20.000)
//   w: mes 2 de la promo de z, cubierto · y: facturada · a: sin cobrar · n: cobrada, sin CI
const PROMO = { promo_id: 'promo-z', promo_total: 3, promo_percent: 10, promo_total_amount: 60000, attendance_gross: 20000, transport_gross: 0 }
const PANEL = [
  { client_id: 'x', attendance_gross: 15000, transport_gross: 0, payment_status: 'paid', paid_amount: 15000, paid_date: '2026-10-04', invoice_status: 'pending' },
  { client_id: 'z', ...PROMO, promo_index: 1, payment_status: 'paid', paid_amount: 60000, paid_date: '2026-10-02', invoice_status: 'pending' },
  { client_id: 'w', ...PROMO, promo_index: 2, payment_status: 'prepaid', paid_amount: 0, invoice_status: 'pending' },
  { client_id: 'y', attendance_gross: 15000, transport_gross: 0, payment_status: 'paid', paid_amount: 15000, paid_date: '2026-10-04', invoice_status: 'invoiced', invoiced_amount: 15000, invoice_number: 'A-3600', invoice_date: '2026-10-30' },
  { client_id: 'a', attendance_gross: 30000, transport_gross: 0, payment_status: 'pending', invoice_status: 'pending' },
  { client_id: 'n', attendance_gross: 15000, transport_gross: 0, payment_status: 'paid', paid_amount: 15000, paid_date: '2026-10-04', invoice_status: 'pending' }
]
const NAMES = { x: 'Ximena', z: 'Zoe', w: 'Walter', y: 'Yamila', a: 'Ana', n: 'Nora' }
const padron = (panel, month = 9) => buildPadron({
  panel,
  clients: Object.entries(NAMES).map(([id, firstName]) => ({
    id, firstName, lastName: 'Test', documentNumber: id === 'n' ? null : '12345678', email: 'x@y.com', address: { street: 'Calle 1' }, startDate: '2026-07-01', inactivityPeriods: []
  })),
  breakdown: panel.map(p => ({ clientId: p.client_id, frequency: 2, schedule: 'afternoon', hasTransport: false }))
}, { year: 2026, month, today: '2026-10-30' })
const ROWS = padron(PANEL)
const LIVE = new Map(PANEL.map(p => [p.client_id, {
  client_id: p.client_id, payment_status: p.payment_status, invoice_status: p.invoice_status,
  promo_id: p.promo_id || null, paid_amount: p.paid_amount ?? null, biller_id: p.invoice_status === 'invoiced' ? 1 : null
}]))
const BILLING = Object.fromEntries(PANEL.map(p => [p.client_id, {
  attendanceChargeableGross: p.attendance_gross, transportChargeableGross: p.transport_gross, hasTransport: false, discountPercent: p.promo_id ? 10 : 0
}]))
const issuedIn = ids => padron(PANEL.map(p => (ids.includes(p.client_id) ? { ...p, invoice_status: 'invoiced', invoiced_amount: 20000, invoice_number: 'A-3700', invoice_date: '2026-10-30' } : p)))

const renderSection = async (month = 9, { strict = false } = {}) => {
  const tree = <MonthDataProvider><CfpSection selected={{ year: 2026, month }} /></MonthDataProvider>
  const utils = render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  await screen.findByRole('table')
  fireEvent.click(screen.getByRole('button', { name: 'Facturación' }))
  fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
  return utils
}
const row = name => screen.getByRole('row', { name: new RegExp(`${name} Test`) })
const ISSUED_ARGS = id => [id, 2026, 9, {
  attendanceAmount: BILLING[id].attendanceChargeableGross,
  attendanceConcepto: `Plan 2 días x semana – Tarde${BILLING[id].discountPercent ? ' (10% dto)' : ''}`,
  fechaEmision: '2026-10-30',
  fechaVencimiento: '2026-10-30'
}]

describe('Gestión CFP: emisión de facturas', () => {
  beforeEach(() => {
    mockRole = 'superadmin'
    loadPadron.mockReset().mockResolvedValue(ROWS)
    getMonthPaymentStates.mockReset().mockImplementation((y, m, ids) => Promise.resolve(new Map(ids.map(id => [id, LIVE.get(id)]))))
    calculateMonthBilling.mockReset().mockImplementation(id => Promise.resolve(BILLING[id]))
    emitInvoice.mockReset().mockResolvedValue({ ok: true, serie: 'A', numero: '3700' })
  })

  test('cada fila dice qué se puede hacer, y el ancla factura su servicio', async () => {
    await renderSection()
    expect(within(row('Ximena')).getByRole('button', { name: 'Emitir' })).toBeEnabled()
    expect(within(row('Zoe')).getByRole('button', { name: 'Emitir' })).toBeEnabled()
    expect(within(row('Zoe')).getByText('$ 20.000')).toBeInTheDocument()
    expect(within(row('Walter')).getByRole('button', { name: 'Emitir' })).toBeEnabled()
    expect(within(row('Yamila')).getByText('emitida')).toBeInTheDocument()
    expect(within(row('Ana')).getByText('falta cobrar')).toBeInTheDocument()
    expect(within(row('Nora')).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emitir todas las facturas (3)' })).toBeEnabled()
    expect(screen.getByText('Con fecha 30 oct 2026, último día hábil del mes')).toBeInTheDocument()
  })

  test('emitir una: la hoja muestra lo que se imprime y sale por el servicio del mes', async () => {
    loadPadron.mockResolvedValueOnce(ROWS).mockResolvedValueOnce(issuedIn(['z']))
    await renderSection()
    fireEvent.click(within(row('Zoe')).getByRole('button', { name: 'Emitir' }))
    const sheet = screen.getByRole('dialog', { name: 'Emitir la factura' })
    expect(within(sheet).getByText('Plan 2 días x semana – Tarde (10% dto)')).toBeInTheDocument()
    expect(within(sheet).getByText('viernes 30 de octubre de 2026')).toBeInTheDocument()
    expect(within(sheet).getByText(/no el paquete de \$ 60\.000/)).toBeInTheDocument()
    expect(within(sheet).getByText('12345678')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Emitir factura' }))
    expect(await screen.findByText('1 factura emitida en Biller.', { exact: false })).toBeInTheDocument()
    expect(emitInvoice).toHaveBeenCalledWith(...ISSUED_ARGS('z'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(within(row('Zoe')).getByText('emitida')).toBeInTheDocument())
  })

  test('si en la base ya cambió, no llega a Biller y la fila lo dice', async () => {
    getMonthPaymentStates.mockResolvedValue(new Map([['x', { ...LIVE.get('x'), invoice_status: 'invoiced', biller_id: 9 }]]))
    await renderSection()
    fireEvent.click(within(row('Ximena')).getByRole('button', { name: 'Emitir' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Emitir factura' }))
    expect(await screen.findByText('1 factura no se emitió:', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(STALE_ISSUED)
    expect(emitInvoice).not.toHaveBeenCalled()
    expect(within(row('Ximena')).getByText('no se emitió')).toBeInTheDocument()
  })

  test('el lote del mes emite de a una y en orden; lo rechazado se reintenta', async () => {
    emitInvoice.mockRejectedValueOnce(Object.assign(new Error('Biller rechazó la emisión (HTTP 422)'), { detail: 'documento inválido' }))
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Emitir todas las facturas (3)' }))
    const sheet = screen.getByRole('dialog', { name: 'Facturar octubre 2026' })
    expect(within(sheet).getByText('3 facturas listas para emitir')).toBeInTheDocument()
    expect(within(sheet).getByText(/Quedan afuera 2 facturas/)).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Emitir 3 facturas' }))
    expect(await within(sheet).findByText('2 facturas emitidas · 1 rechazada', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(emitInvoice.mock.calls.map(c => c[0])).toEqual(['x', 'z', 'w'])
    expect(within(sheet).getByText('Biller rechazó la emisión (HTTP 422): documento inválido')).toBeInTheDocument()
    // El aviso de la página espera a que se cierre el lote: no le saca el foco
    expect(screen.queryByText(/en Biller\./)).not.toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reintentar 1' }))
    await waitFor(() => expect(emitInvoice).toHaveBeenCalledTimes(4))
    expect(emitInvoice).toHaveBeenLastCalledWith(...ISSUED_ARGS('x'))
    // El resultado es el de toda la sesión, reintento incluido
    expect(await within(sheet).findByText('3 facturas emitidas')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('3 facturas emitidas en Biller.', { exact: false })).toBeInTheDocument()
  }, 15000)

  test('lo que cambió desde que se abrió el lote no se reintenta', async () => {
    getMonthPaymentStates.mockImplementation((y, m, ids) => Promise.resolve(new Map(ids.map(id => [id, id === 'x' ? { ...LIVE.get(id), invoice_status: 'invoiced', biller_id: 7 } : LIVE.get(id)]))))
    await renderSection()
    fireEvent.click(within(row('Ximena')).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Emitir facturas (1)' }))
    const sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Emitir 1 factura' }))
    expect(await within(sheet).findByText('0 facturas emitidas · 1 sin emitir porque cambió')).toBeInTheDocument()
    expect(within(sheet).getByText('no se emitió')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
    expect(emitInvoice).not.toHaveBeenCalled()
  })

  test('en StrictMode (desarrollo) el lote avanza y termina', async () => {
    await renderSection(9, { strict: true })
    fireEvent.click(within(row('Ximena')).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Emitir facturas (1)' }))
    const sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Emitir 1 factura' }))
    expect(await within(sheet).findByText('1 factura emitida')).toBeInTheDocument()
    expect(within(sheet).getByText('emitida')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Cerrar' })).toBeEnabled()
  })

  test('un cobro con corrección pendiente no se ofrece para emitir', async () => {
    loadPadron.mockResolvedValue(buildPadron({
      panel: PANEL,
      clients: Object.entries(NAMES).map(([id, firstName]) => ({ id, firstName, lastName: 'Test', documentNumber: '1', email: 'x@y.com', address: { street: 's' }, startDate: '2026-07-01', inactivityPeriods: [] })),
      breakdown: PANEL.map(p => ({ clientId: p.client_id, frequency: 2, schedule: 'afternoon', hasTransport: false })),
      invoices: [{ clientId: 'x', correctionPending: true }]
    }, { year: 2026, month: 9, today: '2026-10-30' }))
    await renderSection()
    expect(within(row('Ximena')).queryByRole('button', { name: 'Emitir' })).not.toBeInTheDocument()
    expect(within(row('Ximena')).getByText('corrección pendiente')).toBeInTheDocument()
  })

  test('mientras emite el lote, no se cierra ni se toca la tabla', async () => {
    let release
    emitInvoice.mockReturnValueOnce(new Promise(res => { release = res }))
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Emitir todas las facturas (3)' }))
    const sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Incluir a Zoe Test' }))
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Incluir a Walter Test' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Emitir 1 factura' }))
    await waitFor(() => expect(emitInvoice).toHaveBeenCalledTimes(1))
    expect(within(sheet).queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Detener después de esta' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    release({ ok: true, serie: 'A', numero: '1' })
    expect(await within(sheet).findByText('1 factura emitida')).toBeInTheDocument()
  })

  test('la selección abre el lote solo con las elegidas', async () => {
    await renderSection()
    fireEvent.click(within(row('Ximena')).getByRole('checkbox'))
    fireEvent.click(row('Walter'))
    fireEvent.click(screen.getByRole('button', { name: 'Emitir facturas (2)' }))
    const sheet = screen.getByRole('dialog', { name: 'Facturar octubre 2026' })
    expect(within(sheet).getByText('2 facturas listas para emitir')).toBeInTheDocument()
    expect(within(sheet).queryByText(/Quedan afuera/)).not.toBeInTheDocument()
    expect(within(sheet).queryByText('Zoe Test')).not.toBeInTheDocument()
  })

  test('antes del último día hábil del mes no se emite', async () => {
    loadPadron.mockResolvedValue(padron(PANEL, 10))
    await renderSection(10)
    expect(screen.getByRole('button', { name: 'Emitir todas las facturas (3)' })).toBeDisabled()
    expect(screen.getByText('Se emiten desde el 30 nov 2026, último día hábil del mes')).toBeInTheDocument()
    const button = within(row('Ximena')).getByRole('button', { name: 'Emitir' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringMatching(/desde el 30 nov 2026/))
    expect(within(row('Ximena')).queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
