import { useEffect, useMemo, useRef, useState } from 'react'
import Card from '../../../../components/ui/Card'
import { useAuth } from '../../../../context/AuthContext'
import SectionHeading from '../../ui/SectionHeading'
import LoadState from '../../ui/LoadState'
import { ExplainProvider } from '../../explain/ExplainContext'
import { useInvalidateMonthData, useMonthData } from '../../useMonthData'
import { useToday } from '../../useToday'
import { monthLabelOf, plural } from '../../format'
import { loadPadron } from '../../../../services/dashboardV2/queries'
import { collectionTotals, invoicingTotals, sortRows } from '../../../../services/dashboardV2/padron'
import {
  canCollect, paymentDateError, paymentDateWindow, registerPayments, revertBlock, revertPayment
} from '../../../../services/dashboardV2/collect'
import { emissionOpensOn, emitInvoices, invoiceDateOf } from '../../../../services/dashboardV2/invoicing'
import { normalizeSearch, searchText } from './cfpText'
import CfpSummary from './CfpSummary'
import BlockedBanner from './BlockedBanner'
import CfpToolbar, { STATUS_FILTERS } from './CfpToolbar'
import CfpTable from './CfpTable'
import PaymentSheet from './PaymentSheet'
import RevertSheet from './RevertSheet'
import ActionOutcome from './ActionOutcome'
import InvoiceSheet from './InvoiceSheet'
import InvoiceBatchSheet from './InvoiceBatchSheet'

const DOMAINS = [{ id: 'collection', label: 'Cobranza' }, { id: 'invoicing', label: 'Facturación' }]

const without = (set, ids) => {
  const next = new Set(set)
  for (const id of ids) next.delete(id)
  return next
}

