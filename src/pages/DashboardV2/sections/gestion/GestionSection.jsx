import { useMemo, useState } from 'react'
import Card from '../../../../components/ui/Card'
import SectionHeading from '../../ui/SectionHeading'
import LoadState from '../../ui/LoadState'
import { ExplainProvider } from '../../explain/ExplainContext'
import { useMonthData } from '../../useMonthData'
import { monthLabelOf, plural } from '../../format'
import { loadPadron } from '../../../../services/dashboardV2/queries'
import { collectionTotals, invoicingTotals, sortRows } from '../../../../services/dashboardV2/padron'
import { searchText } from './cfpText'
import CfpSummary from './CfpSummary'
import BlockedBanner from './BlockedBanner'
import CfpToolbar, { STATUS_FILTERS } from './CfpToolbar'
import CfpTable from './CfpTable'

const DOMAINS = [{ id: 'cobranza', label: 'Cobranza' }, { id: 'facturacion', label: 'Facturación' }]

// Gestión CFP, fase 2: cobranza y facturación del mes de solo lectura. El cobro y
// la emisión siguen en la ficha del cliente hasta las fases 3 y 4.
export default function GestionSection({ selected }) {
  const padron = useMonthData('padron', loadPadron, selected)
  const rows = padron.status === 'ready' ? padron.data : null
  const monthLabel = monthLabelOf(selected.year, selected.month)

  const [domain, setDomain] = useState('cobranza')
  // Un filtro de estado por panel: cada uno recuerda el suyo, y pasar de "Emitidas"
  // a Cobranza no deja un filtro que de ese lado no existe.
  const [statusByDomain, setStatusByDomain] = useState({ cobranza: 'pendientes', facturacion: 'pendientes' })
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState('plan')

  const status = STATUS_FILTERS[domain].some(s => s.key === statusByDomain[domain]) ? statusByDomain[domain] : 'pendientes'

  const totals = useMemo(() => (rows ? { collection: collectionTotals(rows), invoicing: invoicingTotals(rows) } : null), [rows])

  const visible = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    const bucket = domain === 'cobranza' ? 'collectionBucket' : 'invoiceBucket'
    return sortRows(rows.filter(r => {
      // En modo trabadas el estado no se aplica: la tabla muestra justo lo que cuenta el aviso.
      if (onlyBlocked) { if (!r.block) return false } else if (status !== 'todos' && r[bucket] !== status) return false
      return !q || searchText(r, domain).includes(q)
    }), order, domain)
  }, [rows, domain, status, onlyBlocked, query, order])

  const changeDomain = id => { setOnlyBlocked(false); setDomain(id) }
  const changeStatus = key => { setOnlyBlocked(false); setStatusByDomain(s => ({ ...s, [domain]: key })) }

  const ctx = totals ? { cfp: totals, domain, monthLabel } : null

  return (
    <ExplainProvider ctx={ctx}>
      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-4">
          <SectionHeading
            eyebrow="Gestión CFP"
            title="Cobranza y facturación"
            hint={rows ? `${monthLabel} · ${plural(rows.length, 'cliente', 'clientes')} en el padrón del mes` : monthLabel}
            right={
              <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
                {DOMAINS.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => changeDomain(d.id)}
                    aria-pressed={domain === d.id}
                    className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition-colors ${domain === d.id ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            }
          />

          <LoadState state={padron} loadingText="Cargando el padrón del mes…" emptyText="No hay clientes para cobrar en este mes." isEmpty={data => data.length === 0}>
            {() => (
              <>
                <CfpSummary domain={domain} collection={totals.collection} invoicing={totals.invoicing} />
                {domain === 'facturacion' && (
                  <BlockedBanner invoicing={totals.invoicing} onlyBlocked={onlyBlocked} onToggle={() => setOnlyBlocked(v => !v)} />
                )}
                <CfpToolbar
                  domain={domain}
                  status={onlyBlocked ? null : status}
                  onStatus={changeStatus}
                  query={query}
                  onQuery={setQuery}
                  order={order}
                  onOrder={setOrder}
                  shown={visible.length}
                  total={rows.length}
                />
                <CfpTable domain={domain} rows={visible} year={selected.year} month={selected.month} />
              </>
            )}
          </LoadState>
        </section>

        <section className="flex flex-col gap-4">
          <SectionHeading
            eyebrow="Gestión CFP"
            title="Promociones y otros descuentos"
            hint={`Vigentes en ${monthLabel}`}
          />
          <Card className="border-dashed">
            <div className="flex flex-col items-center justify-center text-center px-6 py-8 min-h-[140px]">
              <p className="text-sm text-gray-400 max-w-md">Promos prepagas, descuentos puntuales, cobertura del mes e historial.</p>
              <span className="mt-3 text-[11px] font-medium text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded-full">próximamente</span>
            </div>
          </Card>
        </section>
      </div>
    </ExplainProvider>
  )
}
