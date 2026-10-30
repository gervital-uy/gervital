import { useEffect, useMemo, useState } from 'react'
import Card from '../../../../components/ui/Card'
import { useAuth } from '../../../../context/AuthContext'
import { todayStr } from '../../../../utils/date'
import SectionHeading from '../../ui/SectionHeading'
import LoadState from '../../ui/LoadState'
import { ExplainProvider } from '../../explain/ExplainContext'
import { useInvalidateMonthData, useMonthData } from '../../useMonthData'
import { monthLabelOf, plural } from '../../format'
import { loadPadron } from '../../../../services/dashboardV2/queries'
import { collectionTotals, invoicingTotals, sortRows } from '../../../../services/dashboardV2/padron'
import {
  canCollect, paymentDateError, paymentDateWindow, registerPayments, revertBlock, revertPayment
} from '../../../../services/dashboardV2/collect'
import { normalizeSearch, searchText } from './cfpText'
import CfpSummary from './CfpSummary'
import BlockedBanner from './BlockedBanner'
import CfpToolbar, { STATUS_FILTERS } from './CfpToolbar'
import CfpTable from './CfpTable'
import PaymentSheet from './PaymentSheet'
import RevertSheet from './RevertSheet'
import ActionOutcome from './ActionOutcome'

const DOMAINS = [{ id: 'collection', label: 'Cobranza' }, { id: 'invoicing', label: 'Facturación' }]

const without = (set, ids) => {
  const next = new Set(set)
  for (const id of ids) next.delete(id)
  return next
}

