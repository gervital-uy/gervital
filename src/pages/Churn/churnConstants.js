// Pipeline stages, in board order. label + color dot per stage.
export const STAGES = [
  { key: 'new', label: 'Nueva baja', color: '#e11d48' },
  { key: 'contacting', label: 'En seguimiento', color: '#d97706' },
  { key: 'negotiating', label: 'En negociación', color: '#2563eb' },
  { key: 'temporary_pause', label: 'Pausa temporal', color: '#7c3aed' },
  { key: 'lost', label: 'Perdido', color: '#94a3b8' }
]

export const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.key, s.label]))

// Cognitive tier → color hex.
export const TIER_HEX = {
  A: '#16a34a',
  B: '#2563eb',
  C: '#d97706',
  D: '#dc2626'
}

export const SCHEDULE_LABEL = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  full_day: 'Día completo'
}

// Badge de baja en período de prueba. Mismo naranja que el tipo de cliente
// "A prueba" en la lista de clientes (CLIENT_TYPE_META.trial).
export const TRIAL_BADGE = {
  label: 'A prueba',
  color: '#ea580c',
  bg: '#ffedd5',
  title: 'No se quedó después del período de prueba'
}

export const DAY_LABEL = {
  monday: 'Lun',
  tuesday: 'Mar',
  wednesday: 'Mié',
  thursday: 'Jue',
  friday: 'Vie'
}

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

// "Lun, Mié" — ordenados por día de semana, ignora valores desconocidos.
export function assignedDaysLabel(assignedDays) {
  if (!assignedDays?.length) return ''
  return DAY_ORDER.filter(d => assignedDays.includes(d)).map(d => DAY_LABEL[d]).join(', ')
}

// "3× · Lun, Mié · Mañana · Tier B" — handles null plan fields gracefully.
// withDays: los días solo se muestran en el modal; la card se mantiene compacta.
export function planSubtitle({ frequency, schedule, cognitiveLevel, assignedDays }, { withDays = false } = {}) {
  const parts = []
  const days = withDays ? assignedDaysLabel(assignedDays) : ''
  if (frequency) parts.push(`${frequency}×`)
  if (days) parts.push(days)
  if (schedule && SCHEDULE_LABEL[schedule]) parts.push(SCHEDULE_LABEL[schedule])
  if (cognitiveLevel) parts.push(`Tier ${cognitiveLevel}`)
  return parts.join(' · ')
}
