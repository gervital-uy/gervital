import { useState, useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import MonthNavigator from '../../components/ui/MonthNavigator'
import SectionPlaceholder from './SectionPlaceholder'
import CfpSection from './sections/cfp/CfpSection'
import FinanceSection from './sections/finance/FinanceSection'
import { MonthDataProvider } from './useMonthData'
import { PLATFORM_START, monthStartOf } from './monthWindow'
import { useToday } from './useToday'

// Pestañas del dashboard v2, en el orden de la maqueta. Cada una pide su feature y
// abre la primera disponible. `upcoming` describe la sección mientras no está portada;
// cuando una fase la porta, se le agrega `Component` y el placeholder deja de verse.
const SECTIONS = [
  {
    id: 'cfp',
    label: 'Gestión CFP',
    feature: 'billing',
    Component: CfpSection
  },
  {
    id: 'finance',
    label: 'Finanzas',
    feature: 'dashboard_financials',
    Component: FinanceSection
  },
  {
    id: 'commercial',
    label: 'Comercial',
    feature: 'dashboard_financials',
    upcoming: [
      { title: 'Cartera', hint: 'Activos, MRR, churn, MRR ganado y perdido, permanencia.' },
      { title: 'Ocupación', hint: 'Cupos por turno y mapa de calor por día.' },
      { title: 'Composición y aporte', hint: 'La base por plan, horario, tier y edad, y cuánto factura cada segmento.' },
      { title: 'Altas, bajas y retención', hint: 'Flujo de clientes, bajas por motivo y cohortes.' }
    ]
  },
  {
    id: 'attendance',
    label: 'Asistencia',
    feature: 'statistics',
    upcoming: [
      { title: 'Asistencia del mes', hint: 'Tasa real, faltas, recuperos y licencias.' },
      { title: 'Por segmento y tendencia', hint: 'Tasa por plan, horario y tier, mes a mes.' },
      { title: 'Real contra contratada', hint: 'La semana promedio, día por día.' },
      { title: 'Motivación y período de prueba', hint: 'Seguimiento de motivación y conversión de pruebas.' }
    ]
  }
]

export default function DashboardV2() {
  const { hasAccess } = useAuth()

  const available = useMemo(() => SECTIONS.filter(s => hasAccess(s.feature)), [hasAccess])
  const [tab, setTab] = useState(() => available[0]?.id)
  // El último mes navegable es el en curso, y avanza solo si la pestaña queda
  // abierta de un mes para el otro.
  const today = useToday()
  const maxMonth = useMemo(() => monthStartOf(today), [today])
  const [selected, setSelected] = useState(() => ({ year: maxMonth.getFullYear(), month: maxMonth.getMonth() }))

  const active = available.find(s => s.id === tab) || available[0]

  return (
    <div className="-mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8 min-h-full bg-gray-50">
      {/* pestañas de sección + navegador de mes en una sola fila, como en legacy */}
      <div className="flex items-end justify-between gap-4 border-b border-gray-200 mb-6">
        <div className="flex gap-1 overflow-x-auto overflow-y-hidden">
          {available.map(s => {
            const isActive = s.id === active?.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setTab(s.id)}
                className={`relative px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${
                  isActive ? 'text-indigo-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {s.label}
                {isActive && <span className="absolute left-3 right-3 bottom-0 h-0.5 rounded bg-indigo-600" />}
              </button>
            )
          })}
        </div>
        <div className="pb-1.5 shrink-0">
          <MonthNavigator selected={selected} onChange={setSelected} minDate={PLATFORM_START} maxDate={maxMonth} />
        </div>
      </div>

      {/* El caché de datos vive acá y no en cada pestaña: cambiar de pestaña no recarga */}
      <MonthDataProvider>
        {!active ? (
          <p className="text-sm text-gray-500">Tu rol no tiene acceso a ninguna sección del dashboard v2.</p>
        ) : active.Component ? (
          <active.Component selected={selected} onSelectMonth={setSelected} />
        ) : (
          <SectionPlaceholder cards={active.upcoming} />
        )}
      </MonthDataProvider>
    </div>
  )
}
