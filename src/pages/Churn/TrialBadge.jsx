import { TRIAL_BADGE } from './churnConstants'

// Marca las bajas ocurridas durante el período de prueba. Compartido por la card
// del board y el modal de detalle.
export default function TrialBadge() {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold"
      style={{ background: TRIAL_BADGE.bg, color: TRIAL_BADGE.color }}
      title={TRIAL_BADGE.title}
    >
      {TRIAL_BADGE.label}
    </span>
  )
}
