import { useState, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import Card from '../../../components/ui/Card'
import { formatCurrency } from '../../../utils/format'
import { getPromotions } from '../../../services/promotions/promotionService'
import { promoState, promoMonthIndex, promoKpis, promoOrdinal } from '../../../services/promotions/promotionsView'

const monthLabel = (year, month) => format(new Date(year, month, 1), 'MMM yyyy', { locale: es })
const rangeLabel = (p) => `${monthLabel(p.startYear, p.startMonth)} – ${monthLabel(p.endYear, p.endMonth)}`

// Sello por fila. Reemplaza a las dos listas que se solapaban: ahora cada promo
// tiene un estado y aparece exactamente una vez.
const STATE_META = {
  expiring: { label: 'vence pronto', cls: 'bg-amber-50 text-amber-700' },
  active: { label: 'al día', cls: 'bg-gray-100 text-gray-500' },
  upcoming: { label: 'por empezar', cls: 'bg-blue-50 text-blue-700' },
  expired: { label: 'finalizada', cls: 'bg-gray-100 text-gray-400' }
}

const FILTERS = [
  { key: 'all', label: 'Todas', states: ['expiring', 'active', 'upcoming', 'expired'] },
  { key: 'active', label: 'Activas', states: ['expiring', 'active'] },
  { key: 'expiring', label: 'Por vencer', states: ['expiring'] },
  { key: 'history', label: 'Historial', states: ['expired'] }
]

// Orden de urgencia: primero lo que vence, al final lo terminado.
const STATE_ORDER = { expiring: 0, active: 1, upcoming: 2, expired: 3 }

function Kpi({ label, value }) {
  return (
    <Card className="rounded-2xl border-gray-100 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900 tabular-nums">{value}</p>
    </Card>
  )
}

function PromoRow({ p, state, refYear, refMonth }) {
  const index = promoMonthIndex(p, refYear, refMonth)
  const total = promoOrdinal(p.endYear, p.endMonth) - promoOrdinal(p.startYear, p.startMonth) + 1
  const initials = `${p.firstName?.[0] || ''}${p.lastName?.[0] || ''}`.toUpperCase()
  const meta = STATE_META[state]
  // Sin paidDate la promo está pactada pero no cobrada: se muestra el pactado.
  const amount = p.paidDate ? p.paidAmount : p.totalAmount

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
      <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
        {initials || '–'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{p.firstName} {p.lastName}</p>
        <p className="text-[11px] text-gray-400 capitalize">{rangeLabel(p)} · {p.discountPercent}% dto</p>
      </div>
      {index != null && (
        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 tabular-nums flex-shrink-0">
          {index}/{total}
        </span>
      )}
      <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 flex-shrink-0 ${meta.cls}`}>
        {meta.label}
      </span>
      <span className="text-right flex-shrink-0 w-28">
        <span className="block text-sm font-semibold tabular-nums text-gray-900">{formatCurrency(amount)}</span>
        {!p.paidDate && <span className="block text-[10px] text-amber-600">a cobrar</span>}
      </span>
    </div>
  )
}

export default function PromotionsSection({ selected }) {
  const [promos, setPromos] = useState([])
  const [filter, setFilter] = useState('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getPromotions()
      .then(rows => { if (alive) { setPromos(rows); setError(null) } })
      .catch(err => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const rows = useMemo(() => {
    const allowed = FILTERS.find(f => f.key === filter)?.states || []
    return (promos || [])
      .map(p => ({ p, state: promoState(p, selected.year, selected.month) }))
      .filter(r => allowed.includes(r.state))
      .sort((a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        `${a.p.lastName} ${a.p.firstName}`.localeCompare(`${b.p.lastName} ${b.p.firstName}`))
  }, [promos, selected, filter])

  const kpis = useMemo(
    () => promoKpis(promos, selected.year, selected.month),
    [promos, selected]
  )

  if (error) {
    return <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">Error: {error}</div>
  }
  if (loading) {
    return <div className="flex items-center justify-center py-32 text-gray-400 text-sm">Cargando promociones…</div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Promos activas" value={kpis.activeCount} />
        <Kpi label="Prepago cobrado del mes" value={formatCurrency(kpis.prepaidCashInPeriod)} />
        <Kpi label="Descuento otorgado" value={formatCurrency(kpis.totalDiscountGranted)} />
        <Kpi label="Por vencer" value={kpis.expiringCount} />
      </div>

      <Card className="rounded-2xl border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-gray-900">Promociones</h3>
          <div className="flex items-center gap-1">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-[11px] font-medium rounded-full px-2.5 py-1 transition-colors ${
                  filter === f.key
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {f.label}
              </button>
            ))}
            <span className="text-[11px] text-gray-400 ml-2 tabular-nums">{rows.length}</span>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">Ninguna promo en este filtro</div>
        ) : (
          rows.map(({ p, state }) => (
            <PromoRow key={p.id} p={p} state={state} refYear={selected.year} refMonth={selected.month} />
          ))
        )}
      </Card>
    </div>
  )
}
