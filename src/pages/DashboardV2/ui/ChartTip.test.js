import { tipLeft } from './ChartTip'

// El globo de 229 px de Tendencia en un gráfico de 309 px (un teléfono de 375 px).
describe('tipLeft — el globo nunca se sale de la caja', () => {
  test('va hacia el centro: a la derecha en la mitad izquierda y al revés', () => {
    expect(tipLeft(40, 100, 600)).toBe(50)
    expect(tipLeft(500, 100, 600)).toBe(390)
  })

  test('si al lado no entra, queda sobre el punto y adentro de la caja', () => {
    // 'ago' en el teléfono: antes terminaba en x = 418 y corría la página
    expect(tipLeft(140, 229, 309)).toBeCloseTo(140 - 229 / 2)
    for (const anchor of [0, 60, 154, 250, 309]) {
      const left = tipLeft(anchor, 229, 309)
      expect(left).toBeGreaterThanOrEqual(0)
      expect(left + 229).toBeLessThanOrEqual(309)
    }
    // Más ancho que la caja: arranca en el borde
    expect(tipLeft(100, 400, 309)).toBe(0)
  })
})
