import { mergeDocs, docProblems, buildDoc, FALLBACK_DOC, MISSING_DOC } from './validate'

const ok = {
  title: 'Resultado del mes',
  what: 'Ingresos menos gastos.',
  rows: [
    { label: 'Ingresos', value: 1000 },
    { label: 'Gastos', value: -400, op: '−' },
    { label: 'Del total, prepagos', value: 200, info: true }
  ],
  total: { label: 'Resultado', value: 600 },
  source: 'Padrón.'
}

describe('mergeDocs', () => {
  test('junta los módulos y rechaza ids repetidos', () => {
    const a = { x: () => ok }
    expect(Object.keys(mergeDocs({ a, b: { y: () => ok } }))).toEqual(['x', 'y'])
    expect(() => mergeDocs({ a, b: { x: () => ok } })).toThrow(/duplicada: "x"/)
    expect(() => mergeDocs({ a: { z: 'no' } })).toThrow(/no es una función/)
  })
})

describe('buildDoc', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => console.error.mockRestore())

  test('id inexistente o explicación rota → ficha de aviso, nunca una "i" muda', () => {
    expect(buildDoc({}, 'nada', {})).toBe(MISSING_DOC)
    expect(buildDoc({ r: () => { throw new Error('x') } }, 'r', {})).toBe(FALLBACK_DOC)
  })
})

describe('docProblems', () => {
  test('una explicación correcta no tiene problemas (las filas info no suman)', () => {
    expect(docProblems(ok)).toEqual([])
  })

  test('detecta campos faltantes, op inválido y filas sin valor', () => {
    const bad = { title: '', what: 'x', rows: [{ label: 'a', op: '*' }, { value: 1 }], source: 'y' }
    expect(docProblems(bad)).toEqual(expect.arrayContaining([
      'falta title',
      'fila 1: op "*" no válido',
      'fila 1: sin valor con los datos completos',
      'fila 2: sin label'
    ]))
  })

  test('las filas tienen que sumar el total (±1 peso)', () => {
    const off = { ...ok, total: { label: 'Resultado', value: 700 } }
    expect(docProblems(off)).toEqual(['las filas suman 600 y el total dice 700'])
    expect(docProblems({ ...ok, total: { label: 'Resultado', value: 601 } })).toEqual([])
    expect(docProblems({ ...off, total: { ...off.total, check: false } })).toEqual([])
  })

  test('un subtotal "=" es un punto de control, no un sumando', () => {
    // Forma de "Falta facturar" de la maqueta: cuotas + promos = a facturar − emitido
    const facturar = {
      ...ok,
      rows: [
        { label: 'Cuotas del mes', value: 1000 },
        { label: 'Paquetes de promo', value: 200, op: '+' },
        { label: 'A facturar', value: 1200, op: '=' },
        { label: 'Ya emitido', value: -700, op: '−' }
      ],
      total: { label: 'Falta emitir', value: 500 }
    }
    expect(docProblems(facturar)).toEqual([])

    const badSubtotal = { ...facturar, rows: facturar.rows.map(r => (r.op === '=' ? { ...r, value: 1300 } : r)), total: { label: 'Falta emitir', value: 600 } }
    expect(docProblems(badSubtotal)).toEqual(['fila 3: el subtotal dice 1300 y las filas de arriba suman 1200'])
    // Con el total en texto, los subtotales se controlan igual
    expect(docProblems({ ...badSubtotal, total: { label: 'Falta emitir', text: 'ver arriba' } }))
      .toEqual(['fila 3: el subtotal dice 1300 y las filas de arriba suman 1200'])
  })

  test('un dato faltante no puede colarse en los textos', () => {
    const leak = { ...ok, what: `Hoy cobraste undefined de ${NaN} clientes.` }
    expect(docProblems(leak, { complete: false })).toEqual(['un dato faltante se ve en el texto: "Hoy cobraste undefined de NaN clientes."'])
  })

  test('el signo del valor tiene que coincidir con el operador', () => {
    const wrong = { ...ok, rows: [{ label: 'Ingresos', value: 1000 }, { label: 'Gastos', value: 400, op: '−' }], total: { label: 'R', value: 1400 } }
    expect(docProblems(wrong)).toEqual(['fila 2: el signo del valor no coincide con "−"'])
  })

  test('× o ÷ exigen apagar el chequeo de suma', () => {
    const product = { ...ok, rows: [{ label: 'Usuarios', value: 50 }, { label: 'Margen', value: 10, op: '×' }], total: { label: 'R', value: 500 } }
    expect(docProblems(product)).toEqual(['usa × o ÷: el total no es una suma, marcar total.check = false'])
    expect(docProblems({ ...product, total: { ...product.total, check: false } })).toEqual([])
  })

  test('con datos parciales alcanza con la forma', () => {
    const partial = { ...ok, rows: [{ label: 'Ingresos', value: undefined }], total: { label: 'R', value: NaN } }
    expect(docProblems(partial, { complete: false })).toEqual([])
    expect(docProblems(null)).toEqual(['no devuelve un objeto'])
  })
})
