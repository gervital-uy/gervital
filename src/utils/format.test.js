import { formatCurrency, formatCompact, formatCedula } from './format'

// NOTE: Intl.NumberFormat('es-UY') emits a non-breaking space (U+00A0) between
// the $ symbol and the digits — expected strings below use that exact character.
describe('formatCurrency', () => {
  test('formats UYU with no decimals', () => {
    expect(formatCurrency(1284000)).toBe('$ 1.284.000')
  })
  test('handles zero', () => {
    expect(formatCurrency(0)).toBe('$ 0')
  })
})

describe('formatCompact', () => {
  test('renders thousands with k', () => {
    expect(formatCompact(500000)).toBe('500k')
  })
  test('renders millions with M and one decimal', () => {
    expect(formatCompact(1200000)).toBe('1,2M')
  })
  test('small numbers unchanged', () => {
    expect(formatCompact(0)).toBe('0')
    expect(formatCompact(850)).toBe('850')
  })
})

describe('formatCedula', () => {
  test('separates the check digit and groups thousands', () => {
    expect(formatCedula('12345678')).toBe('1.234.567-8')
  })
  test('handles 7-digit cédulas', () => {
    expect(formatCedula('1234567')).toBe('123.456-7')
  })
  test('normalizes an already formatted value', () => {
    expect(formatCedula('1.234.567-8')).toBe('1.234.567-8')
  })
  test('accepts numbers', () => {
    expect(formatCedula(12345678)).toBe('1.234.567-8')
  })
  test('returns the raw value when there is nothing to format', () => {
    expect(formatCedula('')).toBe('')
    expect(formatCedula(null)).toBe('')
    expect(formatCedula('7')).toBe('7')
  })
})
