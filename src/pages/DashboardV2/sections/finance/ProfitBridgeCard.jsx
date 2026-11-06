import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import { formatCompact } from '../../../../utils/format'
import { MINUS, money, pctText } from '../../format'
import { inkOn } from '../../ui/colors'
import { BRIDGE_COLORS, BRIDGE_LABELS, CARD_CLASS } from './cardsText'

const W = 760
const H = 280
const PAD = { l: 42, r: 14, t: 18, b: 46 }

// Los tres grupos del ingreso en enteros que suman 100 (resto mayor). Con pérdida no
// suman: los costos se pasan del ingreso y forzarlo mentiría.
function perHundred(steps, income, net) {
  const pctOf = v => (income > 0 ? (v / income) * 100 : 0)
  const group = keys => steps.filter(s => s.kind === 'cost' && keys.includes(s.key)).reduce((a, s) => a + s.amount, 0)
  const raw = [
    { label: 'a personal', v: pctOf(group(['salaries', 'providers', 'extras'])) },
    { label: 'a gastos', v: pctOf(group(['fixed', 'variable', 'extraordinary'])) },
    { label: net < 0 ? 'de pérdida' : 'de resultado', v: Math.abs(pctOf(net)) }
  ]
  const parts = raw.map(x => ({ ...x, n: Math.floor(x.v), rest: x.v - Math.floor(x.v) }))
  if (net >= 0) {
    let missing = 100 - parts.reduce((a, x) => a + x.n, 0)
    for (const x of [...parts].sort((a, b) => b.rest - a.rest)) {
      if (missing <= 0) break
      x.n += 1
      missing--
    }
  } else {
    parts.forEach(x => { x.n = Math.round(x.v) })
  }
  return `De cada $ 100 que tienen que entrar: ${parts.map(x => `${x.n} ${x.label}`).join(', ')}.`
}

// De lo que tiene que entrar al resultado, bloque por bloque (bridgeStepsV2). Un
// bloque sin movimiento en el mes no se dibuja.
export default function ProfitBridgeCard({ bridge, monthLabel }) {
  const { steps, income, net } = bridge
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const top = Math.max(income, ...steps.map(s => Math.max(s.from, s.to)))
  const bottom = Math.min(0, net)
  const span = (top - bottom) * 1.06 || 1
  const y = v => PAD.t + ((top * 1.06 - v) / span) * plotH
  const colW = plotW / steps.length
  const barW = Math.min(50, colW * 0.58)
  const xOf = i => PAD.l + colW * i + (colW - barW) / 2
  const pctOf = v => (income > 0 ? (v / income) * 100 : null)
  const ticks = [top, top / 2, 0]

  return (
    <Card className={`${CARD_CLASS} overflow-clip`}>
      <div className="px-5 pt-5 pb-1 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div>
          <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
            Puente de rentabilidad
            <InfoButton id="finBridge" />
          </h3>
          <p className="text-xs text-gray-400 mt-0.5"><span className="capitalize">{monthLabel}</span> · ingresos sin IVA · fijos mensualizados</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-gray-400">Resultado del mes</p>
          <p className={`text-2xl font-semibold tracking-tight tabular-nums ${net >= 0 ? 'text-gray-900' : 'text-rose-600'}`}>{money(net)}</p>
          <p className="text-[11px] text-gray-400 tabular-nums">{pctText(pctOf(net), 0)} de los ingresos</p>
        </div>
      </div>

      <div className="px-5 pt-3 pb-1 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto min-w-[600px]" role="img" aria-label={`Puente de rentabilidad: ${steps.map(s => `${BRIDGE_LABELS[s.key].join(' ')} ${money(s.kind === 'cost' ? -s.amount : s.amount)}`).join(', ')}`}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.l} y1={y(t)} x2={W - PAD.r} y2={y(t)} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="2 4" />
              <text x={PAD.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#6b7280">{formatCompact(t)}</text>
            </g>
          ))}
          {steps.map((s, i) => {
            const from = s.kind === 'end' ? 0 : s.from
            const barTop = Math.min(y(from), y(s.to))
            const height = Math.max(2, Math.abs(y(from) - y(s.to)))
            const x = xOf(i)
            const color = s.kind === 'end' ? (net >= 0 ? BRIDGE_COLORS.net : BRIDGE_COLORS.loss) : BRIDGE_COLORS[s.key]
            const inside = height >= 24
            const amount = s.kind === 'cost' ? `${MINUS}${formatCompact(s.amount)}` : `${s.amount < 0 ? MINUS : ''}${formatCompact(Math.abs(s.amount))}`
            const share = s.kind === 'cost' ? pctOf(s.amount) : null
            const [l1, l2] = BRIDGE_LABELS[s.key]
            return (
              <g key={s.key}>
                {i < steps.length - 1 && (
                  <line x1={x + barW} y1={y(s.to)} x2={xOf(i + 1)} y2={y(s.to)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="2 4" />
                )}
                <rect x={x} y={barTop} width={barW} height={height} rx="3.5" fill={color} />
                <text x={x + barW / 2} y={inside ? barTop + 15 : barTop - 7} textAnchor="middle" fontSize="11.5" fontWeight="600" fill={inside ? inkOn(color) : '#475569'}>
                  {amount}
                </text>
                {share != null && (
                  <text x={x + barW / 2} y={height >= 46 ? barTop + 28 : barTop + height + 12} textAnchor="middle" fontSize="9.5" fill={height >= 46 ? inkOn(color) : '#6b7280'} opacity={height >= 46 ? 0.75 : 1}>
                    {Math.round(share)}%
                  </text>
                )}
                <text x={PAD.l + colW * i + colW / 2} y={PAD.t + plotH + 18} textAnchor="middle" fontSize="10.5" fontWeight="500" fill="#475569">{l1}</text>
                <text x={PAD.l + colW * i + colW / 2} y={PAD.t + plotH + 30} textAnchor="middle" fontSize="9.5" fill="#6b7280">{l2}</text>
              </g>
            )
          })}
        </svg>
      </div>

      <p className="px-5 pb-5 pt-2 text-[12.5px] text-gray-500">{income > 0 ? perHundred(steps, income, net) : 'Sin ingresos en el mes: no hay de dónde repartir.'}</p>
    </Card>
  )
}