// Gestión CFP: cobranza (con cobros desde la tabla) y facturación del mes (con la
// emisión hacia Biller, de a una o en lote).
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

  // Cobros: fecha (y nota) cargada por fila, selección, lo que falló (por fila), la
  // hoja abierta y el resultado de la última acción.
  const [dates, setDates] = useState({})
  const [notes, setNotes] = useState({})
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [failures, setFailures] = useState({})
  const [paying, setPaying] = useState(null)
  const [reverting, setReverting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState(null)
  const canManagePromos = hasAccess('promotions')

  // Facturación: lo que no se emitió (por fila), la factura a confirmar y el lote
  // abierto (sus filas quedan fijas mientras está abierto).
  const [issueFailures, setIssueFailures] = useState({})
  const [issuing, setIssuing] = useState(null)
  const [batch, setBatch] = useState(null)
  const canBill = hasAccess('billing')

  // El mes a la vista: una acción que termina después de cambiar de mes no deja su
  // resultado ni sus fechas en el mes nuevo.
  const monthKey = `${selected.year}-${selected.month}`
  const monthKeyRef = useRef(monthKey)
  useEffect(() => { monthKeyRef.current = monthKey }, [monthKey])

  // El modo trabadas, las fechas, la selección y los avisos son del mes en que se
  // pidieron: al cambiar de mes se limpian.
  useEffect(() => {
    setOnlyBlocked(false)
    setDates({})
    setNotes({})
    setSelectedIds(new Set())
    setFailures({})
    setIssueFailures({})
    setOutcome(null)
  }, [selected.year, selected.month])

  const { year, month } = selected
  const today = useToday()
  // Con la pestaña abierta de un día para el otro, el padrón se rehace: el
  // vencimiento (día 11) y la ventana de fechas dependen del día.
  const dayRef = useRef(today)
  useEffect(() => {
    if (dayRef.current === today) return
    dayRef.current = today
    invalidate('padron')
  }, [today, invalidate])
  // Las facturas del mes salen con fecha de su último día hábil, y no antes.
  const invoiceDate = invoiceDateOf(year, month)
  const opensOn = emissionOpensOn(year, month, today)
  const canIssue = r => canBill && r.canEmit

  // Lo que ya no se puede cobrar o emitir (se cobró, se emitió, cambió la promo) sale
  // de la selección, de las fechas y notas cargadas y de las marcas de fallo cuando
  // llega el padrón nuevo.
  useEffect(() => {
    if (!rows) return
    const collectable = new Set(rows.filter(r => canCollect(r, { canManagePromos })).map(r => r.id))
    const issuable = new Set(rows.filter(r => canBill && r.canEmit).map(r => r.id))
    const selectable = domain === 'collection' ? collectable : new Set(opensOn ? [] : issuable)
    const keep = open => map => (Object.keys(map).every(id => open.has(id)) ? map : Object.fromEntries(Object.entries(map).filter(([id]) => open.has(id))))
    setSelectedIds(s => ([...s].every(id => selectable.has(id)) ? s : new Set([...s].filter(id => selectable.has(id)))))
    setDates(keep(collectable))
    setNotes(keep(collectable))
    setFailures(keep(collectable))
    setIssueFailures(keep(issuable))
  }, [rows, canManagePromos, canBill, opensOn, domain])

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

  const rules = { canManagePromos }
  const dateWindow = paymentDateWindow(year, month, today)
  const nameOf = id => {
    const r = rows?.find(x => x.id === id)
    return r ? `${r.firstName} ${r.lastName}`.trim() : id
  }
  const collectable = rows ? rows.filter(r => canCollect(r, rules)) : []
  const withDate = collectable.filter(r => dates[r.id])
  const ready = withDate.filter(r => !paymentDateError(dates[r.id], dateWindow))
  // Hasta que llega el padrón recargado, lo recién cobrado todavía figura pendiente.
  const locked = busy || padron.refreshing

  // `sheet`: la fecha y la nota de la hoja, que les quedan cargadas a las filas que
  // fallan para reintentar desde el lote.
  const pay = async (toPay, dateFor, noteFor, sheet = null) => {
    const key = monthKey
    setBusy(true)
    setOutcome(null)
    let results
    try {
      results = await registerPayments(toPay, { year, month, dateFor, noteFor })
    } catch (error) {
      results = toPay.map(r => ({ id: r.id, ok: false, error: error.message }))
    }
    // Siempre se recarga: un fallo puede venir de un padrón viejo.
    invalidate('padron')
    setBusy(false)
    setPaying(null)
    if (monthKeyRef.current !== key) return
    const okIds = results.filter(r => r.ok).map(r => r.id)
    const failed = results.filter(r => !r.ok)
    const carry = (map, value) => {
      const next = Object.fromEntries(Object.entries(map).filter(([id]) => !okIds.includes(id)))
      if (value) for (const f of failed) next[f.id] = value
      return next
    }
    setDates(d => carry(d, sheet?.date))
    setNotes(n => carry(n, sheet?.note?.trim()))
    setSelectedIds(s => without(s, okIds))
    setFailures(f => ({
      ...Object.fromEntries(Object.entries(f).filter(([id]) => !okIds.includes(id))),
      ...Object.fromEntries(failed.map(r => [r.id, r.error]))
    }))
    setOutcome({ kind: 'paid', ok: okIds.length, failed: failed.map(r => ({ name: nameOf(r.id), error: r.error })) })
  }

  const revert = async row => {
    const key = monthKey
    const name = nameOf(row.id)
    setBusy(true)
    setOutcome(null)
    let failed = []
    try {
      await revertPayment(row, { year, month })
    } catch (error) {
      failed = [{ name, error: error.message }]
    }
    invalidate('padron')
    setBusy(false)
    setReverting(null)
    if (monthKeyRef.current !== key) return
    setOutcome({ kind: 'reverted', ok: failed.length ? 0 : 1, failed, name })
  }

  // La fecha que propone la hoja: la que tienen cargada todas, si está en rango; si
  // no, hoy.
  const sharedDate = list => {
    const loaded = [...new Set(list.map(r => dates[r.id]).filter(Boolean))]
    if (loaded.length === 1 && !paymentDateError(loaded[0], dateWindow)) return loaded[0]
    return today >= dateWindow.min && today <= dateWindow.max ? today : ''
  }
  // Una sola nota si todas comparten la misma (la de una hoja que falló).
  const sharedNote = list => {
    const loaded = [...new Set(list.map(r => notes[r.id] || ''))]
    return loaded.length === 1 ? loaded[0] : ''
  }

  // Resultado de una emisión (una factura o la sesión entera de un lote): lo que no
  // salió queda marcado en su fila. El padrón se recarga después de cada tanda.
  const reportIssued = (results, key) => {
    if (monthKeyRef.current !== key || !results.length) return
    const done = results.filter(r => !r.skipped)
    const okIds = done.filter(r => r.ok).map(r => r.id)
    const failed = done.filter(r => !r.ok)
    setSelectedIds(s => without(s, okIds))
    setIssueFailures(f => ({
      ...Object.fromEntries(Object.entries(f).filter(([id]) => !okIds.includes(id))),
      ...Object.fromEntries(failed.map(r => [r.id, r.error]))
    }))
    setOutcome({ kind: 'issued', ok: okIds.length, failed: failed.map(r => ({ name: nameOf(r.id), error: r.error })) })
  }

  // Las hojas de emisión quedan atadas al mes en que se abrieron.
  const bound = () => ({ year, month, monthLabel, invoiceDate, key: monthKey })

  const issueOne = async ({ row, year: y, month: m, key }) => {
    setBusy(true)
    setOutcome(null)
    let results
    try {
      results = await emitInvoices([row], { year: y, month: m })
    } catch (error) {
      results = [{ id: row.id, ok: false, error: error.message }]
    }
    // Siempre se recarga: un rechazo deja su motivo guardado.
    invalidate('padron')
    setBusy(false)
    setIssuing(null)
    reportIssued(results, key)
  }

  const issuable = rows ? rows.filter(canIssue) : []
  // `all`: el lote de todo el mes, que además avisa cuántas quedan afuera.
  const openBatch = (list, all = false) => { setOutcome(null); setBatch({ rows: list, all, ...bound() }) }
  // El resultado del lote se muestra al cerrarlo: mientras está abierto lo dice la
  // propia hoja, y el aviso de la página no le saca el foco.
  const closeBatch = results => {
    const key = batch.key
    setBatch(null)
    reportIssued(results, key)
  }

  const invoicingActions = {
    busy: locked,
    failures: issueFailures,
    selected: selectedIds,
    opensOn,
    canIssue,
    canSelect: r => canIssue(r) && !opensOn,
    onIssueRow: row => setIssuing({ row, ...bound() }),
    onToggle: id => setSelectedIds(s => (s.has(id) ? without(s, [id]) : new Set([...s, id]))),
    onClearSelection: () => setSelectedIds(new Set()),
    onIssueSelected: list => openBatch(list)
  }

  const actions = {
    busy: locked,
    // Escribiendo de verdad (no solo recargando el padrón).
    writing: busy,
    dateWindow,
    dates,
    failures,
    ready,
    outOfRange: withDate.length - ready.length,
    hiddenReady: ready.filter(r => !visible.some(v => v.id === r.id)).length,
    selected: selectedIds,
    canCollect: r => canCollect(r, rules),
    canSelect: r => canCollect(r, rules),
    revertBlock: r => revertBlock(r, rules),
    dateError: r => paymentDateError(dates[r.id], dateWindow),
    onDate: (id, value) => {
      setDates(d => ({ ...d, [id]: value }))
      setFailures(f => (id in f ? Object.fromEntries(Object.entries(f).filter(([k]) => k !== id)) : f))
    },
    onClearDates: () => { setDates({}); setNotes({}) },
    onToggle: id => setSelectedIds(s => (s.has(id) ? without(s, [id]) : new Set([...s, id]))),
    onClearSelection: () => setSelectedIds(new Set()),
    onPayRow: row => pay([row], () => dates[row.id], r => notes[r.id]),
    onPayReady: () => pay(ready, r => dates[r.id], r => notes[r.id]),
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
                <CfpSummary
                  domain={domain}
                  collection={totals.collection}
                  invoicing={totals.invoicing}
                  issue={canBill ? { count: issuable.length, opensOn, invoiceDate, busy: locked, onIssueAll: () => openBatch(issuable, true) } : null}
                />
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
                {padron.refreshError && (
                  <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
                    <span>No se pudo actualizar el padrón: lo que ves puede estar desactualizado.</span>
                    <button type="button" onClick={padron.reload} className="shrink-0 font-semibold underline decoration-amber-300 hover:text-amber-950">Reintentar</button>
                  </div>
                )}
                <CfpTable
                  domain={domain}
                  rows={visible}
                  year={year}
                  month={month}
                  actions={domain === 'collection' ? actions : canBill ? invoicingActions : null}
                />
              </>
            )}
          </LoadState>
        </section>

        {paying && (
          <PaymentSheet
            rows={paying}
            defaultDate={sharedDate(paying)}
            defaultNote={sharedNote(paying)}
            dateWindow={dateWindow}
            busy={locked}
            onCancel={() => setPaying(null)}
            onConfirm={({ date, note }) => pay(paying, () => date, () => note, { date, note })}
          />
        )}
        {reverting && (
          <RevertSheet row={reverting} busy={locked} onCancel={() => setReverting(null)} onConfirm={() => revert(reverting)} />
        )}
        {issuing && (
          <InvoiceSheet
            row={issuing.row}
            monthLabel={issuing.monthLabel}
            invoiceDate={issuing.invoiceDate}
            busy={locked}
            onCancel={() => setIssuing(null)}
            onConfirm={() => issueOne(issuing)}
          />
        )}
        {batch && (
          <InvoiceBatchSheet
            rows={batch.rows}
            year={batch.year}
            month={batch.month}
            monthLabel={batch.monthLabel}
            invoiceDate={batch.invoiceDate}
            excluded={batch.all && rows ? rows.filter(r => r.invoiceStatus !== 'invoiced' && r.billable > 0 && !canIssue(r)).length : 0}
            onRunningChange={setBusy}
            onRunFinished={() => invalidate('padron')}
            onClose={closeBatch}
          />
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
