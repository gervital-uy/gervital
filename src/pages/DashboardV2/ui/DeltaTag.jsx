import { formatCompact } from '../../../utils/format'
import { DASH, formatDecimal, money } from '../format'

const isNum = v => typeof v === 'number' && Number.isFinite(v)

// Variación de un KPI contra una referencia: verde cuando el cambio es a favor y rojo
// cuando es en contra (`invert`: en gastos o bajas, subir es en contra). Devuelve dos
// celdas, rótulo y número, para una grilla de dos columnas: así se alinean entre filas.
//   change: { diff, pct, base } (change() de financeSeriesV2) o un número.
//   unit: '%'  porcentaje; con una base cero o negativa el porcentaje engaña (de
//              −9.400 a +111.800 daría −1289%) y va la diferencia en pesos;
//         'pp' puntos porcentuales (un margen contra otro);
//         'n'  unidades (clientes, meses): con una base chica un cliente es varios
//              puntos, y el porcentaje exagera lo que es un alta.
// La flecha la decide el número que se muestra: 0,02 pp se imprime "=", no "↑0,0".
export default function DeltaTag({ change, label, note, invert = false, unit = '%' }) {
  const c = isNum(change) ? { diff: change, pct: change, base: null } : change
  const inPesos = unit === '%' && c != null && !isNum(c.pct)
  const raw = c == null ? null : unit === 'pp' ? (isNum(c.pct) ? c.pct : c.diff) : unit === 'n' || inPesos ? c.diff : c.pct
  const missing = !isNum(raw)
  const decimals = unit === 'pp' || (unit === 'n' && !Number.isInteger(raw)) ? 1 : 0
  const flat = !missing && (inPesos ? Math.round(raw) === 0 : Number(Math.abs(raw).toFixed(decimals)) === 0)
  const up = !missing && raw >= 0
  const good = invert ? !up : up
  const arrow = up ? '↑' : '↓'
  const suffix = unit === 'pp' ? ' pp' : unit === '%' ? '%' : ''
  const text = missing ? DASH
    : flat ? '='
    : inPesos ? `${arrow}$ ${formatCompact(Math.abs(raw))}`
    : `${arrow}${formatDecimal(Math.abs(raw), decimals)}${suffix}`
  const help = [
    note,
    missing ? 'Sin dato para comparar.'
      : inPesos ? `La base era ${money(c.base)}: con una base cero o negativa el porcentaje engaña, así que va la diferencia en pesos.`
      : invert ? 'Acá subir es en contra: por eso un aumento va en rojo.'
      : null
  ].filter(Boolean).join(' ')
  const tone = missing ? 'text-gray-300' : flat ? 'text-gray-400' : good ? 'text-emerald-700' : 'text-rose-600'
  return (
    <>
      <span className="text-[10.5px] text-gray-400 leading-[1.35] text-right whitespace-nowrap">{label}</span>
      <span title={help || undefined} className={`text-[11px] font-semibold tabular-nums leading-[1.35] text-right whitespace-nowrap ${tone}`}>
        {text}
      </span>
    </>
  )
}
