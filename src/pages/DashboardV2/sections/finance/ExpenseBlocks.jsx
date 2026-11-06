import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import { formatCompact } from '../../../../utils/format'
import { DASH, money, pctText } from '../../format'
import { deltaView } from '../../ui/DeltaTag'
import { change } from '../../../../services/dashboardV2/financeSeriesV2'
import { CARD_CLASS, PART_COLORS, PART_LABELS } from './cardsText'

// Recorrido de una pieza en los últimos meses, sin ejes: la forma, no el número.
function Sparkline({ values, color, width = 64, height = 20 }) {
  if (!values || values.length < 2) return <span className="text-[11px] text-gray-300">{DASH}</span>
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const points = values.map((v, i) => `${(i / (values.length - 1)) * (width - 2) + 1},${height - 2 - ((v - min) / span) * (height - 4)}`).join(' ')
  return (
    <svg width={width} height={height} aria-hidden="true" className="block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const GRID = { gridTemplateColumns: 'minmax(0,1fr) auto 38px 64px 48px', columnGap: 10 }

// Un bloque de gasto (personal, o fijos / variables / extraordinarios) con el peso
// de cada pieza, su recorrido y la variación contra el mes anterior.
function Block({ label, infoId, block, income }) {
  const total = block.total
  const sharePct = income > 0 ? (total / income) * 100 : null
  return (
    <Card role="group" aria-label={label} className={`${CARD_CLASS} h-full`}>
      <div className="px-4 py-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1">
          <span>{label}</span>
          <InfoButton id={infoId} />
        </p>
        <div className="mt-2 flex items-center gap-2 whitespace-nowrap">
          <span className="text-[21px] leading-none font-semibold tracking-tight tabular-nums text-gray-900">{money(total)}</span>
          <span className="w-px h-5 bg-gray-200 shrink-0" />
          <span className="flex items-baseline gap-1">
            <span className="text-[21px] leading-none font-semibold tracking-tight tabular-nums text-gray-900">{pctText(sharePct, 0)}</span>
            <span className="text-[10.5px] font-medium text-gray-400">de los ingresos</span>
          </span>
        </div>

        <div className="mt-3 border-t border-gray-100 overflow-x-auto">
          <div className="grid items-center text-[10px] font-semibold uppercase tracking-wide text-gray-300 pt-2 pb-1 min-w-[340px]" style={GRID}>
            <span />
            <span className="text-right">Monto</span>
            <span className="text-right">Peso</span>
            <span className="text-center">Meses</span>
            <span className="text-right">vs mes</span>
          </div>
          {block.parts.map(p => {
            const share = total > 0 ? (p.value / total) * 100 : 0
            const color = PART_COLORS[p.key]
            const view = deltaView(p.prev == null ? null : change(p.value, p.prev), { invert: true })
            return (
              <div
                key={p.key}
                className="grid items-center py-[7px] rounded-md min-w-[340px]"
                style={{ ...GRID, background: `linear-gradient(to right, ${color}1f ${share}%, transparent ${share}%)` }}
                title={`${PART_LABELS[p.key]}: ${money(p.value)}`}
              >
                <span className="flex items-center gap-2 min-w-0 pl-1.5">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
                  <span className="text-[12px] text-gray-700 truncate">{PART_LABELS[p.key]}</span>
                </span>
                <span className="text-[12.5px] font-semibold tabular-nums text-gray-900 text-right">{formatCompact(p.value)}</span>
                <span className="text-[11px] tabular-nums text-gray-400 text-right">{total > 0 ? `${Math.round(share)}%` : DASH}</span>
                <span className="flex justify-center"><Sparkline values={p.trend} color={color} /></span>
                <span className={`text-[11px] font-semibold tabular-nums text-right pr-1.5 ${
                  view.tone === 'none' ? 'text-gray-300' : view.tone === 'flat' ? 'text-gray-400' : view.tone === 'good' ? 'text-emerald-700' : 'text-rose-600'
                }`}>
                  {view.text}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

// El gasto del mes en sus dos mitades: el personal y el resto.
export default function ExpenseBlocks({ cards, income }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Block label="Personal (sueldos, prestadores y extras)" infoId="finPersonal" block={cards.personal} income={income} />
      <Block label="Gastos fijos, variables y extraordinarios" infoId="finOperating" block={cards.operating} income={income} />
    </div>
  )
}
