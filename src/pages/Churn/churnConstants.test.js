import { planSubtitle, assignedDaysLabel, filterLostByAge } from './churnConstants'

test('assignedDaysLabel orders by weekday and ignores unknown values', () => {
  expect(assignedDaysLabel(['friday', 'monday', 'wednesday'])).toBe('Lun, Mié, Vie')
  expect(assignedDaysLabel(['sunday'])).toBe('')
  expect(assignedDaysLabel([])).toBe('')
  expect(assignedDaysLabel(undefined)).toBe('')
})

test('planSubtitle hides days by default (card) and shows them with withDays (modal)', () => {
  const card = { frequency: 2, schedule: 'afternoon', cognitiveLevel: 'B', assignedDays: ['monday', 'friday'] }

  expect(planSubtitle(card)).toBe('2× · Tarde · Tier B')
  expect(planSubtitle(card, { withDays: true })).toBe('2× · Lun, Vie · Tarde · Tier B')
})

test('planSubtitle skips missing plan fields', () => {
  expect(planSubtitle({ frequency: null, schedule: null, cognitiveLevel: null, assignedDays: [] }, { withDays: true })).toBe('')
  expect(planSubtitle({ frequency: 1, assignedDays: ['thursday'] }, { withDays: true })).toBe('1× · Jue')
})

describe('filterLostByAge', () => {
  const cards = [
    { clientId: 'new-old', stage: 'new', daysSince: 400 },
    { clientId: 'nego-old', stage: 'negotiating', daysSince: 400 },
    { clientId: 'lost-recent', stage: 'lost', daysSince: 20 },
    { clientId: 'lost-edge', stage: 'lost', daysSince: 90 },
    { clientId: 'lost-old', stage: 'lost', daysSince: 91 },
    { clientId: 'lost-nodate', stage: 'lost', daysSince: null }
  ]

  test('solo oculta perdidos: las otras etapas nunca se filtran por antigüedad', () => {
    const ids = filterLostByAge(cards, 90).map(c => c.clientId)
    expect(ids).toEqual(['new-old', 'nego-old', 'lost-recent', 'lost-edge', 'lost-nodate'])
  })

  test('el umbral es inclusivo', () => {
    expect(filterLostByAge(cards, 20).map(c => c.clientId)).toContain('lost-recent')
    expect(filterLostByAge(cards, 19).map(c => c.clientId)).not.toContain('lost-recent')
  })

  test('maxDays null devuelve la misma lista', () => {
    expect(filterLostByAge(cards, null)).toBe(cards)
  })
})
