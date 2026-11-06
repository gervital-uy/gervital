import { useEffect, useState } from 'react'
import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import Segmented from '../../ui/Segmented'
import { SCALE_RAMP, contrast, mixScale } from '../../ui/colors'
import { DASH, formatDecimal, formatShortDate, plural } from '../../format'
import { CARD, periodLabel } from './commercialText'

export const COHORT_VIEWS = [{ id: 'month', label: 'Mensual' }, { id: 'quarter', label: 'Trimestral' }]
const UNIT = { month: { one: 'mes', many: 'meses' }, quarter: { one: 'trimestre', many: 'trimestres' } }

// La celda mide magnitud: rampa de un solo tono, más oscura cuanto más gente queda.
// La tinta se elige por contraste contra su propio relleno.
const cellColor = pct => mixScale(SCALE_RAMP, (pct || 0) / 100)
const cellInk = bg => (contrast('#111827', bg) >= contrast('#ffffff', bg) ? '#111827' : '#ffffff')
const pct0 = v => (v == null ? DASH : `${formatDecimal(v, 0)}%`)

// Quién sigue y quién se fue de una cohorte al cierre del paso k.
function CohortDetail({ row, cell, unit, average, reasonLabel, onClose }) {
  const stayed = row.members.filter(m => m.exitStep == null || m.exitStep > cell.k)
  const left = row.members.filter(m => m.exitStep != null && m.exitStep <= cell.k)
  const name = m => `${m.firstName} ${m.lastName}`.trim() || 'Sin nombre'
  const columns = [
    { key: 'stayed', title: 'Siguen activos', color: SCALE_RAMP[4], people: stayed, line: m => `${name(m)}${m.entry === 'return' ? ' (reingreso)' : ''}` },
    {
      key: 'left',
      title: 'Se fueron',
      color: '#e11d48',
      people: left,
      line: m => `${name(m)}: ${unit.one} ${m.exitStep}, ${formatShortDate(m.exitDate)}${m.reason ? `, ${reasonLabel(m.reason).toLowerCase()}` : ''}`
    }
  ]
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/70 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-gray-900">{periodLabel(row.key)} · {unit.one} {cell.k}</p>
          <p className="text-[11.5px] text-gray-600 mt-0.5 leading-relaxed">
            De {plural(row.size, 'alta', 'altas')} de {periodLabel(row.key)},{' '}
            <span className="font-semibold text-gray-900">{cell.active}</span> {cell.active === 1 ? 'sigue activa' : 'siguen activas'} al cierre de {periodLabel(cell.period)}: {pct0(cell.pct)}.
            {cell.k > 0 && average && ` Todas las cohortes juntas, en el ${unit.one} ${cell.k}: ${pct0(average.pct)}.`}
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors">
          Cerrar
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {columns.map(col => (
          <div key={col.key}>
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: col.color }} />
              {col.title} ({col.people.length})
            </p>
            {col.people.length === 0
              ? <p className="text-[11.5px] text-gray-400 mt-1">{DASH}</p>
              : (
                <ul className="mt-1 space-y-0.5">
                  {col.people.map(m => <li key={`${m.clientId}-${m.exitDate}`} className="text-[11.5px] text-gray-700 leading-snug">{col.line(m)}</li>)}
                </ul>
              )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Retención por cohortes: qué parte de cada camada de altas sigue activa al cierre
// de cada período siguiente. cohorts: activityTimeline.cohortRetention del mes.
export default function CohortRetentionCard({ cohorts, view, onView, monthLabel, reasonLabel }) {
  const [selected, setSelected] = useState(null)
  useEffect(() => { setSelected(null) }, [cohorts])
  const unit = UNIT[cohorts.mode]
  const cols = `92px repeat(${cohorts.steps}, minmax(0, 1fr))`
  const selectedRow = selected ? cohorts.rows.find(r => r.key === selected.key) : null
  const selectedCell = selectedRow ? selectedRow.cells[selected.k] : null

  return (
    <Card role="group" aria-label="Retención por cohortes" className={CARD}>
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
            <span className="truncate">Retención por cohortes</span>
            <InfoButton id="cohorts" />
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">Qué parte de cada camada de altas sigue activa</p>
        </div>
        <div className="shrink-0 flex flex-col items-start sm:items-end gap-1.5">
          <Segmented options={COHORT_VIEWS} value={view} onChange={onView} label="Período de las cohortes" />
          <span className="text-[11px] text-gray-400 sm:text-right whitespace-nowrap">
            <span className="capitalize">{monthLabel}</span> · {plural(cohorts.entries, 'alta', 'altas')} en la ventana
          </span>
        </div>
      </div>

      <div className="px-5 pb-5">
        {cohorts.rows.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Todavía no hay altas registradas.</p>
        ) : (
          <>
            {/* En el celular la tabla se desplaza dentro de la tarjeta, no la página. Desde
                md entra entera y el desborde queda visible para que no corte los globos. */}
            <div className="overflow-x-auto md:overflow-visible">
              <div className="min-w-[560px] md:min-w-0">
                <div className="flex items-end justify-between pb-1.5">
                  <span className="text-[9.5px] font-medium uppercase tracking-wide text-gray-400">Cohorte de alta</span>
                  <span className="text-[9.5px] font-medium uppercase tracking-wide text-gray-400">{unit.many} desde el alta →</span>
                </div>
                <div className="grid gap-[3px]" style={{ gridTemplateColumns: cols }}>
                  <span />
                  {Array.from({ length: cohorts.steps }, (_, k) => (
                    <span key={k} className="pb-1 text-center text-[10px] font-medium tabular-nums text-gray-400">{k}</span>
                  ))}
                </div>

                {cohorts.rows.map(row => (
                  <div key={row.key} className="grid gap-[3px] mt-[3px] items-center" style={{ gridTemplateColumns: cols }}>
                    <div className="pr-2 min-w-0">
                      <span className="block text-[12px] font-medium text-gray-700 leading-none truncate">{periodLabel(row.key)}</span>
                      <span className="block text-[10px] text-gray-400 tabular-nums mt-[3px] leading-none">{row.size === 0 ? 'sin altas' : plural(row.size, 'alta', 'altas')}</span>
                    </div>
                    {Array.from({ length: cohorts.steps }, (_, k) => {
                      const cell = row.cells[k]
                      if (!cell || cell.pct == null) return <span key={k} className="h-[26px]" />
                      const bg = cellColor(cell.pct)
                      const isSelected = selected?.key === row.key && selected?.k === k
                      const all = cohorts.average[k]
                      const anchor = k <= 1 ? 'left-0' : k >= cohorts.steps - 2 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                      return (
                        <button
                          key={k}
                          type="button"
                          aria-label={`${periodLabel(row.key)}, ${unit.one} ${k}: ${cell.active} de ${row.size} siguen activos`}
                          aria-pressed={isSelected}
                          onClick={() => setSelected(isSelected ? null : { key: row.key, k })}
                          className={`group relative h-[26px] w-full rounded-[3px] flex items-center justify-center transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${isSelected ? 'ring-2 ring-gray-900 ring-offset-1' : ''}`}
                          style={{ background: bg }}
                        >
                          <span className="text-[11px] font-semibold tabular-nums leading-none" style={{ color: cellInk(bg) }}>{pct0(cell.pct)}</span>
                          {/* Lo que la celda no dice sola: cuántos son, cuántos se fueron en este paso y cómo está el resto de las camadas */}
                          <span className={`pointer-events-none absolute bottom-full mb-2 z-40 w-[232px] opacity-0 group-hover:opacity-100 transition-opacity duration-150 rounded-lg bg-gray-900 text-white text-[11px] leading-relaxed px-3 py-2 shadow-lg text-left ${anchor}`}>
                            <span className="block font-semibold">{periodLabel(row.key)} · {unit.one} {k}</span>
                            <span className="block mt-1">{cell.active} de {row.size} siguen activos al cierre de {periodLabel(cell.period)}.</span>
                            <span className="block mt-1 text-gray-300">
                              {cell.lostInStep === 0 ? `Nadie se fue en este ${unit.one}.` : `Se ${cell.lostInStep === 1 ? 'fue 1 persona' : `fueron ${cell.lostInStep} personas`} en este ${unit.one}.`}
                              {k > 0 && cell.lostTotal > 0 && ` Desde el alta: ${cell.lostTotal}.`}
                            </span>
                            {k > 0 && all && <span className="block mt-1 text-gray-300">Todas las cohortes en el {unit.one} {k}: {pct0(all.pct)}.</span>}
                            <span className="block mt-1.5 pt-1.5 border-t border-white/15 text-gray-400">Clic para ver quiénes son.</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))}

                {/* Todas juntas, ponderadas por tamaño: con cohortes de dos o tres
                    personas, la única lectura con algo de peso. */}
                {cohorts.average.length > 0 && (
                  <div className="grid gap-[3px] mt-2 pt-2 border-t border-gray-200 items-center" style={{ gridTemplateColumns: cols }}>
                    <div className="pr-2 min-w-0">
                      <span className="block text-[12px] font-semibold text-gray-900 leading-none">Todas</span>
                      <span className="block text-[10px] text-gray-400 tabular-nums mt-[3px] leading-none">{plural(cohorts.entries, 'alta', 'altas')}</span>
                    </div>
                    {Array.from({ length: cohorts.steps }, (_, k) => {
                      const avg = cohorts.average.find(a => a.k === k)
                      if (!avg) return <span key={k} className="h-[26px]" />
                      return (
                        <div key={k} className="h-[26px] flex items-center justify-center" title={`${unit.one} ${k}: ${avg.active} de ${avg.base} siguen activos (${pct0(avg.pct)}) · ${plural(avg.cohorts, 'cohorte', 'cohortes')}`}>
                          <span className="text-[11px] font-semibold tabular-nums leading-none text-gray-700">{pct0(avg.pct)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {selectedRow && selectedCell && (
              <CohortDetail
                row={selectedRow}
                cell={selectedCell}
                unit={unit}
                average={cohorts.average.find(a => a.k === selectedCell.k)}
                reasonLabel={reasonLabel}
                onClose={() => setSelected(null)}
              />
            )}
          </>
        )}
      </div>
    </Card>
  )
}
