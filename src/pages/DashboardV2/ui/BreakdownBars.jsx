import { formatDecimal, money as formatMoney } from '../format'

// Barras horizontales de un desglose (la de legacy en charts/ más dos opciones).
// keepOrder: cuando la dimensión es ordinal (1× a 5×, A a D, tramos de edad)
// las filas van en su orden natural; ordenarlas por tamaño desordena la rampa de
// color y obliga a leer la leyenda para entender la escala.
// row.pp (opcional): diferencia en puntos porcentuales entre la participación de la
// fila en el total y en otra base (en Aporte: cuánto factura un segmento contra
// cuánto pesa en clientes; row.revenuePct y row.clientsPct van en el title). Va en
// tinta neutra, no en verde/rojo: mide concentración, no desempeño.
export default function BreakdownBars({ rows, money = false, suffix = '', showPct = true, pctSuffix = ' del total', keepOrder = false }) {
  const list = (rows || []).filter(r => Number.isFinite(r?.value))
  const sorted = keepOrder ? list : [...list].sort((a, b) => b.value - a.value)
  const max = sorted.reduce((m, r) => Math.max(m, r.value), 0)
  const total = sorted.reduce((s, r) => s + r.value, 0)

  return (
    <div className="flex flex-col gap-[13px]">
      {sorted.map((row, i) => (
        <div key={`${row.label}-${i}`}>
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: row.color }} />
              <span className="text-[13px] text-gray-700 truncate">{row.label}</span>
            </div>
            <div className="flex items-baseline gap-1.5 flex-shrink-0">
              <span className="text-[13px] font-semibold text-gray-900 tabular-nums">
                {money ? formatMoney(row.value) : `${row.value}${suffix}`}
              </span>
              {showPct && total > 0 && (
                <span className="text-[11px] text-gray-400 tabular-nums">{Math.round((row.value / total) * 100)}%{pctSuffix}</span>
              )}
              {Number.isFinite(row.pp) && Math.abs(row.pp) >= 0.05 && (
                <span
                  className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap cursor-help"
                  title={row.revenuePct == null ? undefined : `Se lleva ${Math.round(row.revenuePct)}% de la facturación y es ${Math.round(row.clientsPct)}% de los clientes`}
                >
                  <span className="text-gray-400">{row.pp > 0 ? '▲' : '▼'}</span> {formatDecimal(Math.abs(row.pp))} pp
                </span>
              )}
            </div>
          </div>
          <div className="bg-gray-100 h-2 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${max > 0 ? (row.value / max) * 100 : 0}%`, background: row.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}