// Gestión CFP: cobranza (con cobros desde la tabla) y facturación del mes (de solo
// lectura hasta la fase 4; la emisión sigue en la ficha del cliente).
export default function CfpSection({ selected }) {
  const { hasAccess } = useAuth()
  const invalidate = useInvalidateMonthData()
  const padron = useMonthData('padron', loadPadron, selected)
  const rows = padron.status === 'ready' ? padron.data : null
  const monthLabel = monthLabelOf(selected.year, selected.month)

  const [domain, setDomain] = useState('collection')
  // Un filtro de estado por panel: cada uno recuerda el suyo, y pasar de "Emitidas"
  // a Cobranza no deja un filtro que de ese lado no existe.
  const [statusByDomain, setStatusByDomain] = useState({ collection: 'pending', invoicing: 'pending' })
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState('plan')

  // Cobros: fecha cargada por fila, selección, la hoja abierta y el resultado.
  const [dates, setDates] = useState({})
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [paying, setPaying] = useState(null)
  const [reverting, setReverting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState(null)

  // El modo trabadas, las fechas cargadas y la selección son del mes en que se
  // pidieron: al cambiar de mes se limpian.
  useEffect(() => {
    setOnlyBlocked(false)
    setDates({})
    setSelectedIds(new Set())
    setOutcome(null)
  }, [selected.year, selected.month])

  const status = STATUS_FILTERS[domain].some(s => s.key === statusByDomain[domain]) ? statusByDomain[domain] : 'pending'
  const totals = useMemo(() => (rows ? { collection: collectionTotals(rows), invoicing: invoicingTotals(rows) } : null), [rows])
  // Solo tiene sentido mientras el aviso (que tiene la salida del modo) está a la vista.
  const blockedCount = totals ? totals.invoicing.blockedRecord + totals.invoicing.blockedBiller : 0
  const blockedMode = onlyBlocked && domain === 'invoicing' && blockedCount > 0

  const visible = useMemo(() => {
    if (!rows) return []
    const q = normalizeSearch(query)
    const bucket = domain === 'collection' ? 'collectionBucket' : 'invoiceBucket'
    return sortRows(rows.filter(r => {
      // En modo trabadas el estado no se aplica: la tabla muestra justo lo que cuenta el aviso.
      if (blockedMode ? !r.block : status !== 'all' && r[bucket] !== status) return false
      return !q || searchText(r, domain).includes(q)
    }), order, domain)
  }, [rows, domain, status, blockedMode, query, order])

  // La selección es de lo que se ve: cambiar de panel o de estado la limpia.
  const changeDomain = id => { setOnlyBlocked(false); setSelectedIds(new Set()); setDomain(id) }
  const changeStatus = key => { setOnlyBlocked(false); setSelectedIds(new Set()); setStatusByDomain(s => ({ ...s, [domain]: key })) }

  const { year, month } = selected
  const rules = { canManagePromos: hasAccess('promotions') }
  const dateWindow = paymentDateWindow(year, month, todayStr())
  const nameOf = id => {
    const r = rows?.find(x => x.id === id)
    return r ? `${r.firstName} ${r.lastName}`.trim() : id
  }
  const collectable = rows ? rows.filter(r => canCollect(r, rules)) : []
  const ready = collectable.filter(r => dates[r.id] && !paymentDateError(dates[r.id], dateWindow))

  const pay = async (toPay, dateFor, note) => {
    setBusy(true)
    setOutcome(null)
    const results = await registerPayments(toPay, { year, month, dateFor, note })
    const okIds = results.filter(r => r.ok).map(r => r.id)
    setDates(d => Object.fromEntries(Object.entries(d).filter(([id]) => !okIds.includes(id))))
    setSelectedIds(s => without(s, okIds))
    setOutcome({ kind: 'paid', ok: okIds.length, failed: results.filter(r => !r.ok).map(r => ({ name: nameOf(r.id), error: r.error })) })
    setBusy(false)
    setPaying(null)
    if (okIds.length) invalidate('padron')
  }

  const revert = async row => {
    setBusy(true)
    setOutcome(null)
    try {
      await revertPayment(row, { year, month })
      setOutcome({ kind: 'reverted', ok: 1, failed: [], name: nameOf(row.id) })
      invalidate('padron')
    } catch (error) {
      setOutcome({ kind: 'reverted', ok: 0, failed: [{ name: nameOf(row.id), error: error.message }] })
    }
    setBusy(false)
    setReverting(null)
  }

  const sharedDate = ids => {
    const loaded = [...new Set(ids.map(r => dates[r.id]).filter(Boolean))]
    if (loaded.length === 1) return loaded[0]
    const today = todayStr()
    return today >= dateWindow.min && today <= dateWindow.max ? today : ''
  }

  const actions = {
    busy,
    dateWindow,
    dates,
    ready,
    hiddenReady: ready.filter(r => !visible.some(v => v.id === r.id)).length,
    selected: selectedIds,
    canCollect: r => canCollect(r, rules),
    revertBlock: r => revertBlock(r, rules),
    dateError: r => paymentDateError(dates[r.id], dateWindow),
    onDate: (id, value) => setDates(d => ({ ...d, [id]: value })),
    onClearDates: () => setDates({}),
    onToggle: id => setSelectedIds(s => (s.has(id) ? without(s, [id]) : new Set([...s, id]))),
    onClearSelection: () => setSelectedIds(new Set()),
    onPayRow: row => pay([row], () => dates[row.id]),
    onPayReady: () => pay(ready, r => dates[r.id]),
    onPaySelected: rowsToPay => setPaying(rowsToPay),
    onRevert: row => setReverting(row)
  }

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
                {domain === 'invoicing' && (
                  <BlockedBanner invoicing={totals.invoicing} onlyBlocked={blockedMode} onToggle={() => setOnlyBlocked(!blockedMode)} />
                )}
                <CfpToolbar
                  domain={domain}
                  status={blockedMode ? null : status}
                  onStatus={changeStatus}
                  query={query}
                  onQuery={setQuery}
                  order={order}
                  onOrder={setOrder}
                  shown={visible.length}
                  total={rows.length}
                />
                {outcome && <ActionOutcome outcome={outcome} refreshing={padron.refreshing} onDismiss={() => setOutcome(null)} />}
                <CfpTable domain={domain} rows={visible} year={year} month={month} actions={domain === 'collection' ? actions : null} />
              </>
            )}
          </LoadState>
        </section>

        {paying && (
          <PaymentSheet
            rows={paying}
            defaultDate={sharedDate(paying)}
            dateWindow={dateWindow}
            busy={busy}
            onCancel={() => setPaying(null)}
            onConfirm={({ date, note }) => pay(paying, () => date, note)}
          />
        )}
        {reverting && (
          <RevertSheet row={reverting} busy={busy} onCancel={() => setReverting(null)} onConfirm={() => revert(reverting)} />
        )}

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
