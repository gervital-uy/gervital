import { useMemo, useState } from 'react'
import SectionHeading from '../../../ui/SectionHeading'
import StatCard from '../../../ui/StatCard'
import LoadState from '../../../ui/LoadState'
import InfoButton from '../../../explain/InfoButton'
import { ExplainProvider } from '../../../explain/ExplainContext'
import { useMonthData } from '../../../useMonthData'
import { useToday } from '../../../useToday'
import { BENEFITS_DATA_KEY } from '../../../dataKeys'
import { money, pctText, plural } from '../../../format'
import { loadBenefitSources } from '../../../../../services/dashboardV2/benefitsQueries'
import {
  BENEFIT_FILTERS, PLATFORM_START_ORD, benefitHistory, benefitTables, buildBenefits, historyRange, ymOfOrdinal
} from '../../../../../services/dashboardV2/benefitsView'
import { promoOrdinal } from '../../../../../services/promotions/promotionsView'
import CoverageBar from './CoverageBar'
import BenefitsTable from './BenefitsTable'
import MonthPicker from './MonthPicker'
import { ordOfIso } from './benefitsFormat'

const HISTORY_PRESETS = [{ months: 6, label: '6 meses' }, { months: 12, label: '12 meses' }, { months: null, label: 'Todo' }]

const rangeOrds = range => (range ? { from: promoOrdinal(range.from.year, range.from.month), to: promoOrdinal(range.to.year, range.to.month) } : null)

const EMPTY = {
  current: ['Ninguna promo prepaga vigente en este mes', 'Ningún descuento vigente en este mes'],
  expiring: ['Ninguna promo por renovar', 'Ningún descuento por renovar'],
  upcoming: ['Ninguna promo arranca más adelante', 'Ningún descuento arranca más adelante'],
  history: ['Ninguna promo terminó en este rango', 'Ningún descuento terminó en este rango']
}

function packagesHint(p) {
  if (p.count === 0) return 'ningún paquete arranca este mes'
  const packages = plural(p.count, 'paquete', 'paquetes')
  return p.pendingCount > 0 ? `${packages} · ${money(p.pending)} sin cobrar` : `${packages}, todo cobrado`
}

