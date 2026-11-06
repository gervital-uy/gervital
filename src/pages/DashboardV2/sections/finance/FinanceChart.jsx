import { useState } from 'react'
import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import { ExplainProvider } from '../../explain/ExplainContext'
import Segmented from '../../ui/Segmented'
import { MONTH_FULL, MONTH_SHORT, money, pctText } from '../../format'
import { change } from '../../../../services/dashboardV2/financeSeriesV2'
import {
  ALL_MONTHS, DEFAULT_RANGE, RANGES, availableYears, axisMode, hasSameMonthBefore, marginPoints, moneyHeadline,
  moneyPoint, periodRows, periodTable, sameMonthBefore, suggestedTarget, trendPoint
} from '../../../../services/dashboardV2/financeView'
import MoneyChart from './MoneyChart'
import IncomeCostTrendChart from './IncomeCostTrendChart'
import MarginTrendChart from './MarginTrendChart'
import MultiSelectFilter from './MultiSelectFilter'
import MarginTargetControl from './MarginTargetControl'
import PeriodTable from './PeriodTable'
import { useMarginTarget } from './useMarginTarget'
import { chartExplainContext } from './chartContext'
import { COLORS, MARGIN_LINES, changeText, longMonth, periodCaption } from './financeText'

const VIEWS = [
  { id: 'money', label: 'Pesos' },
  { id: 'trend', label: 'Tendencia' },
  { id: 'margins', label: 'Márgenes' }
]
const TITLES = { money: 'Mes a mes, en pesos', trend: 'A ingresar al banco contra costo total', margins: 'Evolución de márgenes' }
const RANGE_OPTIONS = RANGES.map(r => ({ id: r, label: `${r}M` }))
const MONTH_OPTIONS = ALL_MONTHS.map(m => ({ id: m, label: MONTH_SHORT[m] }))
const MONEY_LEGEND = [
  { key: 'attendance', label: 'Asistencia', color: COLORS.attendance },
  { key: 'transport', label: 'Transporte', color: COLORS.transport },
  { key: 'operating', label: 'Gastos', color: COLORS.operating },
  { key: 'personal', label: 'Personal', color: COLORS.personal },
  { key: 'result', label: 'Resultado', color: COLORS.result }
]
const ALL_ON = { attendance: true, transport: true, operating: true, personal: true, result: true }
const STAT_LABEL = 'text-[10px] font-semibold uppercase tracking-wide text-gray-400'

// Un término de la leyenda de Márgenes con su definición al pasar el cursor o con
// el foco. La ficha la dibuja la fila (anclada a su ancho, no se sale de la tarjeta).
function LegendTerm({ color, label, active, onHover }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span
        tabIndex={0}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        className={`font-medium border-b border-dotted cursor-help outline-none transition-colors ${active ? 'text-gray-900 border-gray-400' : 'text-gray-600 border-gray-300'}`}
      >
        {label}
      </span>
    </span>
  )
}

