import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCompact } from '../../../../utils/format'
import { moneyScale } from '../../../../services/dashboardV2/financeView'
import { useElementWidth } from '../../ui/useElementWidth'
import TipRow from '../../ui/TipRow'
import { money } from '../../format'
import { COLORS, axisLabel, pointLabel } from './financeText'

const PLOT_H = 184
const LABELS_H = 24
// Menos de 34 px por mes se vuelve ilegible: con 24 meses en un teléfono, el gráfico
// se recorre de costado (dentro de su caja, nunca la página).
const MIN_BAND = 34
const BAR_W = 10
const BAR_GAP = 3
// Separación entre los tramos de una barra apilada, del color del fondo.
const SEGMENT_GAP = 2

// Camino de un tramo de barra entre `top` y `bottom`; el de arriba de la pila lleva
// las esquinas redondeadas.
function segmentPath(x, top, bottom, width, roundTop) {
  const h = bottom - top
  if (h <= 0) return null
  const r = roundTop ? Math.min(3, h, width / 2) : 0
  return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${bottom} Z`
}

// Una pila desde el cero hacia arriba: [{ value, color }] de abajo hacia arriba.
function Stack({ x, zero, px, segments }) {
  const visible = segments.filter(s => s.value > 0)
  let base = zero
  return visible.map((s, i) => {
    const top = base - px(s.value)
    const bottom = i === 0 ? base : base - SEGMENT_GAP
    const d = segmentPath(x, top, bottom, BAR_W, i === visible.length - 1)
    base = top
    return d && <path key={i} d={d} fill={s.color} />
  })
}

// Curva suave por los puntos (Catmull-Rom a Bézier), la de legacy.
export function smoothPath(points) {
  if (!points.length) return ''
  const d = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1]
    d.push(`C ${(p1.x + (p2.x - p0.x) / 6).toFixed(2)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(2)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(2)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(2)} ${p2.x} ${p2.y}`)
  }
  return d.join(' ')
}

// Vista Pesos: por mes, una barra de ingreso (asistencia + transporte) y una de costo
// (gastos con los fijos en su mes de pago + personal), y la línea del resultado. El
// mes elegido va lleno y el resto apagado; tocar una barra elige ese mes.
export default function MoneyChart({ points, selected, onSelect, active, axis }) {
  const [measure, viewport] = useElementWidth()
  const scrollRef = useRef(null)
  const [hover, setHover] = useState(null)
  // Un solo ref para medir y para desplazar; estable, o cada render lo reengancha.
  const setScrollNode = useCallback(node => {
    scrollRef.current = node
    measure(node)
  }, [measure])

  const n = Math.max(1, points.length)
  const band = Math.max(viewport / n, MIN_BAND)
  const contentW = Math.max(viewport, points.length * band)
  const scale = moneyScale(points, active)
  const span = scale.max - scale.min || 1
  const y = v => (1 - (v - scale.min) / span) * PLOT_H
  const px = v => (v / span) * PLOT_H
  const zero = y(0)
  const isSelected = p => p.year === selected.year && p.month === selected.month
  const selIdx = points.findIndex(isSelected)
  const cx = i => (i + 0.5) * band

  // El mes elegido queda a la vista cuando el gráfico se recorre de costado.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    const target = selIdx >= 0 ? cx(selIdx) - el.clientWidth / 2 : el.scrollWidth
    el.scrollLeft = Math.max(0, Math.min(el.scrollWidth, target))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selIdx, band, points.length])

  const linePoints = active.result ? points.map((p, i) => ({ x: cx(i), y: y(p.result) })) : []
  const tip = hover != null ? points[hover] : null
  const tipLeft = tip ? cx(hover) < contentW / 2 : true

  return (
    <div>
      <div className="flex gap-2">
        {/* Escala fija a la izquierda: no se va con el desplazamiento */}
        <div className="relative w-10 shrink-0" style={{ height: PLOT_H }} aria-hidden="true">
          {scale.ticks.map(t => (
            <span key={t} className="absolute right-0 -translate-y-1/2 text-[10px] text-gray-300 leading-none tabular-nums" style={{ top: y(t) }}>
              {formatCompact(t)}
            </span>
          ))}
        </div>

        <div
          ref={setScrollNode}
          className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden scrollbar-thin"
          onMouseLeave={() => setHover(null)}
        >
          <div className="relative" style={{ width: contentW, height: PLOT_H + LABELS_H }}>
            <svg width={contentW} height={PLOT_H} className="absolute left-0 top-0 block overflow-visible" aria-hidden="true">
              {scale.ticks.map(t => (
                <line
                  key={t}
                  x1={0}
                  x2={contentW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? '#cbd5e1' : '#f1f5f9'}
                  strokeDasharray={t === 0 ? undefined : '3 3'}
                />
              ))}
              {points.map((p, i) => {
                const opacity = selIdx < 0 ? (hover === i ? 1 : 0.85) : isSelected(p) ? 1 : hover === i ? 0.85 : 0.4
                const left = cx(i) - BAR_GAP / 2 - BAR_W
                return (
                  <g key={`${p.year}-${p.month}`} opacity={opacity}>
                    <Stack
                      x={left}
                      zero={zero}
                      px={px}
                      segments={[
                        { value: active.attendance ? p.attendance : 0, color: COLORS.attendance },
                        { value: active.transport ? p.transport : 0, color: COLORS.transport }
                      ]}
                    />
                    <Stack
                      x={cx(i) + BAR_GAP / 2}
                      zero={zero}
                      px={px}
                      segments={[
                        { value: active.operating ? p.operating : 0, color: COLORS.operating },
                        { value: active.personal ? p.personal : 0, color: COLORS.personal }
                      ]}
                    />
                  </g>
                )
              })}
              {linePoints.length > 1 && (
                <path d={smoothPath(linePoints)} fill="none" stroke={COLORS.result} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              )}
              {linePoints.map((pt, i) => (
                <circle
                  key={i}
                  cx={pt.x}
                  cy={pt.y}
                  r={hover === i || i === selIdx ? 4.5 : 3.5}
                  fill={points[i].result < 0 ? '#e11d48' : COLORS.result}
                  stroke="#fff"
                  strokeWidth="1.5"
                />
              ))}
            </svg>

            {points.map((p, i) => (
              <span
                key={`l-${p.year}-${p.month}`}
                className={`absolute text-center text-[11px] ${isSelected(p) ? 'text-gray-900 font-semibold' : 'text-gray-400'}`}
                style={{ left: i * band, width: band, top: PLOT_H + 6 }}
                aria-hidden="true"
              >
                {axisLabel(p, axis)}
              </span>
            ))}

            {/* Zonas de toque: todo el alto de la columna, más grandes que las barras */}
            {points.map((p, i) => (
              <button
                key={`b-${p.year}-${p.month}`}
                type="button"
                aria-label={pointLabel(p, axis)}
                aria-pressed={isSelected(p)}
                onClick={() => onSelect({ year: p.year, month: p.month })}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="absolute top-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                style={{ left: i * band, width: band, height: PLOT_H + LABELS_H }}
              />
            ))}

            {tip && (
              <div
                className="absolute z-10 top-0 pointer-events-none"
                style={tipLeft ? { left: Math.max(4, cx(hover) - 16) } : { right: Math.max(4, contentW - cx(hover) - 16) }}
              >
                <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-3 py-2 whitespace-nowrap">
                  <p className="text-[11px] font-semibold text-gray-900 mb-1">{pointLabel(tip, 'month')}</p>
                  <TipRow color={COLORS.attendance} label="Asistencia" value={money(tip.attendance)} />
                  <TipRow color={COLORS.transport} label="Transporte" value={money(tip.transport)} />
                  <TipRow color={COLORS.personal} label="Personal" value={money(tip.personal)} />
                  <TipRow color={COLORS.operating} label="Gastos (fijos en caja)" value={money(tip.operating)} />
                  <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                    <TipRow
                      color={COLORS.result}
                      label="Resultado"
                      value={money(tip.result)}
                      valueClass={tip.result < 0 ? 'text-rose-600' : 'text-gray-900'}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Los mismos números como tabla, para quien no ve el gráfico */}
      <div className="sr-only">
        <table>
          <caption>Ingresos, gastos y resultado por mes, sin IVA</caption>
          <thead>
            <tr>
              <th scope="col">Mes</th>
              <th scope="col">Asistencia</th>
              <th scope="col">Transporte</th>
              <th scope="col">Personal</th>
              <th scope="col">Gastos con fijos en caja</th>
              <th scope="col">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {points.map(p => (
              <tr key={`t-${p.year}-${p.month}`}>
                <th scope="row">{pointLabel(p, 'month')}</th>
                <td>{money(p.attendance)}</td>
                <td>{money(p.transport)}</td>
                <td>{money(p.personal)}</td>
                <td>{money(p.operating)}</td>
                <td>{money(p.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
