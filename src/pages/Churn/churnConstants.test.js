import { planSubtitle, assignedDaysLabel } from './churnConstants'

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
