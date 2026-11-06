import { useState } from 'react'
import TipRow from '../../ui/TipRow'
import { formatDecimal } from '../../format'
import { signed } from './commercialText'

// Movimiento de la cartera: altas hacia arriba y bajas hacia abajo sobre un eje
// único, con la línea de la variación (altas − bajas) encima.
//   · Color: teal contra rosa (no verde contra rojo, que se confunde con
//     deuteranopía) y la lectura frío/cálido de entra/sale.
//   · Un solo eje: altas, bajas y variación se miden en personas.
//   · El dominio incluye siempre las bajas, así que prender o apagar la línea no
//     mueve las torres.
export const FLOW_COLORS = { entries: '#0d9488', exits: '#e11d48', net: '#475569' }

// rows: [{ key, label, entries, exits, closing, newEntries, returns, partial }]
// mode: 'months' (meses seguidos) o 'years' (el mismo mes en cada año).
export default function ClientFlowChart({ rows, showTrend, mode = 'months' }) {
  const [hover, setHover] = useState(null)
  const n = rows.length
  if (!n) return null

  const W = 400
  const H = 170
  const padL = 22
  const padR = 10
  const padT = 14
  const padB = 26
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const nets = rows.map(r => r.entries - r.exits)
  const hi = Math.max(1, ...rows.map(r => r.entries))
  const lo = -Math.max(0, ...rows.map(r => r.exits))
  const span = hi - lo || 1
  const yOf = v => padT + plotH - ((v - lo) / span) * plotH
  const y0 = yOf(0)
  const groupW = plotW / n
  const barW = Math.min(mode === 'years' ? 26 : 15, Math.max(6, groupW - 7))
  const cxOf = i => padL + groupW * i + groupW / 2
  // Referencias enteras: media persona no existe
  const ticks = [...new Set([hi, 0, lo])]
  const totalEntries = rows.reduce((s, r) => s + r.entries, 0)
  const totalExits = rows.reduce((s, r) => s + r.exits, 0)
  const totalNet = totalEntries - totalExits
  const tip = hover == null ? null : rows[hover]

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Altas hacia arriba y bajas hacia abajo, con la línea de variación">
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} y1={yOf(t)} x2={W - padR} y2={yOf(t)} stroke={t === 0 ? '#e5e7eb' : '#f1f5f9'} strokeWidth="1" strokeDasharray={t === 0 ? undefined : '2 4'} />
            {/* El eje va en valores absolutos: abajo del cero el número cuenta bajas */}
            <text x={padL - 7} y={yOf(t) + 3.5} textAnchor="end" fontSize="9.5" fill="#6b7280" className="tabular-nums">{Math.abs(t)}</text>
          </g>
        ))}

        {rows.map((row, i) => {
          const cx = cxOf(i)
          const last = i === n - 1
          return (
            // Los manejadores van en el grupo: el rectángulo invisible queda debajo de las torres
            <g
              key={row.key}
              opacity={hover != null && hover !== i ? 0.45 : 1}
              style={{ transition: 'opacity .15s' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={padL + groupW * i} y={0} width={groupW} height={H} fill="#ffffff" fillOpacity="0" style={{ pointerEvents: 'all' }} />
              {row.entries > 0 && (
                <rect x={cx - barW / 2} y={yOf(row.entries)} width={barW} height={Math.max(1, y0 - yOf(row.entries) - 1)} rx="2" fill={FLOW_COLORS.entries} fillOpacity={showTrend ? 0.88 : 1} />
              )}
              {row.exits > 0 && (
                <rect x={cx - barW / 2} y={y0 + 1} width={barW} height={Math.max(1, yOf(-row.exits) - y0 - 1)} rx="2" fill={FLOW_COLORS.exits} fillOpacity={showTrend ? 0.88 : 1} />
              )}
              {row.entries > 0 && (
                <text x={cx} y={yOf(row.entries) - 4} textAnchor="middle" fontSize="9" fontWeight="600" fill="#475569" className="tabular-nums">{row.entries}</text>
              )}
              {row.exits > 0 && (
                <text x={cx} y={yOf(-row.exits) + 9} textAnchor="middle" fontSize="9" fontWeight="600" fill="#475569" className="tabular-nums">{row.exits}</text>
              )}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="9" fontWeight={last ? '600' : '400'} fill={last ? '#334155' : '#6b7280'}>
                {row.label}{row.partial ? '*' : ''}
              </text>
            </g>
          )
        })}

        {/* Tramos rectos y no una curva: una curva inventaría valores entre meses */}
        {showTrend && (
          <g style={{ pointerEvents: 'none' }}>
            <polyline points={nets.map((v, i) => `${cxOf(i)},${yOf(v)}`).join(' ')} fill="none" stroke="#ffffff" strokeWidth="4.5" strokeOpacity="0.9" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={nets.map((v, i) => `${cxOf(i)},${yOf(v)}`).join(' ')} fill="none" stroke={FLOW_COLORS.net} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            {nets.map((v, i) => (
              <circle key={i} cx={cxOf(i)} cy={yOf(v)} r="2.4" fill={FLOW_COLORS.net} stroke="#ffffff" strokeWidth="1.4" />
            ))}
            <text x={cxOf(n - 1) - barW / 2 - 3} y={yOf(nets[n - 1]) - 6} textAnchor="end" fontSize="9.5" fontWeight="600" fill={FLOW_COLORS.net} stroke="#ffffff" strokeWidth="2.6" paintOrder="stroke" className="tabular-nums">
              {signed(nets[n - 1])}
            </text>
          </g>
        )}
      </svg>

      {/* Activos al cierre, alineados con las columnas: los márgenes del viewBox en
          porcentaje y el resto en n columnas iguales, como las torres. */}
      <div className="mt-2 pt-2.5 border-t border-gray-100">
        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Clientes activos al cierre</p>
        <div style={{ paddingLeft: `${(padL / W) * 100}%`, paddingRight: `${(padR / W) * 100}%` }}>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {rows.map((row, i) => {
              const last = i === n - 1
              const prev = i > 0 ? rows[i - 1].closing : null
              return (
                <span
                  key={row.key}
                  title={`${row.label}: ${row.closing} activos al cierre`}
                  className={`text-center tabular-nums leading-none transition-opacity ${last ? 'text-[14.5px] font-semibold text-gray-900' : 'text-[12.5px] font-medium text-gray-700'} ${hover != null && hover !== i ? 'opacity-45' : 'opacity-100'}`}
                >
                  {row.closing}
                  {/* Un punto marca los cierres por debajo o por encima del anterior */}
                  {prev != null && row.closing !== prev && (
                    <span className="block mx-auto mt-[3px] w-1 h-1 rounded-full" style={{ background: row.closing < prev ? FLOW_COLORS.exits : FLOW_COLORS.entries }} />
                  )}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {tip && (
        <div
          className="absolute z-10 pointer-events-none"
          style={{ left: `${((hover + 0.5) / n) * 100}%`, top: 0, transform: `translate(${hover <= 1 ? '-8%' : hover >= n - 2 ? '-92%' : '-50%'}, -6px)` }}
        >
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-3 py-2 whitespace-nowrap">
            <p className="text-[11px] font-semibold text-gray-900 mb-1">{tip.label}{tip.partial ? ' · en curso, hasta hoy' : ''}</p>
            <TipRow color={FLOW_COLORS.entries} label="Altas" value={tip.returns ? `${tip.entries} (${tip.returns} reingreso${tip.returns === 1 ? '' : 's'})` : String(tip.entries)} />
            <TipRow color={FLOW_COLORS.exits} label="Bajas" value={String(tip.exits)} />
            {/* "Variación" y no "neto": en el tablero "neto" ya quiere decir "sin IVA" */}
            <TipRow color={FLOW_COLORS.net} label="Variación" value={signed(tip.entries - tip.exits)} />
          </div>
        </div>
      )}

      {/* En meses seguidos decide el acumulado; comparando años, cómo se para este
          año contra los anteriores. */}
      {mode === 'months' ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="flex items-center gap-2 text-[12.5px] text-gray-600">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FLOW_COLORS.entries }} />
            Altas <span className="font-semibold text-gray-900 tabular-nums">{totalEntries}</span>
          </span>
          <span className="flex items-center gap-2 text-[12.5px] text-gray-600">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FLOW_COLORS.exits }} />
            Bajas <span className="font-semibold text-gray-900 tabular-nums">{totalExits}</span>
          </span>
          <span className="flex items-center gap-2 text-[12.5px] text-gray-600">
            <span className="w-4 h-[2px] rounded-full" style={{ background: FLOW_COLORS.net }} />
            Variación {n} m
            <span className={`font-semibold tabular-nums ${totalNet > 0 ? 'text-teal-700' : totalNet < 0 ? 'text-rose-600' : 'text-gray-900'}`}>{signed(totalNet)}</span>
          </span>
        </div>
      ) : (
        <YearsSummary rows={rows} />
      )}
    </div>
  )
}

