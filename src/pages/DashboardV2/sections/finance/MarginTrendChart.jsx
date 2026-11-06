import { useState } from 'react'
import { niceScale, sameMonthBefore } from '../../../../services/dashboardV2/financeView'
import { useElementWidth } from '../../ui/useElementWidth'
import ChartTip from '../../ui/ChartTip'
import { DELTA_TEXT, deltaView } from '../../ui/DeltaTag'
import { pctText } from '../../format'
import { MARGIN_LINES, axisLabel, pointLabel } from './financeText'

const H = 212
const PAD = { left: 38, right: 10, top: 14, bottom: 26 }

// Vista Márgenes: bruto, operativo y neto mes a mes, con la banda entre el bruto y el
// neto (lo que se lleva la estructura) y la meta de margen neto si está definida. Una
// meta sin definir no entra en la escala ni se dibuja: una línea inventada es peor que
// ninguna. points: marginKpisV2() de cada mes.
export default function MarginTrendChart({ points, target, axis }) {
  const [measure, w] = useElementWidth()
  const [hover, setHover] = useState(null)
  if (!points.length) return null

  const hasTarget = typeof target === 'number' && Number.isFinite(target)
  const values = points.flatMap(p => MARGIN_LINES.map(l => p[l.key])).concat(hasTarget ? [target] : [])
  // Siempre con el cero y al menos hasta 10%: un margen se lee contra el cero.
  const scale = niceScale(Math.min(0, ...values), Math.max(10, ...values), 5)
  const plotW = Math.max(0, w - PAD.left - PAD.right)
  const x = i => PAD.left + (points.length === 1 ? 0.5 : i / (points.length - 1)) * plotW
  const y = v => PAD.top + (1 - (v - scale.min) / (scale.max - scale.min || 1)) * (H - PAD.top - PAD.bottom)
  const step = points.length > 1 ? plotW / (points.length - 1) : plotW
  const comps = points.map(p => sameMonthBefore(points, p))
  const focus = hover != null ? points[hover] : null
  const focusComp = hover != null ? comps[hover] : null
  // El neto contra la meta: arriba de ella es a favor, como cualquier variación.
  const targetGap = focus && hasTarget ? deltaView(focus.netPct - target, { unit: 'pp' }) : null
  const band = [
    ...points.map((p, i) => `${x(i)},${y(p.grossPct)}`),
    ...points.map((_, i) => points.length - 1 - i).map(i => `${x(i)},${y(points[i].netPct)}`)
  ].join(' ')

  return (
    <div ref={measure} className="w-full relative" onMouseLeave={() => setHover(null)}>
      <svg width={w} height={H} className="block" aria-hidden="true">
        {hover != null && (
          <line x1={x(hover)} y1={PAD.top} x2={x(hover)} y2={H - PAD.bottom} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
        )}
        {scale.ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} y1={y(t)} x2={w - PAD.right} y2={y(t)} stroke={t === 0 ? '#cbd5e1' : '#f1f5f9'} strokeWidth="1" />
            <text x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end" className="fill-gray-300" style={{ fontSize: 10 }}>{`${t}%`}</text>
          </g>
        ))}

        {points.length > 1 && <polygon fill="rgba(16,185,129,0.07)" points={band} />}

        {hasTarget && (
          <>
            <line x1={PAD.left} y1={y(target)} x2={w - PAD.right} y2={y(target)} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 4" />
            <text x={w - PAD.right} y={y(target) - 5} textAnchor="end" className="fill-gray-400" style={{ fontSize: 10, fontWeight: 600 }}>
              {`meta ${target}%`}
            </text>
          </>
        )}

        {MARGIN_LINES.map(l => (
          <polyline
            key={l.key}
            fill="none"
            stroke={l.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={points.map((p, i) => `${x(i)},${y(p[l.key])}`).join(' ')}
          />
        ))}
        {MARGIN_LINES.map(l => points.map((p, i) => (
          <circle
            key={`${l.key}-${i}`}
            cx={x(i)}
            cy={y(p[l.key])}
            r={hover === i ? 5 : i === points.length - 1 ? 4 : 3}
            fill={l.color}
            stroke="#fff"
            strokeWidth="1.5"
          />
        )))}

        {points.map((p, i) => (
          <text key={`m-${i}`} x={x(i)} y={H - 8} textAnchor="middle" className="fill-gray-400" style={{ fontSize: axis === 'monthYear' ? 9 : 10 }}>
            {axisLabel(p, axis)}
          </text>
        ))}

        {points.map((p, i) => (
          <rect
            key={`hit${i}`}
            x={x(i) - step / 2}
            y={PAD.top - 8}
            width={Math.max(8, step)}
            height={H - PAD.top - PAD.bottom + 16}
            fill="transparent"
            style={{ cursor: 'crosshair' }}
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {focus && (
        <ChartTip anchor={x(hover)} box={w} top={PAD.top - 6}>
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-3 py-2 whitespace-nowrap">
            <p className="text-[11px] font-semibold text-gray-900 mb-1">{pointLabel(focus, axis)}</p>
            {/* Cada capa con su margen y, al lado, cuánto se movió contra el mismo mes
                del año anterior, en puntos porcentuales (no en % de un %). */}
            {MARGIN_LINES.map(l => {
              const diff = focusComp ? deltaView(focus[l.key] - focusComp[l.key], { unit: 'pp' }) : null
              return (
                <div key={l.key} className="flex items-center gap-2 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: l.color }} />
                  <span className="text-gray-400 w-[62px]">{l.label}</span>
                  <span className={`ml-auto font-semibold tabular-nums ${focus[l.key] < 0 ? 'text-rose-600' : 'text-gray-900'}`}>{pctText(focus[l.key], 0)}</span>
                  {diff && <span className={`w-[56px] text-right tabular-nums font-semibold ${DELTA_TEXT[diff.tone]}`}>{diff.text}</span>}
                </div>
              )
            })}
            {targetGap && (
              <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex items-center gap-2 text-[11px]">
                <span className="w-1.5 h-1.5" />
                <span className="text-gray-400 w-[62px]">Meta neto</span>
                <span className="ml-auto tabular-nums text-gray-500">{`${target}%`}</span>
                <span className={`w-[56px] text-right tabular-nums font-semibold ${DELTA_TEXT[targetGap.tone]}`}>{targetGap.text}</span>
              </div>
            )}
            {focusComp && <p className="text-[10px] text-gray-300 mt-1.5">variación contra {pointLabel(focusComp, axis)}</p>}
          </div>
        </ChartTip>
      )}

      <div className="sr-only">
        <table>
          <caption>Márgenes bruto, operativo y neto por mes, en % de lo que tiene que entrar al banco</caption>
          <thead>
            <tr>
              <th scope="col">Período</th>
              {MARGIN_LINES.map(l => <th key={l.key} scope="col">{l.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {points.map(p => (
              <tr key={`t-${p.year}-${p.month}`}>
                <th scope="row">{pointLabel(p, 'month')}</th>
                {MARGIN_LINES.map(l => <td key={l.key}>{pctText(p[l.key], 1)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
