import { money, coma, pctText, plural, monthLabelOf, formatLongDate, formatShortDate, DASH, MINUS } from './format'

// Intl es-UY separa el $ de los dígitos con un espacio duro (U+00A0).
describe('format v2', () => {
  test('money muestra el signo con el menos tipográfico', () => {
    expect(money(1234)).toBe('$\u00a01.234')
    expect(money(-1234)).toBe(`${MINUS}$\u00a01.234`)
  })

  test('money redondea antes de decidir el signo: nunca "−$ 0"', () => {
    expect(money(-0.4)).toBe('$\u00a00')
    expect(money(-0.6)).toBe(`${MINUS}$\u00a01`)
  })

  test('un dato que falta es "—", nunca $ 0', () => {
    for (const v of [null, undefined, NaN, Infinity, '12']) expect(money(v)).toBe(DASH)
    expect(coma(undefined)).toBe(DASH)
    expect(pctText(null)).toBe(DASH)
  })

  test('coma y porcentaje con coma decimal', () => {
    expect(coma(12.345)).toBe('12,3')
    expect(coma(12.345, 2)).toBe('12,35')
    expect(pctText(88.7)).toBe('88,7%')
    expect(pctText(90, 0)).toBe('90%')
  })

  test('plural y nombre del mes (0-indexed)', () => {
    expect(plural(1, 'cliente', 'clientes')).toBe('1 cliente')
    expect(plural(0, 'cliente', 'clientes')).toBe('0 clientes')
    expect(monthLabelOf(2026, 9)).toBe('octubre 2026')
  })

  test('fechas sin correrse de día por la zona horaria', () => {
    expect(formatShortDate('2026-09-30')).toBe('30 sep 2026')
    expect(formatLongDate('2026-09-30')).toBe('miércoles 30 de septiembre de 2026')
    expect(formatShortDate(null)).toBe(DASH)
    expect(formatLongDate('')).toBe(DASH)
  })
})