function YearsSummary({ rows }) {
  const current = rows[rows.length - 1]
  const before = rows.slice(0, -1)
  const avg = f => (before.length ? before.reduce((s, r) => s + f(r), 0) / before.length : null)
  const net = current.entries - current.exits
  const rank = rows.filter(r => r.entries - r.exits > net).length + 1
  const line = (color, label, value, ref, isLine) => (
    <div className="flex items-baseline gap-2">
      <span className={`shrink-0 mt-[5px] ${isLine ? 'w-4 h-[2px]' : 'w-2.5 h-2.5 rounded-sm'}`} style={{ background: color }} />
      <span className="text-[12.5px] text-gray-600">{label}</span>
      <span className="text-[12.5px] font-semibold text-gray-900 tabular-nums">{value}</span>
      <span className="text-[11.5px] text-gray-400 tabular-nums">{ref}</span>
    </div>
  )
  return (
    <div className="mt-3 pt-3 border-t border-gray-50 flex flex-col gap-1.5">
      {line(FLOW_COLORS.entries, 'Altas', current.entries, `promedio de los ${before.length} anteriores: ${formatDecimal(avg(r => r.entries))}`)}
      {line(FLOW_COLORS.exits, 'Bajas', current.exits, `promedio: ${formatDecimal(avg(r => r.exits))}`)}
      {line(FLOW_COLORS.net, 'Variación', signed(net), `${rank}° de ${rows.length} años con datos`, true)}
    </div>
  )
}