// Promociones y otros descuentos del mes (dentro de Gestión CFP). Solo lectura: crear,
// cobrar o cancelar una promo vive en la ficha del cliente. `padron` es el estado del
// padrón del mes que ya carga Gestión CFP (la misma base).
export default function PromotionsBlock({ selected, padron, monthLabel }) {
  const { year, month } = selected
  const sources = useMonthData(BENEFITS_DATA_KEY, loadBenefitSources, selected)
  const today = useToday()

  const ready = padron.status === 'ready' && sources.status === 'ready'
  const model = useMemo(
    () => (ready ? buildBenefits({ padron: padron.data, ...sources.data }, { year, month }) : null),
    [ready, padron.data, sources.data, year, month]
  )
  // Mientras falta alguna de las dos cargas, el bloque muestra la que no está.
  const state = padron.status !== 'ready' ? padron : sources

  const [filter, setFilter] = useState('current')
  const isHistory = filter === 'history'

  // El historial va desde el lanzamiento hasta el último mes cerrado.
  const lastClosed = ordOfIso(today) - 1
  const [pickedRange, setPickedRange] = useState(null)
  const range = useMemo(() => {
    const r = pickedRange || rangeOrds(historyRange(today, 12))
    if (!r) return null
    const to = Math.min(r.to, lastClosed)
    return { from: Math.min(r.from, to), to }
  }, [pickedRange, today, lastClosed])
  const applyPreset = months => setPickedRange(rangeOrds(historyRange(today, months)))

  const history = useMemo(() => (model && isHistory && range
    ? benefitHistory(model.agreements, { from: ymOfOrdinal(range.from), to: ymOfOrdinal(range.to), today })
    : null), [model, isHistory, range, today])

  const tables = model
    ? isHistory ? (history || { promos: [], discounts: [] }) : benefitTables(model.rows, filter)
    : null

  const ctx = model ? { benefits: { kpis: model.kpis, history: history?.totals || null }, monthLabel } : null
  const k = model?.kpis

  return (
    <ExplainProvider ctx={ctx}>
      <section className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="Gestión CFP"
          title="Promociones y otros descuentos"
          hint={`Vigentes en ${monthLabel} · solo lectura: se crean y se cobran desde la ficha del cliente`}
        />

        {/* Si el padrón falla, el reintento está en Cobranza y facturación, arriba */}
        {padron.status === 'error' ? (
          <p className="py-10 text-center text-sm text-gray-400">Sin el padrón del mes no se pueden mostrar los beneficios: reintentá arriba, en Cobranza y facturación.</p>
        ) : (
          <LoadState state={state} loadingText="Cargando promociones y descuentos…">
            {() => (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard
                    infoId="benefCoverage"
                    label="Con beneficio"
                    value={`${k.withBenefit} de ${k.base}`}
                    sub={`${plural(k.promoCount, 'promo prepaga', 'promos prepagas')} · ${plural(k.discountCount, 'otro descuento', 'otros descuentos')}`}
                  />
                  <StatCard
                    infoId="benefDiscount"
                    label="Descuento del mes"
                    value={money(k.discount.total)}
                    valueClass="text-amber-600"
                    sub={`${pctText(k.discount.sharePct)} de la asistencia a precio de lista`}
                  />
                  <StatCard
                    infoId="benefPackages"
                    label="Paquetes que arrancan"
                    value={money(k.packages.amount)}
                    valueClass="text-emerald-700"
                    sub={packagesHint(k.packages)}
                  />
                  <StatCard
                    infoId="benefRenewals"
                    label="Por renovar"
                    value={String(k.renewals.count)}
                    valueClass={k.renewals.count > 0 ? 'text-amber-600' : 'text-gray-900'}
                    sub={`${money(k.renewals.atStake)} de cuota del mes en juego`}
                  />
                </div>

                <CoverageBar kpis={k} />

                <div className="flex flex-col gap-2">
                  <div role="group" aria-label="Estado de los acuerdos" className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mr-1">Estado</span>
                    {BENEFIT_FILTERS.map(f => (
                      <button
                        key={f.key}
                        type="button"
                        aria-pressed={filter === f.key}
                        onClick={() => setFilter(f.key)}
                        className={`text-[11px] font-medium rounded-full px-3 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                          filter === f.key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        {f.label}
                        {f.key in k.counts && <span className="ml-1 tabular-nums opacity-70">{k.counts[f.key]}</span>}
                      </button>
                    ))}
                  </div>

                  {isHistory && (range ? (
                    <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3.5 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Terminados entre</span>
                        <MonthPicker value={range.from} min={PLATFORM_START_ORD} max={range.to} onChange={from => setPickedRange({ ...range, from })} label="Desde" />
                        <span className="text-[11px] text-gray-400">y</span>
                        <MonthPicker value={range.to} min={range.from} max={lastClosed} onChange={to => setPickedRange({ ...range, to })} label="Hasta" />
                        <div className="flex items-center gap-1 sm:ml-auto">
                          {HISTORY_PRESETS.map(p => (
                            <button
                              key={String(p.months)}
                              type="button"
                              onClick={() => applyPreset(p.months)}
                              className="text-[11px] font-medium text-gray-500 hover:text-gray-800 rounded-full px-2 py-0.5 hover:bg-white transition-colors"
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {history && (
                        <div className="mt-3 pt-3 border-t border-gray-200/70 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Acuerdos terminados</p>
                            <p className="text-[15px] font-semibold text-gray-900 tabular-nums mt-0.5">{history.totals.count}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1">
                              Descuento otorgado
                              <InfoButton id="benefHistory" />
                            </p>
                            <p className="text-[15px] font-semibold text-amber-600 tabular-nums mt-0.5">{money(history.totals.discount)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Promos / otros</p>
                            <p className="text-[15px] font-semibold text-gray-900 tabular-nums mt-0.5">{history.totals.promos} / {history.totals.discounts}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400">Todavía no terminó ningún mes desde el lanzamiento: el historial empieza cuando cierre el primero.</p>
                  ))}
                  {isHistory && range && (
                    <p className="text-[11px] text-gray-400">El historial no sigue al mes de arriba: son acuerdos ya terminados, recortados por este rango.</p>
                  )}
                </div>

                <BenefitsTable
                  title="Promos prepagas"
                  hint={isHistory
                    ? 'Promos que ya terminaron su último mes'
                    : 'Meses seguidos con un % sobre la asistencia; el primer mes cobra el paquete entero'}
                  docId="benefPromos"
                  rows={tables.promos}
                  kind="promo"
                  history={isHistory}
                  empty={EMPTY[filter][0]}
                />
                <BenefitsTable
                  title="Otros descuentos"
                  hint={isHistory
                    ? 'Descuentos que ya dejaron de aplicarse'
                    : 'Descuentos sobre la asistencia que se cobran mes a mes, sin paquete'}
                  docId="benefDiscounts"
                  rows={tables.discounts}
                  kind="discount"
                  history={isHistory}
                  empty={EMPTY[filter][1]}
                />
              </>
            )}
          </LoadState>
        )}
      </section>
    </ExplainProvider>
  )
}
