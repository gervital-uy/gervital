import { Link } from 'react-router-dom'
import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import MetricTabs from '../../ui/MetricTabs'
import { formatDecimal, plural } from '../../format'
import { CARD, coverage } from './commercialText'

// Ventanas de Bajas por motivo, independientes del resto: con una o dos bajas por
// mes, la ventana corta detecta un cambio y la larga muestra el patrón. null = toda
// la historia cargada.
export const EXIT_WINDOWS = [
  { value: 6, label: '6M' },
  { value: 12, label: '12M' },
  { value: 24, label: '24M' },
  { value: 'all', label: 'Histórico' }
]
export const windowSize = value => (value === 'all' ? null : value)

// La barra va en un solo tono: mide tamaño, no identidad (el motivo está escrito al lado).
const BAR = '#828df4'
// La columna de la ventana anterior solo existe cuando hay ventana anterior: hasta
// entonces sería una fila de rayas que le quita el lugar al motivo, que es el dato.
// En el celular el motivo va en su propio renglón, con todo el ancho (al lado de la
// barra se cortaba), y la barra con los números abajo; desde sm, todo en una fila
// donde el motivo pasa a dos renglones antes que cortarse.
const COLS = 'grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(112px,1.3fr)_minmax(0,1.2fr)_auto]'
const COLS_PREV = 'grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(112px,1.3fr)_minmax(0,1.2fr)_auto_auto]'

// exits: activityTimeline.exitsByReason del mes con la ventana elegida.
export default function ExitsByReasonCard({ exits, windowValue, onWindow }) {
  const { rows, total, prev, months, requested } = exits
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1
  const covered = requested == null ? null : coverage(months, requested)
  const prevOf = key => (prev ? prev.find(p => p.key === key)?.value || 0 : null)
  const cols = prev ? COLS_PREV : COLS

  return (
    <Card role="group" aria-label="Bajas por motivo" className={CARD}>
      <div className="px-5 pt-5 pb-4 flex flex-wrap sm:flex-nowrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
            Bajas por motivo
            <InfoButton id="exitsByReason" />
          </h3>
          {/* El total va en el subtítulo: un 25% sobre 8 bajas son dos personas */}
          <p className="text-xs text-gray-400 mt-0.5">
            {requested == null ? 'Toda la historia cargada' : `Últimos ${requested} meses`}
            {covered && ` · ${covered}`}
            {' · '}{plural(total, 'baja', 'bajas')}
            {exits.pauses > 0 && ` · ${exits.pauses} en pausa temporal`}
          </p>
        </div>
        <MetricTabs size="sm" options={EXIT_WINDOWS} value={windowValue} onChange={onWindow} label="Ventana de bajas" />
      </div>

      <div className="px-5">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Sin bajas en el período.</p>
        ) : (
          <>
            <div className={`grid ${cols} gap-x-3 items-center text-[10px] font-medium text-gray-400 uppercase tracking-wide pb-2 border-b border-gray-100`}>
              <span>Motivo</span>
              {/* La columna de la barra: en el celular la barra va en el renglón de abajo */}
              <span className="hidden sm:block" />
              <span className="text-right min-w-[62px]">Bajas</span>
              {prev && <span className="text-right min-w-[58px]">vs {requested} m previos</span>}
            </div>
            {rows.map(r => {
              const before = prevOf(r.key)
              const delta = before == null ? null : r.value - before
              const share = (r.value / total) * 100
              return (
                <div
                  key={r.key}
                  className={`grid ${cols} gap-x-3 gap-y-1 items-center py-[7px] border-b border-gray-50 last:border-b-0`}
                  title={`${r.label}: ${plural(r.value, 'baja', 'bajas')} de ${total}, ${formatDecimal(share, 0)}%${before == null ? '' : `. En los ${requested} meses previos: ${before}.`}${r.pauses ? ` ${plural(r.pauses, 'en pausa temporal', 'en pausa temporal')}.` : ''}`}
                >
                  {/* El nombre entero siempre a la vista: en el celular no hay title */}
                  <span className="col-span-full sm:col-span-1 min-w-0 text-[12.5px] leading-snug text-gray-700 break-words">
                    {r.label}
                    {r.pauses > 0 && <span className="ml-1.5 text-[10px] text-gray-400 whitespace-nowrap">{r.pauses} en pausa</span>}
                  </span>
                  <div className="relative h-2">
                    <div className="absolute left-0 top-0 bottom-0 rounded-[2px_4px_4px_2px]" style={{ width: `${(r.value / max) * 100}%`, background: BAR }} />
                  </div>
                  <span className="text-right tabular-nums whitespace-nowrap min-w-[62px]">
                    <span className="text-[12.5px] text-gray-900">{r.value}</span>
                    <span className="text-[10.5px] text-gray-400 ml-1.5">{formatDecimal(share, 0)}%</span>
                  </span>
                  {prev && (
                    <span className="text-right tabular-nums whitespace-nowrap text-[11.5px] min-w-[58px]">
                      {delta === 0 ? <span className="text-gray-400">=</span>
                        : <span className={delta > 0 ? 'text-rose-700' : 'text-teal-700'}>{delta > 0 ? `▲ ${delta}` : `▼ ${-delta}`}</span>}
                    </span>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      <div className="px-5 py-3.5 mt-2 border-t border-gray-100 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="text-[11.5px] text-gray-500">Seguimiento de recuperación de cada baja</span>
        <Link
          to="/bajas"
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-indigo-700 whitespace-nowrap transition-colors hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          Ver seguimiento
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12h15" /><path d="m13 6 6 6-6 6" />
          </svg>
        </Link>
      </div>
    </Card>
  )
}
