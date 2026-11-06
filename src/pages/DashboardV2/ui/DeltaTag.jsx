import { formatCompact } from '../../../utils/format'
import { DASH, formatDecimal, money } from '../format'

// Variación de un KPI contra otro período. change: { base, diff, pct } (o un número,
// que se toma como pct). unit:
//   '%'  porcentaje sobre la base; si la base es 0 (sin pct) va la diferencia en pesos
//   'pp' puntos porcentuales (pct trae la diferencia en puntos)
//   'n'  unidades enteras (clientes, meses): con una base de medio centenar, un
//        cliente es más de dos puntos y el porcentaje exagera lo que es un alta
// invert: subir es malo (bajas, churn, MRR perdido), así que el aumento va en rojo.
export function deltaView(change, { unit = '%', invert = false } = {}) {
  const c = typeof change === 'number' ? { pct: change, diff: change, base: 1 } : change
  const raw = c == null ? null : unit === 'n' ? c.diff : unit === 'pp' || c.pct != null ? c.pct : c.diff
  if (raw == null || !Number.isFinite(raw)) return { text: DASH, tone: 'none', inMoney: false }
  const inMoney = unit !== 'pp' && unit !== 'n' && c.pct == null
  // Decide el número impreso, no el interno: 0,02 pp se imprime 0,0 y una flecha
  // ahí es mentira. Contra un promedio la variación en unidades puede ser
  // fraccionaria (1 baja contra 1,33): va con un decimal.
  const decimals = unit === 'pp' || (unit === 'n' && !Number.isInteger(raw)) ? 1 : 0
  const shown = inMoney ? Math.round(Math.abs(raw)) : Number(Math.abs(raw).toFixed(decimals))
  if (shown === 0) return { text: '=', tone: 'flat', inMoney }
  const up = raw > 0
  const figure = inMoney
    ? formatCompact(Math.abs(raw))
    : `${formatDecimal(Math.abs(raw), decimals)}${unit === 'pp' ? ' pp' : unit === 'n' ? '' : '%'}`
  return { text: `${up ? '↑' : '↓'}${figure}`, tone: up !== invert ? 'good' : 'bad', inMoney }
}

const TONE = { none: 'text-gray-300', flat: 'text-gray-400', good: 'text-emerald-700', bad: 'text-rose-600' }

// Dos celdas de una grilla de dos columnas (rótulo | variación): FinKpi las alinea.
export default function DeltaTag({ change, label, note, invert = false, unit = '%' }) {
  const view = deltaView(change, { unit, invert })
  const help = [
    note,
    view.tone === 'none' ? 'Sin dato para comparar.'
      : view.inMoney ? `La base era ${money(change?.base)}: sobre una base en cero el porcentaje no dice nada, así que va la diferencia en pesos.`
      : invert ? 'Acá subir es en contra: por eso el aumento va en rojo.'
      : null
  ].filter(Boolean).join(' ') || undefined
  return (
    <>
      <span className="text-[10.5px] text-gray-400 leading-[1.35] text-right whitespace-nowrap">{label}</span>
      <span title={help} className={`text-[11px] font-semibold tabular-nums leading-[1.35] text-right whitespace-nowrap ${TONE[view.tone]}`}>
        {view.text}
      </span>
    </>
  )
}
