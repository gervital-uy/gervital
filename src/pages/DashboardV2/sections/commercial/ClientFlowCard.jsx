import { useEffect, useMemo, useState } from 'react'
import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import MetricTabs from '../../ui/MetricTabs'
import { MONTH_FULL, MONTH_SHORT } from '../../format'
import ClientFlowChart from './ClientFlowChart'
import { CARD, coverage } from './commercialText'

const MODES = [{ value: 'months', label: '12 meses' }, { value: 'years', label: 'Interanual' }]

const toChartRow = label => r => ({
  key: `${r.year}-${r.month}`,
  label: label(r),
  entries: r.altas,
  exits: r.bajas,
  returns: r.returns,
  closing: r.closing,
  partial: r.partial
})

// Altas contra bajas: los meses seguidos que cierran en el mes elegido (hasta 12),
// o ese mismo mes en cada año con el centro operando.
export default function ClientFlowCard({ month }) {
  const [mode, setMode] = useState('months')
  // La línea de variación arranca visible: es la lectura que importa
  const [showTrend, setShowTrend] = useState(true)
  // El mes que se compara entre años sigue al navegador, pero se puede elegir otro
  const [compareMonth, setCompareMonth] = useState(month.month)
  useEffect(() => { setCompareMonth(month.month) }, [month.month])

  const flowRows = useMemo(() => month.flow.map(toChartRow(r => MONTH_SHORT[r.month])), [month])
  // Años con datos de cada mes calendario: un mes sin el centro operando no es un
  // cero, es un dato que no existe, y no se dibuja.
  const yearsByMonth = useMemo(() => MONTH_SHORT.map((_, m) => month.sameMonth(m)), [month])
  const yearRows = yearsByMonth[compareMonth].map(toChartRow(r => String(r.year)))

  const covered = coverage(flowRows.length, 12)
  return (
    <Card role="group" aria-label="Altas vs Bajas" className={CARD}>
      <div className="px-5 pt-4 pb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
            Altas vs Bajas
            <InfoButton id="clientFlow" />
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {mode === 'months'
              ? `Movimiento de clientes · últimos 12 meses${covered ? ` · ${covered}` : ''}`
              : `${MONTH_FULL[compareMonth]} de cada año · ${yearRows.length} ${yearRows.length === 1 ? 'año' : 'años'} con datos`}
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-start sm:items-end gap-1.5">
          <MetricTabs size="sm" options={MODES} value={mode} onChange={setMode} label="Período de altas y bajas" />
          <button
            type="button"
            onClick={() => setShowTrend(v => !v)}
            aria-pressed={showTrend}
            title="Muestra u oculta la línea de variación (altas − bajas) de cada período"
            className={`inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg border px-2.5 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              showTrend ? 'border-slate-300 bg-slate-700 text-white' : 'border-gray-200 bg-white text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 16l5-6 4 3 5-7 4 4" />
            </svg>
            Tendencia
          </button>
        </div>
      </div>

      <div className="px-5 pb-4">
        {mode === 'years' && (
          <div className="mb-2.5">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Mes a comparar</p>
            <div className="flex flex-wrap gap-1">
              {MONTH_SHORT.map((label, m) => {
                const years = yearsByMonth[m].length
                // Con un solo año no hay comparación: el mes queda deshabilitado y dice por qué
                const enabled = years >= 2
                const active = m === compareMonth
                return (
                  <button
                    key={label}
                    type="button"
                    disabled={!enabled}
                    aria-pressed={active}
                    onClick={() => setCompareMonth(m)}
                    title={enabled ? `${years} años con el centro operando en ${MONTH_FULL[m]}` : `Todavía no hay dos años para comparar ${MONTH_FULL[m]}`}
                    className={`text-[11.5px] font-semibold rounded-md px-2 py-[3px] border transition-colors ${
                      active ? 'border-slate-300 bg-slate-700 text-white'
                        : enabled ? 'border-gray-200 bg-white text-gray-500 hover:text-gray-800 hover:border-gray-300'
                        : 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {mode === 'years' && yearRows.length < 2 ? (
          <p className="text-sm text-gray-400 py-10 text-center">
            {MONTH_FULL[compareMonth]} tiene {yearRows.length === 1 ? 'un solo año' : 'ningún año'} con el centro operando: todavía no hay con qué comparar.
          </p>
        ) : (
          <ClientFlowChart rows={mode === 'months' ? flowRows : yearRows} showTrend={showTrend} mode={mode} />
        )}
        {mode === 'months' && flowRows.some(r => r.partial) && (
          <p className="mt-2 text-[10.5px] text-gray-400">* Mes en curso: cuenta hasta hoy.</p>
        )}
      </div>
    </Card>
  )
}
