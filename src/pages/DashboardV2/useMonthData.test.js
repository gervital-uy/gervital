import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MonthDataProvider, useMonthData, useInvalidateMonthData } from './useMonthData'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function Consumer({ loader, selected, label = 'c' }) {
  const state = useMonthData('padron', loader, selected)
  return (
    <div data-testid={label}>
      {state.status}
      {state.data != null && `:${state.data}`}
      {state.refreshing && ':refreshing'}
      {state.status === 'error' && <button type="button" onClick={state.reload}>reintentar {label}</button>}
    </div>
  )
}

// Deja correr las promesas pendientes (loaders ya resueltos) y los renders que disparan.
const flush = () => act(() => Promise.resolve())

describe('useMonthData', () => {
  test('pasa de loading a ready con los datos del mes', async () => {
    const loader = jest.fn(async ({ year, month }) => `${year}-${month}`)
    render(<Consumer loader={loader} selected={{ year: 2026, month: 9 }} />)
    expect(screen.getByTestId('c')).toHaveTextContent('loading')
    await flush()
    expect(screen.getByTestId('c')).toHaveTextContent('ready:2026-9')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  test('con provider, dos pestañas comparten la carga: un solo pedido', async () => {
    const loader = jest.fn(async () => 'x')
    const { rerender } = render(
      <MonthDataProvider><Consumer loader={loader} selected={{ year: 2026, month: 9 }} label="a" /></MonthDataProvider>
    )
    await flush()
    // Cambiar de pestaña: la otra se monta y lee del caché sin pasar por loading
    rerender(<MonthDataProvider><Consumer loader={loader} selected={{ year: 2026, month: 9 }} label="b" /></MonthDataProvider>)
    expect(screen.getByTestId('b')).toHaveTextContent('ready:x')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  test('al cambiar de mes nunca muestra los números del mes anterior', async () => {
    const pending = deferred()
    const loader = jest.fn(({ month }) => (month === 9 ? Promise.resolve('oct') : pending.promise))
    const { rerender } = render(<Consumer loader={loader} selected={{ year: 2026, month: 9 }} />)
    await flush()
    expect(screen.getByTestId('c')).toHaveTextContent('ready:oct')

    rerender(<Consumer loader={loader} selected={{ year: 2026, month: 8 }} />)
    expect(screen.getByTestId('c')).toHaveTextContent(/^loading$/)
    await act(async () => pending.resolve('sep'))
    expect(screen.getByTestId('c')).toHaveTextContent('ready:sep')
  })

  test('una respuesta vieja que llega tarde no pisa el mes nuevo', async () => {
    const slow = deferred()
    const loader = jest.fn(({ month }) => (month === 8 ? slow.promise : Promise.resolve('oct')))
    const { rerender } = render(<Consumer loader={loader} selected={{ year: 2026, month: 8 }} />)
    rerender(<Consumer loader={loader} selected={{ year: 2026, month: 9 }} />)
    await flush()
    await act(async () => slow.resolve('sep'))
    expect(screen.getByTestId('c')).toHaveTextContent('ready:oct')
  })

  test('error con reintento', async () => {
    const loader = jest.fn()
      .mockRejectedValueOnce(new Error('se cayó'))
      .mockResolvedValueOnce('ok')
    render(<Consumer loader={loader} selected={{ year: 2026, month: 9 }} />)
    await flush()
    expect(screen.getByTestId('c')).toHaveTextContent('error')
    fireEvent.click(screen.getByText('reintentar c'))
    await flush()
    expect(screen.getByTestId('c')).toHaveTextContent('ready:ok')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  test('invalidar después de escribir recarga sin vaciar la pantalla', async () => {
    const second = deferred()
    const loader = jest.fn()
      .mockResolvedValueOnce('antes')
      .mockReturnValueOnce(second.promise)

    function Page() {
      const invalidate = useInvalidateMonthData()
      const [selected] = useState({ year: 2026, month: 9 })
      return (
        <>
          <Consumer loader={loader} selected={selected} />
          <button type="button" onClick={() => invalidate('padron')}>cobrar</button>
        </>
      )
    }
    render(<MonthDataProvider><Page /></MonthDataProvider>)
    await flush()
    expect(screen.getByTestId('c')).toHaveTextContent('ready:antes')

    fireEvent.click(screen.getByText('cobrar'))
    await flush()
    expect(screen.getByTestId('c')).toHaveTextContent('ready:antes:refreshing')
    await act(async () => second.resolve('después'))
    expect(screen.getByTestId('c')).toHaveTextContent('ready:después')
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
