import { render, screen, fireEvent } from '@testing-library/react'
import Tooltip from './Tooltip'

// jsdom no hace layout: getBoundingClientRect devuelve ceros para todo. Se
// mockea por elemento para simular el caso real — el wrapper display:contents
// SIN caja (todo en cero) y el chip con su caja de verdad.
const CHIP_RECT = { left: 1400, top: 260, right: 1520, bottom: 280, width: 120, height: 20, x: 1400, y: 260 }
const ZERO_RECT = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }

function renderTooltip({ chipRect = CHIP_RECT, ...props } = {}) {
  const utils = render(
    <Tooltip title="Falta justificada (+1 recupero)" detail="Vacaciones" {...props}>
      <div data-testid="chip">Lina Casella</div>
    </Tooltip>
  )
  const chip = screen.getByTestId('chip')
  chip.getBoundingClientRect = () => ({ ...chipRect, toJSON: () => {} })
  // El wrapper display:contents no genera caja.
  chip.parentElement.getBoundingClientRect = () => ({ ...ZERO_RECT, toJSON: () => {} })
  return { ...utils, chip }
}

const tooltipEl = () => screen.queryByRole('tooltip')

describe('Tooltip', () => {
  beforeEach(() => { window.innerWidth = 2000 })

  test('no se muestra hasta que hay hover', () => {
    renderTooltip()
    expect(tooltipEl()).not.toBeInTheDocument()
  })

  test('se posiciona sobre el chip, no en la esquina de la pantalla', () => {
    const { chip } = renderTooltip()
    fireEvent.mouseEnter(chip.parentElement)
    // Centro horizontal del chip (1400 + 120/2) y justo debajo (280 + 6).
    expect(tooltipEl()).toHaveStyle({ left: '1460px', top: '286px' })
  })

  test('clampea contra el borde derecho de la ventana', () => {
    window.innerWidth = 1000
    const { chip } = renderTooltip()
    fireEvent.mouseEnter(chip.parentElement)
    // 1460 se pasaría: se limita a innerWidth - mitad del ancho máximo - 8.
    expect(tooltipEl()).toHaveStyle({ left: '872px' })
  })

  test('clampea contra el borde izquierdo de la ventana', () => {
    const { chip } = renderTooltip({ chipRect: { ...CHIP_RECT, left: 0, right: 40, width: 40 } })
    fireEvent.mouseEnter(chip.parentElement)
    expect(tooltipEl()).toHaveStyle({ left: '128px' })
  })

  test('muestra título y detalle', () => {
    const { chip } = renderTooltip()
    fireEvent.mouseEnter(chip.parentElement)
    expect(tooltipEl()).toHaveTextContent('Falta justificada (+1 recupero)')
    expect(tooltipEl()).toHaveTextContent('Vacaciones')
  })

  test('sin detalle muestra solo el título', () => {
    const { chip } = renderTooltip({ detail: null })
    fireEvent.mouseEnter(chip.parentElement)
    expect(tooltipEl()).toHaveTextContent('Falta justificada (+1 recupero)')
  })

  test('se oculta al salir el mouse', () => {
    const { chip } = renderTooltip()
    fireEvent.mouseEnter(chip.parentElement)
    fireEvent.mouseLeave(chip.parentElement)
    expect(tooltipEl()).not.toBeInTheDocument()
  })

  test('sin título no envuelve ni muestra nada en hover', () => {
    render(<Tooltip title=""><div data-testid="chip">Lina Casella</div></Tooltip>)
    fireEvent.mouseEnter(screen.getByTestId('chip'))
    expect(tooltipEl()).not.toBeInTheDocument()
  })
})
