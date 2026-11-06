import { useState } from 'react'
import { formatCompact } from '../../../../utils/format'
import { niceScale, sameMonthBefore } from '../../../../services/dashboardV2/financeView'
import { change } from '../../../../services/dashboardV2/financeSeriesV2'
import { useElementWidth } from '../../ui/useElementWidth'
import TipRow from '../../ui/TipRow'
import { MINUS, money, pctText } from '../../format'
import { COLORS, axisLabel, changeText, pointLabel } from './financeText'

const ROW_H = 14

// Vista Tendencia: lo que tiene que entrar al banco contra el costo total, con el
// área entre las dos pintada según el signo (verde si queda plata, rosa si el costo
// supera al ingreso), cortada en cada cruce. points: trendPoint() de financeView.
export default function IncomeCostTrendChart({ points, axis }) {
  const [measure, w] = useElementWidth()
  const [hover, setHover] = useState(null)
  if (!points.length) return null

  // Con pocos puntos el ojo no estima valores de una línea de dos vértices: cada uno
  // lleva su cifra y, abajo del mes, el resultado y el margen.
  const few = points.length <= 4
  const comps = points.map(p => sameMonthBefore(points, p))
  const richLabels = points.length <= 12 && comps.some(Boolean)
  const labelRows = 1 + (few ? 1 : 0) + (richLabels ? 1 : 0)
  const H = 198 + labelRows * ROW_H
  const padL = 46
  const padR = few ? 34 : 12
  const padT = few ? 26 : 14
  const padB = 10 + labelRows * ROW_H
  const rowY = k => H - padB + 13 + k * ROW_H
  const scale = niceScale(0, Math.max(...points.flatMap(p => [p.income, p.costs]), 1))
  const plotW = Math.max(0, w - padL - padR)
  const x = i => padL + (points.length === 1 ? 0.5 : i / (points.length - 1)) * plotW
  const y = v => padT + (1 - (v - scale.min) / (scale.max - scale.min || 1)) * (H - padT - padB)

  // El área se corta en cada cruce y se pinta según el signo.
  const bands = []
  const diff = i => points[i].income - points[i].costs
  let current = null
  for (let i = 0; i < points.length - 1; i++) {
    const d0 = diff(i)
    const d1 = diff(i + 1)
    const sign = d0 >= 0 ? 1 : -1
    if (!current || current.sign !== sign) {
      current = { sign, top: [], bottom: [] }
      bands.push(current)
    }
    current.top.push([x(i), y(points[i].income)])
    current.bottom.push([x(i), y(points[i].costs)])
    if ((d0 >= 0) !== (d1 >= 0)) {
      // El cruce exacto, interpolado: ahí las dos líneas se tocan.
      const t = d0 / (d0 - d1)
      const xc = x(i) + (x(i + 1) - x(i)) * t
      const yc = y(points[i].income + (points[i + 1].income - points[i].income) * t)
      current.top.push([xc, yc])
      current.bottom.push([xc, yc])
      current = { sign: d1 >= 0 ? 1 : -1, top: [[xc, yc]], bottom: [[xc, yc]] }
      bands.push(current)
    }
  }
  if (current) {
    const last = points.length - 1
    current.top.push([x(last), y(points[last].income)])
    current.bottom.push([x(last), y(points[last].costs)])
  }
  const polygon = b => [...b.top, ...[...b.bottom].reverse()].map(pt => pt.join(',')).join(' ')
  const line = key => points.map((p, i) => `${x(i)},${y(p[key])}`).join(' ')
  const step = points.length > 1 ? plotW / (points.length - 1) : plotW
  const focus = hover != null ? points[hover] : null
  const focusComp = hover != null ? comps[hover] : null
  const focusChange = focus && focusComp ? change(focus.result, focusComp.result) : null

  return (
    <div ref={measure} className="w-full relative" onMouseLeave={() => setHover(null)}>
      <svg width={w} height={H} className="block" aria-hidden="true">
        {scale.ticks.map(t => (
          <g key={t}>
            <line x1={padL} y1={y(t)} x2={w - padR} y2={y(t)} stroke={t === 0 ? '#cbd5e1' : '#f1f5f9'} strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-gray-300" style={{ fontSize: 9.5 }}>{formatCompact(t)}</text>
          </g>
        ))}

        {bands.filter(b => b.top.length > 1).map((b, i) => (
          <polygon key={i} points={polygon(b)} fill={b.sign >= 0 ? COLORS.positiveArea : COLORS.negativeArea} />
        ))}

        <polyline points={line('costs')} fill="none" stroke={COLORS.costs} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={line('income')} fill="none" stroke={COLORS.income} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => {
          const r = hover === i ? 5 : i === points.length - 1 ? 4 : 3
          return (
            <g key={i}>
              <circle cx={x(i)} cy={y(p.costs)} r={r} fill={COLORS.costs} stroke="#fff" strokeWidth="1.5" />
              <circle cx={x(i)} cy={y(p.income)} r={r} fill={COLORS.income} stroke="#fff" strokeWidth="1.5" />
            </g>
          )
        })}

        {hover != null && (
          <line x1={x(hover)} y1={padT} x2={x(hover)} y2={H - padB} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
        )}

        {few && points.map((p, i) => (
          <g key={`v${i}`}>
            <text x={x(i)} y={y(p.income) - 10} textAnchor="middle" className="fill-gray-700 font-semibold" style={{ fontSize: 10.5 }}>
              {formatCompact(p.income)}
            </text>
            <text x={x(i)} y={y(p.costs) + 18} textAnchor="middle" className="fill-gray-500 font-semibold" style={{ fontSize: 10.5 }}>
              {formatCompact(p.costs)}
            </text>
          </g>
        ))}

        {points.map((p, i) => {
          const comp = comps[i]
          const c = comp ? change(p.result, comp.result) : null
          return (
            <g key={`e${i}`}>
              <text x={x(i)} y={rowY(0)} textAnchor="middle" className="fill-gray-400" style={{ fontSize: few ? 11 : 9.5 }}>
                {axisLabel(p, axis)}
              </text>
              {few && (
                <text x={x(i)} y={rowY(1)} textAnchor="middle" className="font-semibold" style={{ fontSize: 10.5, fill: p.result >= 0 ? '#047857' : '#be123c' }}>
                  {`${p.result >= 0 ? '+' : MINUS}${formatCompact(Math.abs(p.result))} · ${pctText(p.netPct, 0)}`}
                </text>
              )}
              {richLabels && c && (
                <text x={x(i)} y={rowY(few ? 2 : 1)} textAnchor="middle" className="font-semibold" style={{ fontSize: 9.5, fill: c.diff >= 0 ? '#047857' : '#be123c' }}>
                  {`vs ${comp.year} ${changeText(c)}`}
                </text>
              )}
            </g>
          )
        })}

        {/* Franjas de captura, al final: en SVG manda el orden y no el z-index */}
        {points.map((p, i) => (
          <rect
            key={`hit${i}`}
            x={x(i) - step / 2}
            y={padT - 8}
            width={Math.max(8, step)}
            height={H - padT - padB + 16}
            fill="transparent"
            style={{ cursor: 'crosshair' }}
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {focus && (
        <div
          className="absolute z-20 pointer-events-none"
          style={{ left: x(hover), top: padT - 6, transform: `translateX(${x(hover) > w / 2 ? 'calc(-100% - 10px)' : '10px'})` }}
        >
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-3 py-2 whitespace-nowrap">
            <p className="text-[11px] font-semibold text-gray-900 mb-1">{pointLabel(focus, axis)}</p>
            <TipRow color={COLORS.income} label="A ingresar al banco" value={money(focus.income)} />
            <TipRow color={COLORS.costs} label="Costo total" value={money(focus.costs)} />
            <div className="mt-1.5 pt-1.5 border-t border-gray-100">
              <TipRow
                color={focus.result >= 0 ? COLORS.positiveArea : COLORS.negativeArea}
                square
                label="Resultado"
                value={money(focus.result)}
                valueClass={focus.result >= 0 ? 'text-emerald-700' : 'text-rose-600'}
              />
              <TipRow color="transparent" label="Margen neto" value={pctText(focus.netPct, 0)} valueClass="text-gray-700" />
            </div>
            {focusChange && (
              <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                <TipRow
                  color="transparent"
                  label={`vs ${pointLabel(focusComp, axis)}`}
                  value={changeText(focusChange)}
                  valueClass={focusChange.diff >= 0 ? 'text-emerald-700' : 'text-rose-600'}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="sr-only">
        <table>
          <caption>Lo que tiene que entrar al banco y el costo total por mes, sin IVA</caption>
          <thead>
            <tr>
              <th scope="col">Período</th>
              <th scope="col">A ingresar al banco</th>
              <th scope="col">Costo total</th>
              <th scope="col">Resultado</th>
              <th scope="col">Margen neto</th>
            </tr>
          </thead>
          <tbody>
            {points.map(p => (
              <tr key={`t-${p.year}-${p.month}`}>
                <th scope="row">{pointLabel(p, 'month')}</th>
                <td>{money(p.income)}</td>
                <td>{money(p.costs)}</td>
                <td>{money(p.result)}</td>
                <td>{pctText(p.netPct, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
