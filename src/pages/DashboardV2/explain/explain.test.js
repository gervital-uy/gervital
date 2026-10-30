import { render, screen, fireEvent } from '@testing-library/react'
import { ExplainProvider } from './ExplainContext'
import InfoButton from './InfoButton'
import { formulaValueText } from './FormulaRow'
import { MINUS, DASH } from '../format'

const DOCS = {
  resultado: ({ ingresos, gastos }) => ({
    title: 'Resultado del mes',
    unit: ['sin IVA'],
    what: 'Ingresos menos gastos.',
    rows: [
      { label: 'Ingresos', value: ingresos },
      { label: 'Gastos', value: gastos == null ? undefined : -gastos, op: '−' }
    ],
    total: { label: 'Resultado', value: ingresos - gastos },
    source: 'Padrón del mes.',
    caveat: 'Antes de impuestos.'
  }),
  roto: () => { throw new Error('dato faltante') }
}

const renderWith = (ctx, id = 'resultado') => render(
  <ExplainProvider ctx={ctx} docs={DOCS}>
    <span>Resultado</span>
    <InfoButton id={id} />
  </ExplainProvider>
)

describe('formulaValueText', () => {
  test('con op "−" muestra la magnitud; sin op, el signo', () => {
    expect(formulaValueText({ value: -500, op: '−' })).toBe('$\u00a0500')
    expect(formulaValueText({ value: -20000 })).toBe(`${MINUS}$\u00a020.000`)
    expect(formulaValueText({ value: 300, op: '+' })).toBe('$\u00a0300')
  })

  test('un dato que falta es "—" y text gana', () => {
    expect(formulaValueText({ value: undefined })).toBe(DASH)
    expect(formulaValueText({ value: null, op: '−' })).toBe(DASH)
    expect(formulaValueText({ value: 1, text: '88,7%' })).toBe('88,7%')
  })
})

describe('ExplainProvider + InfoButton', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => console.error.mockRestore())

  test('sin datos la "i" está desactivada', () => {
    renderWith(null)
    expect(screen.getByRole('button', { name: 'Cómo se calcula' })).toBeDisabled()
  })

  test('abre la ficha del mes y cierra con Escape', () => {
    renderWith({ ingresos: 100000, gastos: 120000, monthLabel: 'octubre 2026' })
    fireEvent.click(screen.getByRole('button', { name: 'Cómo se calcula' }))
    const dialog = screen.getByRole('dialog', { name: 'Resultado del mes' })
    expect(dialog).toHaveTextContent('octubre 2026')
    expect(dialog).toHaveTextContent('Cómo se compone')
    expect(dialog).toHaveTextContent('Ojo con esto')
    // El total negativo se ve negativo (la maqueta lo mostraba en positivo)
    expect(dialog).toHaveTextContent(`${MINUS}$ 20.000`)
    expect(dialog).not.toHaveTextContent('maqueta')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('una fila sin dato se ve como "—", no como $ 0', () => {
    renderWith({ ingresos: 100000, gastos: undefined })
    fireEvent.click(screen.getByRole('button', { name: 'Cómo se calcula' }))
    // La fila es el contenedor de su etiqueta: ahí tiene que estar el '—'
    // eslint-disable-next-line testing-library/no-node-access
    const row = screen.getByText('Gastos').closest('div')
    expect(row).toHaveTextContent(`Gastos${DASH}`)
    expect(row).not.toHaveTextContent('$')
  })

  test('una "i" con un id que no existe avisa en vez de no hacer nada', () => {
    renderWith({ ingresos: 1 }, 'inexistente')
    fireEvent.click(screen.getByRole('button', { name: 'Cómo se calcula' }))
    expect(screen.getByRole('dialog', { name: 'Explicación no encontrada' })).toBeInTheDocument()
  })

  test('si la explicación se rompe, avisa en vez de no hacer nada', () => {
    renderWith({ ingresos: 1 }, 'roto')
    fireEvent.click(screen.getByRole('button', { name: 'Cómo se calcula' }))
    expect(screen.getByRole('dialog', { name: 'Explicación no disponible' })).toBeInTheDocument()
  })

  test('si los datos se recargan, la ficha abierta se cierra y no vuelve sola', () => {
    const ctx = { ingresos: 100000, gastos: 50000 }
    const { rerender } = renderWith(ctx)
    fireEvent.click(screen.getByRole('button', { name: 'Cómo se calcula' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    const tree = c => (
      <ExplainProvider ctx={c} docs={DOCS}>
        <InfoButton id="resultado" />
      </ExplainProvider>
    )
    rerender(tree(null))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(tree({ ingresos: 1, gastos: 1 }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
