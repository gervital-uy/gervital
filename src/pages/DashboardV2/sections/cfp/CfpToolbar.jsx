import Card from '../../../../components/ui/Card'

export const STATUS_FILTERS = {
  collection: [
    { key: 'pending', label: 'Pendientes' },
    { key: 'done', label: 'Cobrados' },
    { key: 'all', label: 'Todos' }
  ],
  // En el orden del circuito: lo que todavía no se puede facturar, lo listo, lo hecho.
  invoicing: [
    { key: 'uncollected', label: 'No cobrado' },
    { key: 'pending', label: 'Pendientes' },
    { key: 'issued', label: 'Emitidas' },
    { key: 'all', label: 'Todos' }
  ]
}

const LABEL = 'text-[10px] font-semibold uppercase tracking-wide text-gray-400'

export default function CfpToolbar({ domain, status, onStatus, query, onQuery, order, onOrder, shown, total }) {
  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex flex-col gap-1.5 items-center max-w-full">
          <span className={LABEL} id="cfp-status-label">Estado</span>
          <div className="inline-flex flex-wrap justify-center bg-gray-100 rounded-2xl p-0.5" role="group" aria-labelledby="cfp-status-label">
            {STATUS_FILTERS[domain].map(s => (
              <button
                key={s.key}
                type="button"
                onClick={() => onStatus(s.key)}
                aria-pressed={status === s.key}
                className={`text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-full transition-colors whitespace-nowrap ${
                  status === s.key ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 items-center flex-1 min-w-[200px]">
          <label htmlFor="cfp-search" className={LABEL}>Buscar</label>
          <div className="relative w-full">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id="cfp-search"
              type="text"
              value={query}
              onChange={e => onQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') onQuery('') }}
              placeholder="Cliente, titular de la transferencia, monto…"
              className={`w-full text-[13px] rounded-xl border border-gray-200 bg-white pl-8 py-1.5 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 ${query ? 'pr-8' : 'pr-3'}`}
            />
            {query && (
              <button
                type="button"
                onClick={() => onQuery('')}
                aria-label="Limpiar la búsqueda"
                title="Limpiar la búsqueda (Esc)"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 items-center">
          <label htmlFor="cfp-order" className={LABEL}>Ordenar por</label>
          <select
            id="cfp-order"
            value={order}
            onChange={e => onOrder(e.target.value)}
            className="text-[13px] text-gray-500 rounded-xl border border-gray-200 bg-white px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="plan">Plan y promos</option>
            <option value="amount">Mayor monto</option>
            <option value="name">Apellido</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5 items-center ml-auto">
          <span className={LABEL}>Resultados</span>
          <span className="text-[13px] font-semibold tabular-nums text-gray-700 py-1.5" aria-live="polite">
            {shown} de {total}
          </span>
        </div>
      </div>
    </Card>
  )
}
