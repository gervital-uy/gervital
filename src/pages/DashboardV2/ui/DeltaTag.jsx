import { formatCompact } from '../../../utils/format'
import { DASH, formatDecimal, money } from '../format'

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const NBSP = String.fromCharCode(160)

// Variación de un KPI contra una referencia, como texto y tono. Una sola regla para
// todas las pestañas (las tarjetas, los globos y las tablas de los gráficos):
//   change: { diff, pct, base } (change() de financeSeriesV2) o un número, que se
//   toma como pct.
//   unit: '%'  porcentaje; con una base cero o negativa el porcentaje engaña (de
//              −9.400 a +111.800 daría −1289%) y va la diferencia en pesos;
//         'pp' puntos porcentuales (un margen contra otro); sin pct, la diferencia;
//         'n'  unidades (clientes, meses): con una base chica un cliente es varios
//              puntos, y el porcentaje exagera lo que es un alta.
//   invert: subir es en contra (gastos, bajas): el aumento va en rojo.
// La flecha la decide el número que se muestra: 0,02 pp o −0,07% se imprimen "=", no
// "↑0,0" ni "↓0%". tone: 'none' (sin dato), 'flat', 'good' o 'bad'.
export function deltaView(change, { unit = '%', invert = false } = {}) {
  const c = isNum(change) ? { diff: change, pct: change, base: null } : change
  const inMoney = unit === '%' && c != null && !isNum(c.pct)
  const raw = c == null ? null : unit === 'pp' ? (isNum(c.pct) ? c.pct : c.diff) : unit === 'n' || inMoney ? c.diff : c.pct
  if (!isNum(raw)) return { text: DASH, tone: 'none', inMoney: false }
  // Contra un promedio la variación en unidades puede ser fraccionaria: un decimal.
  const decimals = unit === 'pp' || (unit === 'n' && !Number.isInteger(raw)) ? 1 : 0
  const shown = inMoney ? Math.round(Math.abs(raw)) : Number(Math.abs(raw).toFixed(decimals))
  if (shown === 0) return { text: '=', tone: 'flat', inMoney }
  const up = raw > 0
  const figure = inMoney
    ? `$${NBSP}${formatCompact(Math.abs(raw))}`
    : `${formatDecimal(Math.abs(raw), decimals)}${unit === 'pp' ? ' pp' : unit === '%' ? '%' : ''}`
  return { text: `${up ? '↑' : '↓'}${figure}`, tone: up !== invert ? 'good' : 'bad', inMoney }
}

// Color del texto de una variación según su tono.
export const DELTA_TEXT = { none: 'text-gray-300', flat: 'text-gray-400', good: 'text-emerald-700', bad: 'text-rose-600' }

// Dos celdas, rótulo y número, para una grilla de dos columnas: así se alinean entre
// filas (FinKpi).
export default function DeltaTag({ change, label, note, invert = false, unit = '%' }) {
  const view = deltaView(change, { unit, invert })
  const help = [
    note,
    view.tone === 'none' ? 'Sin dato para comparar.'
      : view.inMoney ? `La base era ${money(change?.base)}: con una base cero o negativa el porcentaje engaña, así que va la diferencia en pesos.`
      : invert ? 'Acá subir es en contra: por eso un aumento va en rojo.'
      : null
  ].filter(Boolean).join(' ')
  return (
    <>
      <span className="text-[10.5px] text-gray-400 leading-[1.35] text-right whitespace-nowrap">{label}</span>
      <span title={help || undefined} className={`text-[11px] font-semibold tabular-nums leading-[1.35] text-right whitespace-nowrap ${DELTA_TEXT[view.tone]}`}>
        {view.text}
      </span>
    </>
  )
}
