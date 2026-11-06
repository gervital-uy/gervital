import { deltaView } from './DeltaTag'

// La regla de las variaciones, una sola para Finanzas y Comercial.
const NBSP = String.fromCharCode(160)

describe('deltaView', () => {
  test('sin dato para comparar', () => {
    expect(deltaView(null)).toEqual({ text: '—', tone: 'none', inMoney: false })
    expect(deltaView({ base: 0, diff: null, pct: null }, { unit: 'n' }).tone).toBe('none')
  })

  test('porcentaje, puntos y unidades, con coma y flecha', () => {
    expect(deltaView({ base: 100, diff: 12, pct: 12 })).toMatchObject({ text: '↑12%', tone: 'good' })
    expect(deltaView({ base: 20, diff: -1.5, pct: -1.5 }, { unit: 'pp', invert: true })).toMatchObject({ text: '↓1,5 pp', tone: 'good' })
    expect(deltaView({ base: 48, diff: 2, pct: 4.2 }, { unit: 'n' })).toMatchObject({ text: '↑2', tone: 'good' })
    // Contra un promedio: una baja contra 0,33 de promedio es +0,7 y sube en contra
    expect(deltaView({ base: 0.33, diff: 0.67, pct: 203 }, { unit: 'n', invert: true })).toMatchObject({ text: '↑0,7', tone: 'bad' })
  })

  test('lo que se imprime como cero es "=", sin flecha', () => {
    expect(deltaView({ base: 20, diff: 0.02, pct: 0.02 }, { unit: 'pp' })).toMatchObject({ text: '=', tone: 'flat' })
    expect(deltaView({ base: 100, diff: 0.3, pct: 0.3 })).toMatchObject({ text: '=', tone: 'flat' })
    // 1.340.000 contra 1.341.000: −0,07% no es "↓0%" en rojo
    expect(deltaView({ base: 1341000, diff: -1000, pct: -0.0746 })).toMatchObject({ text: '=', tone: 'flat' })
    expect(deltaView({ base: -5000, diff: 0.4, pct: null })).toMatchObject({ text: '=', tone: 'flat', inMoney: true })
  })

  test('sobre una base en cero va la diferencia en pesos', () => {
    expect(deltaView({ base: 0, diff: 24590, pct: null })).toEqual({ text: `↑$${NBSP}25k`, tone: 'good', inMoney: true })
    expect(deltaView({ base: -9400, diff: -2000, pct: null })).toEqual({ text: `↓$${NBSP}2k`, tone: 'bad', inMoney: true })
  })

  test('un número es un porcentaje; en puntos sin pct va la diferencia', () => {
    expect(deltaView(8.4)).toMatchObject({ text: '↑8%', tone: 'good' })
    expect(deltaView(-3, { invert: true })).toMatchObject({ text: '↓3%', tone: 'good' })
    expect(deltaView({ base: 20, diff: 2.25, pct: null }, { unit: 'pp' })).toMatchObject({ text: '↑2,3 pp' })
  })
})
