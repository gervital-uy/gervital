import { useMemo } from 'react'
import SectionHeading from '../../ui/SectionHeading'
import LoadState from '../../ui/LoadState'
import { ExplainProvider } from '../../explain/ExplainContext'
import { useMonthData } from '../../useMonthData'
import { useToday } from '../../useToday'
import { monthLabelOf } from '../../format'
import { monthStartOf } from '../../monthWindow'
import { getTransportMonthSources, loadFinanceData } from '../../../../services/dashboardV2/financeQueries'
import { FINANCE_DATA_KEY, TRANSPORT_DATA_KEY } from '../../dataKeys'
import { buildFinanceSeries, financeQuadrantsV2 } from '../../../../services/dashboardV2/financeSeriesV2'
import { financeCards } from '../../../../services/dashboardV2/financeCards'
import { buildTransportEconomics } from '../../../../services/dashboardV2/transportEconomics'
import { KPI_OPTIONS } from '../../../../services/dashboardV2/financeView'
import FinanceChart from './FinanceChart'
import FinanceKpis from './FinanceKpis'
import ExpenseBlocks from './ExpenseBlocks'
import ExpensesByCategoryCard from './ExpensesByCategoryCard'
import CashTaxesCard from './CashTaxesCard'
import ProfitBridgeCard from './ProfitBridgeCard'
import RevenueLinesCard from './RevenueLinesCard'
import TransportBandsCard from './TransportBandsCard'
import BreakevenCard from './BreakevenCard'

const loadTransport = ({ year, month }) => getTransportMonthSources(year, month)

// Finanzas: el gráfico principal (Pesos, Tendencia, Márgenes), la fila de KPIs del
// mes y las tarjetas de análisis. La serie va desde el lanzamiento hasta el mes en
// curso y se pide una sola vez (el panel de cada mes, una vez): elegir otro mes no
// vuelve a pedir nada, salvo la programación de transporte de ese mes.
export default function FinanceSection({ selected, onSelectMonth }) {
  const today = useToday()
  const currentStart = monthStartOf(today)
  const current = { year: currentStart.getFullYear(), month: currentStart.getMonth() }
  const data = useMonthData(FINANCE_DATA_KEY, loadFinanceData, current)
  const raw = data.status === 'ready' ? data.data : null

  const series = useMemo(() => (raw ? buildFinanceSeries(raw.sources, raw.costs) : null), [raw])
  const q = useMemo(
    () => (series ? financeQuadrantsV2(series, selected.year, selected.month, KPI_OPTIONS) : null),
    [series, selected.year, selected.month]
  )
  const cards = useMemo(
    () => (series
      ? financeCards({ series, sources: raw.sources, fixedTemplates: raw.costs.fixedTemplates }, { year: selected.year, month: selected.month }, KPI_OPTIONS)
      : null),
    [series, raw, selected.year, selected.month]
  )
  const transportData = useMonthData(TRANSPORT_DATA_KEY, loadTransport, selected)
  const transportRaw = transportData.status === 'ready' ? transportData.data : null
  const transport = useMemo(() => {
    const source = raw?.sources.find(s => s.year === selected.year && s.month === selected.month)
    if (!transportRaw || !source) return null
    return buildTransportEconomics({ ...transportRaw, panel: source.panel, providers: raw.costs.providers, today })
  }, [transportRaw, raw, selected.year, selected.month, today])
  const open = selected.year === current.year && selected.month === current.month
  // El último mes cerrado, para la meta sugerida: el mes en curso todavía no tiene
  // todo su gasto cargado.
  const lastClosed = series && series.length > 1 ? series[series.length - 2] : null
  const monthLabel = monthLabelOf(selected.year, selected.month)
  const ctx = useMemo(() => (q ? { finance: { q, open, cards, transport }, monthLabel } : null), [q, open, cards, transport, monthLabel])

  return (
    <ExplainProvider ctx={ctx}>
      <div className="flex flex-col gap-6 min-w-0">
        <SectionHeading
          eyebrow="Finanzas"
          title="Ingresos, gastos y resultado"
          hint={`${monthLabel} · sin IVA · ingreso: lo que tiene que entrar al banco`}
          right={open && (
            <span
              className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2.5 py-0.5"
              title="El mes todavía no cerró: lo que falta cobrar es una expectativa y los gastos variables se siguen cargando."
            >
              Mes en curso
            </span>
          )}
        />

        <LoadState
          state={data}
          loadingText="Cargando la serie desde junio de 2026…"
          emptyText="Todavía no hay meses con datos."
          isEmpty={() => !series?.length}
        >
          {() => (
            <>
              {data.refreshError && (
                <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
                  <span>No se pudo actualizar la serie: lo que ves puede estar desactualizado.</span>
                  <button type="button" onClick={data.reload} className="shrink-0 font-semibold underline decoration-amber-300 hover:text-amber-950">Reintentar</button>
                </div>
              )}
              <FinanceChart series={series} selected={selected} onSelectMonth={onSelectMonth} lastClosed={lastClosed} />
              <FinanceKpis q={q} open={open} />
              {/* El mes como estado de resultados: en qué se fue la plata (de lo
                  general al detalle), cuánta entró, cómo se llega al resultado, de
                  dónde viene el ingreso y qué estructura lo sostiene. */}
              {cards && (
                <>
                  <ExpenseBlocks cards={cards} income={q.income} />
                  <ExpensesByCategoryCard
                    categories={cards.categories}
                    prev={cards.prev}
                    monthLabel={monthLabel}
                    income={q.income}
                    personal={q.personal.total}
                    expenses={q.expenses}
                  />
                  <CashTaxesCard cash={cards.cash} open={open} />
                  <ProfitBridgeCard bridge={cards.bridge} monthLabel={monthLabel} />
                  <RevenueLinesCard lines={cards.lines} monthLabel={monthLabel} />
                  <TransportBandsCard state={transportData} transport={transport} monthLabel={monthLabel} />
                  <BreakevenCard breakeven={cards.breakeven} monthLabel={monthLabel} />
                </>
              )}
            </>
          )}
        </LoadState>
      </div>
    </ExplainProvider>
  )
}
