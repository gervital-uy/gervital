import { deltaView } from './DeltaTag'

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
  })

  test('sobre una base en cero va la diferencia en pesos', () => {
    expect(deltaView({ base: 0, diff: 24590, pct: null })).toEqual({ text: '↑25k', tone: 'good', inMoney: true })
  })
})
