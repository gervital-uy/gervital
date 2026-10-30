import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import Sheet from './Sheet'

function Harness({ initiallyOpen = false, onClose }) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>abrir</button>
      <Sheet open={open} onClose={() => { onClose?.(); setOpen(false) }} label="Hoja de prueba">
        <button type="button">primero</button>
        <button type="button">último</button>
      </Sheet>
    </>
  )
}

describe('Sheet', () => {
  afterEach(() => { document.body.style.overflow = '' })

  test('cerrada no renderiza nada ni escucha Escape', () => {
    const onClose = jest.fn()
    render(<Sheet open={false} onClose={onClose} label="x"><p>contenido</p></Sheet>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  test('abierta es un dialog modal con nombre y el foco entra', () => {
    render(<Harness initiallyOpen />)
    const dialog = screen.getByRole('dialog', { name: 'Hoja de prueba' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('primero')).toHaveFocus()
  })

  test('Escape y el fondo cierran; el foco vuelve al botón que la abrió', () => {
    const onClose = jest.fn()
    render(<Harness onClose={onClose} />)
    const opener = screen.getByText('abrir')
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()

    fireEvent.click(opener)
    // El fondo no tiene rol accesible a propósito (aria-hidden): no hay otra forma de tomarlo.
    // eslint-disable-next-line testing-library/no-node-access
    fireEvent.click(document.querySelector('[aria-hidden="true"]'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('bloquea el scroll del fondo y restaura el valor anterior', () => {
    document.body.style.overflow = 'scroll'
    render(<Harness />)
    fireEvent.click(screen.getByText('abrir'))
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.style.overflow).toBe('scroll')
  })

  test('Tab no se escapa de la hoja', () => {
    render(<Harness initiallyOpen />)
    const first = screen.getByText('primero')
    const last = screen.getByText('último')
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  test('con dos hojas abiertas, Escape cierra solo la de arriba', () => {
    const closeBottom = jest.fn()
    const closeTop = jest.fn()
    render(
      <>
        <Sheet open onClose={closeBottom} label="abajo"><button type="button">a</button></Sheet>
        <Sheet open onClose={closeTop} label="arriba"><button type="button">b</button></Sheet>
      </>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeTop).toHaveBeenCalledTimes(1)
    expect(closeBottom).not.toHaveBeenCalled()
  })
})
