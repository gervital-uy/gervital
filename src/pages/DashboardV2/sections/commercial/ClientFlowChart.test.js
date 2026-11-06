import { render, screen, fireEvent } from '@testing-library/react'
import ClientFlowChart, { tooltipShift } from './ClientFlowChart'

const row = (key, label, entries, exits, closing) => ({ key, label, entries, exits, returns: 0, closing, partial: false })

describe('globo de Altas vs Bajas', () => {
  test('se abre hacia adentro según dónde cae la columna, no según su número', () => {
    // Con dos columnas, la segunda ya está a la derecha: se abre hacia la izquierda
    expect(tooltipShift(0, 2)).toBe('-8%')
    expect(tooltipShift(1, 2)).toBe('-92%')
    // Una sola columna, centrada
    expect(tooltipShift(0, 1)).toBe('-50%')
    // Doce meses: las puntas hacia adentro, el medio centrado
    expect(tooltipShift(2, 12)).toBe('-8%')
    expect(tooltipShift(4, 12)).toBe('-50%')
    expect(tooltipShift(7, 12)).toBe('-50%')
    expect(tooltipShift(9, 12)).toBe('-92%')
  })

  test('con dos meses, el globo del segundo no se sale por la derecha', () => {
    const { container } = render(<ClientFlowChart rows={[row('2026-5', 'jun', 0, 2, 42), row('2026-6', 'jul', 3, 1, 44)]} showTrend mode="months" />)
    // Las columnas son los grupos con opacidad (los de las referencias van antes)
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container
    fireEvent.mouseEnter(container.querySelectorAll('svg > g[opacity]')[1])
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('jul')
    expect(tip.style.left).toBe('75%')
    expect(tip.style.transform).toBe('translate(-92%, -6px)')
  })
})
