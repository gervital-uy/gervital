import { cleanupCutoff } from './groupService'

// El cálculo viejo: new Date(str) parseaba en UTC y toISOString leía en UTC, así que
// los dos corrimientos se cancelaban. Era correcto pero frágil. Estos tests fijan que
// el corte nuevo (todo en local) da exactamente el mismo día.
const legacyCutoff = (todayStr) => {
  const cutoff = new Date(todayStr)
  cutoff.setDate(cutoff.getDate() - 14)
  return cutoff.toISOString().slice(0, 10)
}

describe('cleanupCutoff', () => {
  test('resta 14 días', () => {
    expect(cleanupCutoff('2026-09-04')).toBe('2026-08-21')
  })

  test('cruza el fin de mes', () => {
    expect(cleanupCutoff('2026-03-05')).toBe('2026-02-19')
  })

  test('cruza el fin de año', () => {
    expect(cleanupCutoff('2026-01-07')).toBe('2025-12-24')
  })

  test('idéntico al cálculo anterior para un año entero (no se borra nada distinto)', () => {
    const d = new Date(2026, 0, 1)
    for (let i = 0; i < 365; i++) {
      const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      expect(cleanupCutoff(s)).toBe(legacyCutoff(s))
      d.setDate(d.getDate() + 1)
    }
  })
})
