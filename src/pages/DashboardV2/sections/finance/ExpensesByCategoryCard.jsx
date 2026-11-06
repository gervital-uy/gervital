import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import { formatDecimal, money, pctText } from '../../format'
import { CARD_CLASS, COST_DELTA } from './cardsText'
import { longMonth, shortMonth } from './financeText'

const BAR = '#828df4'
const TYPE_LABELS = { fixed: 'fijo', variable: 'variable', extraordinary: 'extraordinario' }
const ROW = 'grid grid-cols-[minmax(110px,1.25fr)_minmax(0,1.6fr)_auto_auto] gap-x-3 items-center'

const sign = v => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat')
const arrow = v => (v > 0 ? '▲' : v < 0 ? '▼' : '=')

// Cómo se reparte una categoría entre los tipos de movimiento, para el title.
const typesText = byType => Object.entries(byType).filter(([, v]) => v > 0).map(([t, v]) => `${TYPE_LABELS[t]} ${money(v)}`).join(' + ')

// Gastos del mes sin el personal, por categoría, contra el mes anterior.
export default function ExpensesByCategoryCard({ categories, prev, monthLabel, income, personal, expenses }) {
  const { rows, total, delta, deltaPct } = categories
  const top = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1
  const prevShort = prev ? shortMonth(prev) : null

  return (
    <Card className={CARD_CLASS}>
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
            Gastos por categoría
            <InfoButton id="finCategories" />
          </h3>
          <p className="text-xs text-gray-400 mt-0.5"><span className="capitalize">{monthLabel}</span> · sin el personal · fijos mensualizados</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[19px] leading-none font-semibold tabular-nums text-gray-900">{money(total)}</p>
          {delta != null && (
            <p className="text-[11.5px] mt-1.5 tabular-nums" style={{ color: COST_DELTA[sign(delta)] }}>
              {arrow(delta)} {money(Math.abs(delta))}
              {deltaPct != null && <span className="text-gray-400"> · {formatDecimal(Math.abs(deltaPct), 1)}% vs {longMonth(prev)}</span>}
            </p>
          )}
          {income > 0 && <p className="text-[11px] text-gray-400 mt-0.5 tabular-nums">{pctText((total / income) * 100, 0)} de los ingresos</p>}
        </div>
      </div>

      <div className="px-5 overflow-x-auto">
        <div className="min-w-[440px]">
          <div className={`${ROW} text-[10px] font-medium text-gray-400 uppercase tracking-wide pb-2 border-b border-gray-100`}>
            <span>Categoría</span>
            <span />
            <span className="text-right min-w-[88px]">Mes</span>
            <span className="text-right min-w-[112px]">{prevShort ? `vs ${prevShort}` : 'vs mes anterior'}</span>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No hay gastos cargados en Costos para este mes.</p>
          ) : rows.map(r => (
            <div
              key={r.label}
              className={`${ROW} py-[7px] border-b border-gray-50 last:border-b-0`}
              title={[prev ? `${shortMonth(prev)}: ${money(r.prev)}` : null, typesText(r.byType)].filter(Boolean).join(' · ')}
            >
              <span className="text-[12.5px] text-gray-700 truncate">{r.label}</span>
              <div className="relative h-2">
                <div className="absolute left-0 top-0 bottom-0 rounded-r" style={{ width: `${(r.value / top) * 100}%`, background: BAR }} />
              </div>
              <span className="text-right tabular-nums whitespace-nowrap min-w-[88px]">
                <span className="text-[12.5px] text-gray-900">{money(r.value)}</span>
                <span className="text-[10.5px] text-gray-400 ml-1.5">{total > 0 ? `${Math.round((r.value / total) * 100)}%` : ''}</span>
              </span>
              <span className="text-right tabular-nums whitespace-nowrap text-[11.5px] min-w-[112px]">
                {r.delta == null ? (
                  <span className="text-gray-300">—</span>
                ) : r.prev === 0 ? (
                  <span className="text-gray-400">nuevo</span>
                ) : (
                  <>
                    <span style={{ color: COST_DELTA[sign(r.delta)] }}>{arrow(r.delta)} {r.delta === 0 ? '' : money(Math.abs(r.delta))}</span>
                    {r.deltaPct != null && r.delta !== 0 && <span className="text-gray-400 ml-1.5">{Math.round(Math.abs(r.deltaPct))}%</span>}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 py-3.5 mt-1 border-t border-gray-100">
        <p className="text-[11.5px] text-gray-400 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span>El personal tiene su propio desglose arriba</span>
          <span className="tabular-nums text-gray-500">
            <span className="font-medium">{money(personal)}</span>
            {expenses > 0 && ` · ${pctText((personal / expenses) * 100, 0)} del gasto total`}
          </span>
        </p>
      </div>
    </Card>
  )
}
