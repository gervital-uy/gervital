import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../../context/AuthContext'
import LoadState from '../../ui/LoadState'
import { ExplainProvider } from '../../explain/ExplainContext'
import { useInvalidateMonthData, useMonthData } from '../../useMonthData'
import { useToday } from '../../useToday'
import { formatShortDate, monthLabelOf } from '../../format'
import { loadCommercial, saveShiftCapacity } from '../../../../services/dashboardV2/commercialQueries'
import CommercialKpis from './CommercialKpis'
import OccupancyCard from './OccupancyCard'
import OccupancyHeatmap from './OccupancyHeatmap'
import CompositionCard from './CompositionCard'
import RevenueMixCard from './RevenueMixCard'
import ClientFlowCard from './ClientFlowCard'
import ExitsByReasonCard, { windowSize } from './ExitsByReasonCard'
import CohortRetentionCard from './CohortRetentionCard'

export const COMMERCIAL_KEY = 'commercial'

// Pestaña Comercial: cartera, MRR, churn, ocupación, composición, altas y bajas y
// cohortes. Una sola carga trae todos los meses (commercialQueries.loadCommercial);
// el navegador de meses solo elige cuál se mira.
export default function CommercialSection({ selected }) {
  const { hasAccess } = useAuth()
  const invalidate = useInvalidateMonthData()
  const today = useToday()
  // La carga se identifica por el mes de hoy: al empezar un mes nuevo se rehace
  // (la línea de tiempo llega hasta el mes en curso).
  const state = useMonthData(COMMERCIAL_KEY, loadCommercial, { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })
  // Y con la pestaña abierta de un día para el otro también: el mes en curso se
  // corta en hoy, así que una baja o un reingreso de hoy recién entran mañana.
  const dayRef = useRef(today)
  useEffect(() => {
    if (dayRef.current === today) return
    dayRef.current = today
    invalidate(COMMERCIAL_KEY)
  }, [today, invalidate])

  const model = state.status === 'ready' ? state.data : null
  const index = model ? model.indexOf(selected.year, selected.month) : -1
  const month = index >= 0 ? model.month(index) : null
  const yearAgo = index >= 12 ? model.month(index - 12) : null
  const monthLabel = monthLabelOf(selected.year, selected.month)

  // Lo que se elige en cada tarjeta vive acá: las explicaciones hablan de lo que se ve.
  const [compositionDim, setCompositionDim] = useState('frequency')
  const [mixDim, setMixDim] = useState('frequency')
  const [heatView, setHeatView] = useState('seats')
  const [exitWindow, setExitWindow] = useState(12)
  const [cohortView, setCohortView] = useState('quarter')

  // Aforo: probar un valor recalcula la ocupación y el mapa sin guardar nada;
  // guardarlo en la configuración del centro es un botón aparte (admin y superadmin,
  // como la RLS de app_settings: la misma feature que el fondo de contingencia).
  const [trialCapacity, setTrialCapacity] = useState(null)
  const [save, setSave] = useState({ status: 'idle' })
  const canSave = hasAccess('expense_settings')
  const simulating = model != null && trialCapacity != null && trialCapacity !== model.capacity
  // Cuando la recarga trae el aforo recién guardado, deja de ser una prueba
  useEffect(() => {
    if (model && trialCapacity === model.capacity && !model.isDefaultCapacity) setTrialCapacity(null)
  }, [model, trialCapacity])

  const occupancy = useMemo(() => {
    if (!month) return null
    return simulating ? month.simulateOccupancy(trialCapacity) : month.occupancy
  }, [month, simulating, trialCapacity])
  const exits = useMemo(() => month?.exitsByReason(windowSize(exitWindow)), [month, exitWindow])
  const cohorts = useMemo(() => month?.cohorts(cohortView), [month, cohortView])

  const tryCapacity = value => {
    setSave({ status: 'idle' })
    setTrialCapacity(value)
  }
  const discardCapacity = () => {
    setSave({ status: 'idle' })
    setTrialCapacity(null)
  }
  const saveCapacity = async value => {
    setSave({ status: 'saving' })
    try {
      await saveShiftCapacity(value)
      // Se sigue viendo el valor guardado mientras llega la recarga
      setTrialCapacity(value)
      setSave({ status: 'saved', value })
      invalidate(COMMERCIAL_KEY)
    } catch (error) {
      setSave({ status: 'error', error: error.message })
    }
  }

  const reasonLabel = key => model?.reasons.find(r => r.key === key)?.label || key

  const ctx = useMemo(() => (month && occupancy
    ? {
        month,
        occupancy,
        composition: { dimension: compositionDim, rows: month.composition[compositionDim] },
        mix: { dimension: mixDim, rows: month.mix[mixDim] },
        exits,
        cohorts,
        monthLabel
      }
    : null), [month, occupancy, compositionDim, mixDim, exits, cohorts, monthLabel])

  return (
    <ExplainProvider ctx={ctx}>
      <LoadState
        state={state}
        loadingText="Cargando la cartera…"
        emptyText="No hay datos comerciales para este mes."
        isEmpty={data => data.indexOf(selected.year, selected.month) < 0}
      >
        {() => month && (
          <div className="flex flex-col gap-6">
            {(month.partial || state.refreshError) && (
              <div className="flex flex-col gap-1 -mb-2">
                {month.partial && (
                  <p className="text-[11.5px] text-gray-400">Mes en curso: los números van hasta hoy, {formatShortDate(month.cut)}.</p>
                )}
                {state.refreshError && (
                  <p role="alert" className="text-[11.5px] text-rose-600">
                    No se pudieron actualizar los datos: {state.refreshError.message}.{' '}
                    <button type="button" onClick={state.reload} className="font-semibold underline">Reintentar</button>
                  </p>
                )}
              </div>
            )}

            <CommercialKpis month={month} yearAgo={yearAgo} />

            {/* Las dos vistas de la ocupación van enmarcadas juntas: miden lo mismo, una
                en general y la otra casillero por casillero, con el mismo aforo. */}
            <div className="rounded-[20px] border border-gray-200 p-3 flex flex-col gap-3">
              <div className="px-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Ocupación de la capacidad</span>
                <span className="text-[10px] text-gray-400">las dos vistas usan el mismo aforo</span>
              </div>
              <OccupancyCard
                occupancy={occupancy}
                monthLabel={monthLabel}
                savedCapacity={model.capacity}
                isDefault={model.isDefaultCapacity}
                canSave={canSave}
                save={save}
                onTry={tryCapacity}
                onSave={saveCapacity}
                onDiscard={discardCapacity}
              />
              <OccupancyHeatmap occupancy={occupancy} monthLabel={monthLabel} view={heatView} onView={setHeatView} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <CompositionCard rows={month.composition[compositionDim]} dimension={compositionDim} onDimension={setCompositionDim} />
              <RevenueMixCard rows={month.mix[mixDim]} dimension={mixDim} onDimension={setMixDim} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <ClientFlowCard month={month} />
              <ExitsByReasonCard exits={exits} windowValue={exitWindow} onWindow={setExitWindow} />
            </div>

            {/* Cierra la pestaña: el flujo dice cuántos, el motivo dice por qué, y esto
                dice cuánto aguanta cada camada (lo que el churn promedio esconde). */}
            <CohortRetentionCard cohorts={cohorts} view={cohortView} onView={setCohortView} monthLabel={monthLabel} reasonLabel={reasonLabel} />
          </div>
        )}
      </LoadState>
    </ExplainProvider>
  )
}
