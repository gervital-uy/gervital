import Card from '../../../components/ui/Card'
import InfoButton from '../explain/InfoButton'
import { DASH } from '../format'

// KPI del dashboard v2: la de legacy (charts/StatCard.jsx) más el botón "i".
// `value` llega formateado; si no hay dato se muestra '—'.
export default function StatCard({ label, value, valueClass = 'text-gray-900', sub, pill, infoId }) {
  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-gray-500 flex items-center gap-1 min-w-0">
            <span className="truncate">{label}</span>
            {infoId && <InfoButton id={infoId} />}
          </p>
          {pill}
        </div>
        <p className={`text-[22px] leading-tight font-semibold tracking-tight tabular-nums mt-1.5 truncate ${valueClass}`}>
          {value ?? DASH}
        </p>
        {sub && <p className="text-[11px] text-gray-400 mt-1">{sub}</p>}
      </div>
    </Card>
  )
}
