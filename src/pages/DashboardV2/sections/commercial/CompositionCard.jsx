import Card from '../../../../components/ui/Card'
import { segmentColor } from '../../ui/colors'
import { formatDecimal } from '../../format'
import { CARD } from './commercialText'
import DimensionHeader from './DimensionHeader'

// Composición de la base como gráfico de unidades: un cuadradito por cliente. El
// largo de la fila es la cantidad (se compara como una barra), las unidades se
// cuentan (el dato es exacto sin leer la etiqueta) y las filas van en el orden de
// la escala. Todas las filas comparten unidad: tantas columnas como la más grande.
function UnitsChart({ rows, total }) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1
  const biggest = rows.reduce((a, b) => (b.value > a.value ? b : a), rows[0])
  return (
    <div className="flex flex-col gap-2">
      {rows.map(r => {
        const pct = total > 0 ? (r.value / total) * 100 : 0
        const strong = r.key === biggest.key
        return (
          <div key={r.key} className="flex items-center gap-3">
            <span className="flex items-center gap-2 min-w-0 shrink-0 w-[104px]">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: r.color }} />
              <span className={`text-[12.5px] truncate ${strong ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>{r.label}</span>
            </span>
            <span
              className="flex-1 min-w-0 grid items-center gap-[2px]"
              style={{ gridTemplateColumns: `repeat(${max}, minmax(0, 1fr))` }}
              title={`${r.value} de ${total} · ${formatDecimal(pct)}%`}
            >
              {Array.from({ length: r.value }, (_, k) => (
                <span key={k} className="h-[11px] rounded-[2px]" style={{ background: r.color }} />
              ))}
            </span>
            {/* Los números son el dato: cuerpo grande y en columna */}
            <span className="shrink-0 w-[66px] text-right tabular-nums leading-none">
              <span className={`text-[15px] font-semibold ${strong ? 'text-gray-900' : 'text-gray-700'}`}>{r.value}</span>
              <span className="text-[11.5px] text-gray-400 ml-1.5">{formatDecimal(pct, 0)}%</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function CompositionCard({ rows, dimension, onDimension }) {
  const colored = rows.map(r => ({ ...r, color: segmentColor(dimension, r.key) }))
  const total = rows.reduce((s, r) => s + r.value, 0)
  return (
    <Card role="group" aria-label="Composición de la base" className={CARD}>
      <DimensionHeader title="Composición de la base" infoId="composition" hint="Un cuadrado = un cliente" dimension={dimension} onDimension={onDimension} />
      <div className="px-5 pb-5">
        {colored.length === 0
          ? <p className="text-sm text-gray-400 py-8 text-center">No hay clientes activos.</p>
          : <UnitsChart rows={colored} total={total} />}
        <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-baseline justify-end gap-1.5">
          <span className="text-[12.5px] text-gray-500">Total</span>
          <span className="text-[15px] font-semibold text-gray-900 tabular-nums">{total}</span>
          <span className="text-[12px] text-gray-400">clientes activos</span>
        </div>
      </div>
    </Card>
  )
}
