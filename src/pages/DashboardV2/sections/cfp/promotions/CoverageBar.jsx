import Card from '../../../../../components/ui/Card'
import InfoButton from '../../../explain/InfoButton'
import { formatDecimal, monthLabelOf, pctText } from '../../../format'

// Promos de más meses en el verde más oscuro; los descuentos sueltos en ámbar.
const PROMO_SHADES = ['#047857', '#10b981', '#6ee7b7', '#a7f3d0']
const DISCOUNT_COLOR = '#fbbf24'
const NONE_COLOR = '#e5e7eb'

const colorOf = (segment, promoIndex) => (segment.kind === 'promo'
  ? PROMO_SHADES[Math.min(promoIndex, PROMO_SHADES.length - 1)]
  : segment.kind === 'discount' ? DISCOUNT_COLOR : NONE_COLOR)

// Qué parte del padrón del mes tiene algún beneficio, por tipo.
export default function CoverageBar({ kpis }) {
  let promoIndex = 0
  const segments = kpis.segments.map(s => ({ ...s, color: colorOf(s, s.kind === 'promo' ? promoIndex++ : 0) }))
  const total = segments.reduce((sum, s) => sum + s.count, 0) || 1
  const prev = kpis.previousCoverage
  const diff = prev?.pct != null && kpis.coveragePct != null ? kpis.coveragePct - prev.pct : null

  return (
    <Card className="rounded-2xl border-gray-100 px-5 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[13px] font-semibold text-gray-900 flex items-center gap-1">
            Cobertura de beneficios
            <InfoButton id="benefCoverage" />
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">Sobre los {kpis.base} clientes del padrón del mes</p>
        </div>
        <p className="text-[22px] leading-none font-bold text-gray-900 tabular-nums">{pctText(kpis.coveragePct, 0)}</p>
      </div>

      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
        {segments.filter(s => s.count > 0).map(s => (
          <div key={s.key} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.count}`} />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {segments.map(s => (
          <li key={s.key} className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
            {s.label}
            <span className="font-semibold text-gray-800 tabular-nums">{s.count}</span>
          </li>
        ))}
      </ul>

      {prev && (
        <p className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
          En {monthLabelOf(prev.year, prev.month)} era {pctText(prev.pct, 0)}
          {diff != null && Math.abs(diff) >= 1 && (
            <span className="text-gray-500"> ({diff > 0 ? '+' : ''}{formatDecimal(diff, 0)} puntos)</span>
          )}
        </p>
      )}
    </Card>
  )
}
