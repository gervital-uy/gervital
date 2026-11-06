import { useMemo } from 'react'
import SectionHeading from '../../ui/SectionHeading'
import LoadState from '../../ui/LoadState'
import { ExplainProvider } from '../../explain/ExplainContext'
import { useMonthData } from '../../useMonthData'
import { useToday } from '../../useToday'
import { monthLabelOf } from '../../format'
import { monthStartOf } from '../../monthWindow'
import { loadFinanceData } from '../../../../services/dashboardV2/financeQueries'
import { FINANCE_DATA_KEY } from '../../dataKeys'
import { buildFinanceSeries, financeQuadrantsV2 } from '../../../../services/dashboardV2/financeSeriesV2'
import { KPI_OPTIONS } from '../../../../services/dashboardV2/financeView'
import FinanceChart from './FinanceChart'
import FinanceKpis from './FinanceKpis'

// Finanzas: el gráfico principal (Pesos, Tendencia, Márgenes) y la fila de KPIs del
// mes. La serie va desde el lanzamiento hasta el mes en curso y se pide una sola vez
// (el panel de cada mes, una vez): elegir otro mes no vuelve a pedir nada.
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
  const open = selected.year === current.year && selected.month === current.month
  // El último mes cerrado, para la meta sugerida: el mes en curso todavía no tiene
  // todo su gasto cargado.
  const lastClosed = series && series.length > 1 ? series[series.length - 2] : null
  const monthLabel = monthLabelOf(selected.year, selected.month)
  const ctx = useMemo(() => (q ? { finance: { q, open }, monthLabel } : null), [q, open, monthLabel])

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
              {/* Tarjetas de análisis del mes (Fase 9) van acá, debajo de los KPIs y con
                  este mismo contexto de explicaciones: cuadrantes de Personal y de
                  gastos, gastos por categoría, caja e impuestos, puente de
                  rentabilidad, ingreso por línea, transporte por banda y punto de
                  equilibrio. Tienen a mano `series`, `raw.sources`, `raw.costs` y `q`. */}
            </>
          )}
        </LoadState>
      </div>
    </ExplainProvider>
  )
}