// Gráfico principal de Finanzas: tres lecturas del mismo período (Pesos, Tendencia y
// Márgenes), un solo control de período para las tres y la meta de margen neto. Todo
// sin IVA y sobre lo que tiene que entrar al banco. Tiene su propio contexto de
// explicaciones: sus fichas hablan del período y del punto que se ve, no solo del mes.
//   lastClosed: el último mes cerrado ({ year, month }), para la meta sugerida.
export default function FinanceChart({ series, selected, onSelectMonth, lastClosed }) {
  const [view, setView] = useState('money')
  // Ventana de meses seguidos (6/12/24) o, con null, el cruce de años por meses.
  const [range, setRange] = useState(DEFAULT_RANGE)
  const [years, setYears] = useState(() => [selected.year])
  const [months, setMonths] = useState(ALL_MONTHS)
  // Interanual sigue al mes que muestra el tablero hasta que se toque el filtro de meses.
  const [followMonth, setFollowMonth] = useState(false)
  const [active, setActive] = useState(ALL_ON)
  const [term, setTerm] = useState(null)
  const target = useMarginTarget()
  const [preview, setPreview] = useState(undefined)
  const [simulated, setSimulated] = useState(null)

  const seriesYears = availableYears(series)
  const canYears = seriesYears.length > 1
  const canYoY = hasSameMonthBefore(series, selected.year, selected.month)
  const isWindow = range != null
  const filterMonths = followMonth ? [selected.month] : months
  const period = isWindow
    ? { mode: 'window', range }
    : { mode: 'filter', years: canYears ? years : seriesYears, months: filterMonths }
  const rows = periodRows(series, selected, period)
  const axis = axisMode(rows, isWindow)
  const moneyPoints = rows.map(moneyPoint)
  const trend = rows.map(trendPoint)
  const margins = marginPoints(rows)
  const focusTrend = trend[trend.length - 1] || null
  const compTrend = focusTrend ? sameMonthBefore(trend, focusTrend) : null
  const focusMargin = margins[margins.length - 1] || null
  const headline = moneyHeadline(series, selected.year, selected.month)
  const table = isWindow ? [] : periodTable(trend)
  const suggestion = lastClosed ? suggestedTarget(series, lastClosed.year, lastClosed.month) : null
  const savedTarget = target.status === 'error' ? simulated : target.value
  const shownTarget = preview !== undefined ? preview : savedTarget

  const latest = series[series.length - 1]
  const atLatest = !!latest && selected.year === latest.year && selected.month === latest.month
  const dirty = range !== DEFAULT_RANGE || !atLatest
  const reset = () => {
    setRange(DEFAULT_RANGE)
    setFollowMonth(false)
    setYears(latest ? [latest.year] : [selected.year])
    setMonths(ALL_MONTHS)
    if (latest && !atLatest) onSelectMonth({ year: latest.year, month: latest.month })
  }
  const applyYoY = () => {
    setYears(seriesYears)
    setFollowMonth(true)
    setRange(null)
  }
  const yoyOn = !isWindow && followMonth

  const startName = series.length ? longMonth(series[0]) : ''
  const yearsReason = `La serie arranca en ${startName}: el filtro de años se habilita cuando haya meses de más de un año.`
  const yoyReason = `Interanual compara ${MONTH_FULL[selected.month]} contra el mismo mes de los años anteriores, y la serie todavía no tiene ${MONTH_FULL[selected.month]} de ${selected.year - 1} (arranca en ${startName}).`
  const historyNote = !canYears && !canYoY
    ? `Años e Interanual se habilitan cuando la serie tenga más de un año: arranca en ${startName}.`
    : !canYoY ? yoyReason : null

  const caption = periodCaption(rows, range)
  const subtitle = {
    money: `${caption} · sin IVA · ingreso: lo que tiene que entrar al banco · gastos fijos en su mes de pago`,
    trend: `${caption} · sin IVA · fijos mensualizados · el área entre las líneas es el resultado`,
    margins: `${caption} · % sobre lo que tiene que entrar al banco · fijos mensualizados`
  }[view]
  const noRows = !isWindow && rows.length === 0
  const noHistory = !isWindow && rows.length === 1
  const activeTerm = MARGIN_LINES.find(l => l.key === term) || null

  const ctx = chartExplainContext({
    view,
    selected,
    headline,
    trend,
    margins,
    table,
    target: { value: savedTarget, shown: shownTarget, persisted: target.status !== 'error' },
    suggestion
  })

  return (
    <ExplainProvider ctx={ctx}>
      <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 px-4 sm:px-6 pt-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-gray-900 flex items-center gap-1.5">
              {TITLES[view]}
              {view === 'money' && <InfoButton id="finChartMoney" />}
              {view === 'trend' && <InfoButton id="finChartTrend" />}
              {view === 'margins' && <InfoButton id="finChartMargins" />}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
          </div>

          {view === 'money' && headline && (
            <div className="sm:text-right shrink-0">
              <p className={STAT_LABEL}>Resultado de {MONTH_SHORT[selected.month]} · fijos en caja</p>
              <div className="flex items-baseline sm:justify-end gap-2 mt-1.5">
                <span className={`text-2xl leading-none font-semibold tracking-tight tabular-nums ${headline.result < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
                  {money(headline.result)}
                </span>
                {headline.change && (
                  <span className="inline-flex items-baseline gap-1.5 shrink-0" title={`${longMonth(headline.prev)} cerró en ${money(headline.prev.result)}`}>
                    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums ${headline.change.diff >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                      {changeText(headline.change)}
                    </span>
                    <span className="text-[11px] text-gray-400">vs {MONTH_SHORT[headline.prev.month]}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {view === 'trend' && focusTrend && (
            <div className="flex items-start gap-5 shrink-0">
              <div className="sm:text-right">
                <p className={STAT_LABEL}>Resultado de {MONTH_SHORT[focusTrend.month]}</p>
                <p className={`text-[18px] leading-none font-semibold tabular-nums mt-1.5 ${focusTrend.result < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {money(focusTrend.result)}
                </p>
              </div>
              <div className="sm:text-right">
                <p className={STAT_LABEL}>Margen neto</p>
                <p className={`text-[18px] leading-none font-semibold tabular-nums mt-1.5 ${focusTrend.result < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {pctText(focusTrend.netPct, 0)}
                </p>
              </div>
              {compTrend && (
                <div className="sm:text-right">
                  <p className={STAT_LABEL}>vs {compTrend.year}</p>
                  <p className={`text-[18px] leading-none font-semibold tabular-nums mt-1.5 ${focusTrend.result >= compTrend.result ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {changeText(change(focusTrend.result, compTrend.result))}
                  </p>
                </div>
              )}
            </div>
          )}

          {view === 'margins' && focusMargin && (
            <div className="flex items-start gap-5 shrink-0">
              {MARGIN_LINES.map(l => (
                <div key={l.key} className="sm:text-right">
                  <p className={`${STAT_LABEL} flex items-center sm:justify-end gap-1.5`}>
                    <span className="w-2 h-2 rounded-full" style={{ background: l.color }} />
                    {l.label} · {MONTH_SHORT[focusMargin.month]}
                  </p>
                  <p className={`text-[19px] leading-none font-semibold tabular-nums mt-1 ${focusMargin[l.key] < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
                    {pctText(focusMargin[l.key], 0)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Un solo control de período para las tres vistas: nada aparece ni desaparece
            al elegir, la opción elegida queda marcada. */}
        <div className="flex items-center gap-2 flex-wrap px-4 sm:px-6 pt-4">
          <Segmented label="Vista del gráfico" options={VIEWS} value={view} onChange={setView} />
          <span className="hidden sm:block w-px h-5 bg-gray-200 mx-0.5 shrink-0" />
          <Segmented
            label="Meses seguidos"
            options={RANGE_OPTIONS}
            value={range}
            onChange={r => { setRange(r); setFollowMonth(false) }}
          />
          <MultiSelectFilter
            title="Años"
            unit="años"
            options={seriesYears.map(y => ({ id: y, label: String(y) }))}
            selection={canYears ? years : seriesYears}
            active={!isWindow}
            disabled={!canYears}
            disabledReason={yearsReason}
            onChange={next => { setYears(next); setRange(null) }}
          />
          <MultiSelectFilter
            title="Meses"
            unit="meses"
            options={MONTH_OPTIONS}
            selection={filterMonths}
            active={!isWindow}
            columns={3}
            width={210}
            onChange={next => { setMonths(next); setFollowMonth(false); setRange(null) }}
          />
          <button
            type="button"
            onClick={applyYoY}
            disabled={!canYoY}
            aria-pressed={yoyOn}
            title={canYoY ? `Compara ${MONTH_FULL[selected.month]} contra el mismo mes de los años anteriores. Sigue al mes que estés viendo.` : yoyReason}
            className={`text-[11px] font-semibold rounded-lg px-2.5 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:text-gray-300 disabled:cursor-not-allowed ${
              yoyOn ? 'bg-gray-900 text-white' : 'text-gray-500 enabled:hover:bg-gray-100'
            }`}
          >
            Interanual
          </button>
          {/* Vuelve al arranque (12 meses, parado en el mes en curso) en un gesto */}
          {dirty && (
            <button
              type="button"
              onClick={reset}
              title="Volver a los últimos 12 meses, parado en el mes en curso"
              className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              Limpiar
            </button>
          )}
        </div>
        {historyNote && <p className="px-4 sm:px-6 pt-2 text-[10.5px] text-gray-400">{historyNote}</p>}

        {noRows && (
          <p role="status" className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg mx-4 sm:mx-6 mt-4 px-3 py-2">
            Esa combinación de años y meses no deja ningún mes de la serie. Ampliá alguno de los dos filtros.
          </p>
        )}
        {noHistory && (
          <p role="status" className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg mx-4 sm:mx-6 mt-4 px-3 py-2">
            Con este filtro queda un solo mes ({longMonth(rows[0])}), así que no hay con qué compararlo. La comparación
            entre años necesita historia: la serie arranca en {startName}.
          </p>
        )}

        <div className="px-4 sm:px-6 pt-5 pb-2">
          {view === 'money' ? (
            <MoneyChart points={moneyPoints} selected={selected} onSelect={onSelectMonth} active={active} axis={axis} />
          ) : view === 'trend' ? (
            <IncomeCostTrendChart points={trend} axis={axis} />
          ) : (
            <MarginTrendChart points={margins} target={shownTarget} axis={axis} />
          )}
        </div>

        {view === 'money' && (
          <div className="flex gap-1.5 flex-wrap px-4 sm:px-6 pb-5 pt-1" role="group" aria-label="Series del gráfico">
            {MONEY_LEGEND.map(s => (
              <button
                key={s.key}
                type="button"
                aria-pressed={active[s.key]}
                onClick={() => setActive(a => ({ ...a, [s.key]: !a[s.key] }))}
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-1 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${active[s.key] ? 'bg-gray-50 text-gray-700' : 'text-gray-300'}`}
              >
                <span
                  className={s.key === 'result' ? 'w-3 h-0.5 rounded-full' : 'w-2 h-2 rounded-full'}
                  style={{ background: s.color, opacity: active[s.key] ? 1 : 0.4 }}
                />
                {s.label}
              </button>
            ))}
          </div>
        )}

        {view === 'trend' && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 sm:px-6 pb-5 pt-1">
            <span className="inline-flex items-baseline gap-1.5 text-[11px] text-gray-400">
              <span className="w-2 h-2 rounded-full shrink-0 translate-y-[-1px]" style={{ background: COLORS.income }} />
              <span className="font-medium text-gray-600">A ingresar al banco</span>
              lo que tiene que entrar en el mes, sin IVA
            </span>
            <span className="inline-flex items-baseline gap-1.5 text-[11px] text-gray-400">
              <span className="w-2 h-2 rounded-full shrink-0 translate-y-[-1px]" style={{ background: COLORS.costs }} />
              <span className="font-medium text-gray-600">Costo total</span>
              personal y todos los gastos
            </span>
            <span className="inline-flex items-baseline gap-1.5 text-[11px] text-gray-400">
              <span className="w-2 h-2 rounded-sm shrink-0 translate-y-[-1px]" style={{ background: COLORS.positiveArea }} />
              <span className="font-medium text-gray-600">Área</span>
              el resultado, en rosa si el costo supera al ingreso
            </span>
          </div>
        )}

        {view === 'margins' && (
          <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-6 pb-5 pt-1">
            {MARGIN_LINES.map(l => (
              <LegendTerm key={l.key} color={l.color} label={l.label} active={term === l.key} onHover={on => setTerm(on ? l.key : null)} />
            ))}
            <div className="ml-auto flex items-center gap-1">
              <MarginTargetControl
                value={savedTarget}
                status={target.status}
                suggestion={suggestion}
                onPreview={setPreview}
                onSave={target.save}
                onSimulate={setSimulated}
              />
              <InfoButton id="finTarget" />
            </div>
            {activeTerm && (
              <div className="absolute z-30 bottom-full left-4 right-4 sm:left-6 sm:right-6 mb-2 pointer-events-none">
                <div className="inline-block max-w-[360px] rounded-xl border border-gray-200 bg-white shadow-lg px-3 py-2">
                  <p className="text-[11px] font-semibold text-gray-900 mb-0.5 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: activeTerm.color }} />
                    {activeTerm.label}
                  </p>
                  <p className="text-[11px] text-gray-500 leading-snug">{activeTerm.description}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {table.length > 1 && <PeriodTable rows={table} />}
      </Card>
    </ExplainProvider>
  )
}
