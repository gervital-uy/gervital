import { render, screen } from '@testing-library/react'
import BreakdownBars from './BreakdownBars'

const rows = [
  { label: '1×', value: 5, color: '#000' },
  { label: '3×', value: 20, color: '#111' },
  { label: '2×', value: 15, color: '#222' }
]

const labels = () => screen.getAllByText(/^\d×$/).map(el => el.textContent)

describe('BreakdownBars', () => {
  test('ordena por tamaño salvo que la dimensión sea ordinal', () => {
    const { unmount } = render(<BreakdownBars rows={rows} />)
    expect(labels()).toEqual(['3×', '2×', '1×'])
    unmount()
    render(<BreakdownBars rows={rows} conservarOrden />)
    expect(labels()).toEqual(['1×', '3×', '2×'])
  })

  test('muestra la participación y los pp con coma', () => {
    render(<BreakdownBars rows={[{ label: 'Tier C', value: 30, pp: 5.5, color: '#000' }, { label: 'Tier A', value: 10, color: '#111' }]} />)
    expect(screen.getByText('75% del total')).toBeInTheDocument()
    expect(screen.getByText(/5,5 pp/)).toBeInTheDocument()
  })

  test('sin filas o con todo en cero no se rompe ni muestra NaN', () => {
    const { container } = render(<BreakdownBars rows={[{ label: 'x', value: 0, color: '#000' }, { label: 'y', value: undefined }]} />)
    expect(container).not.toHaveTextContent('NaN')
    expect(screen.queryByText('y')).not.toBeInTheDocument()
  })
})
