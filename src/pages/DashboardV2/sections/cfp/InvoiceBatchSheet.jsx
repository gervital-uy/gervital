import { useEffect, useId, useRef, useState } from 'react'
import Sheet from '../../ui/Sheet'
import { formatShortDate, money, plural } from '../../format'
import { emitInvoices } from '../../../../services/dashboardV2/invoicing'
import { invoiceDetail, normalizeSearch } from './cfpText'

const STATE = {
  queued: { label: 'en cola', cls: 'bg-gray-100 text-gray-500' },
  emitting: { label: 'emitiendo', cls: 'bg-indigo-50 text-indigo-700' },
  ok: { label: 'emitida', cls: 'bg-emerald-50 text-emerald-700' },
  error: { label: 'rechazada', cls: 'bg-rose-50 text-rose-600' },
  // No llegó a Biller: algo cambió desde que se abrió el lote y reintentar no lo arregla.
  stale: { label: 'no se emitió', cls: 'bg-amber-50 text-amber-700' },
  skipped: { label: 'sin emitir', cls: 'bg-gray-100 text-gray-500' }
}
const stateOf = r => (r.ok ? 'ok' : r.skipped ? 'skipped' : r.stale ? 'stale' : 'error')

// Facturar el mes en lote. Se emite de a una en Biller, en orden y con pausa: cada
// factura espera su respuesta antes de la siguiente, y así se sabe cuál falló. La
// lista queda fija desde que se abre (la recarga del padrón no la mueve), no se
// cierra mientras emite y se puede detener después de la factura en curso. El
// resultado de toda la sesión (reintentos incluidos) se entrega al cerrar.
export default function InvoiceBatchSheet({ rows, year, month, monthLabel, invoiceDate, excluded, onRunningChange, onRunFinished, onClose }) {
  const titleId = useId()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set(rows.map(r => r.id)))
  const [states, setStates] = useState({})
  const [errors, setErrors] = useState({})
  const [running, setRunning] = useState(false)
  // Último resultado de cada fila en la sesión: un reintento pisa al anterior.
  const sessionRef = useRef(new Map())
  const [finishedRuns, setFinishedRuns] = useState(0)
  const stopRef = useRef(false)
  const mountedRef = useRef(false)

  // Si la pantalla se va (otra ruta), el lote se detiene después de la factura en
  // curso. Se marca en el montaje (no solo en el desmontaje) para que el doble
  // montaje de StrictMode no la deje creyéndose desmontada.
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; stopRef.current = true }
  }, [])

  // Cerrar la pestaña a mitad del lote deja facturas sin emitir: el navegador pregunta.
  useEffect(() => {
    if (!running) return
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  const started = Object.keys(states).length > 0
  const q = normalizeSearch(query)
  const visible = q
    ? rows.filter(r => normalizeSearch(`${r.firstName} ${r.lastName} ${r.transferResponsible || ''}`).includes(q))
    : rows
  const shown = started ? rows.filter(r => states[r.id]) : visible
  const amountOf = id => rows.find(r => r.id === id)?.billable || 0
  const selectionTotal = rows.filter(r => selected.has(r.id)).reduce((s, r) => s + r.billable, 0)
  const allVisible = visible.length > 0 && visible.every(r => selected.has(r.id))

  const ids = state => Object.entries(states).filter(([, v]) => v === state).map(([id]) => id)
  const done = ids('ok')
  const failed = ids('error')
  const total = Object.keys(states).length
  const issuedAmount = done.reduce((s, id) => s + amountOf(id), 0)
  // Se reintenta lo que rechazó Biller (o la red) y lo que quedó sin intentar al
  // detener; lo que cambió desde que se abrió el lote no.
  const retryIds = [...failed, ...ids('skipped')]
  const summary = finishedRuns > 0 && !running
    ? { ok: done.length, failed: failed.length, stale: ids('stale').length, skipped: ids('skipped').length }
    : null
  const pendingAfter = summary && summary.failed + summary.stale + summary.skipped > 0

  const toggle = id => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev)
    visible.forEach(r => (allVisible ? next.delete(r.id) : next.add(r.id)))
    return next
  })

  const run = async runIds => {
    const list = rows.filter(r => runIds.includes(r.id))
    if (!list.length || running) return
    stopRef.current = false
    setRunning(true)
    onRunningChange(true)
    setStates(prev => ({ ...prev, ...Object.fromEntries(list.map(r => [r.id, 'queued'])) }))
    setErrors(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !runIds.includes(id))))
    const results = await emitInvoices(list, {
      year,
      month,
      shouldStop: () => stopRef.current,
      onProgress: (id, state, error) => {
        if (!mountedRef.current) return
        setStates(prev => ({ ...prev, [id]: state }))
        if (error) setErrors(prev => ({ ...prev, [id]: error }))
      }
    })
    for (const r of results) sessionRef.current.set(r.id, r)
    onRunningChange(false)
    onRunFinished()
    if (!mountedRef.current) return
    setStates(prev => ({ ...prev, ...Object.fromEntries(results.map(r => [r.id, stateOf(r)])) }))
    setRunning(false)
    setFinishedRuns(n => n + 1)
  }

  const close = () => onClose([...sessionRef.current.values()])

  return (
    <Sheet open onClose={running ? () => {} : close} labelledBy={titleId} maxWidth="sm:max-w-2xl">
      {/* Solo la lista scrollea: el avance, el resultado y los botones quedan a la vista. */}
      <div className="flex flex-col max-h-[88vh]">
        <div className="shrink-0">
          <div className="px-5 pt-5 pb-4 border-b border-gray-100">
            <h3 id={titleId} className="text-[16px] font-semibold text-gray-900">Facturar {monthLabel}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {started
                ? 'Se emite de a una en Biller; cada factura espera la confirmación'
                : `${plural(rows.length, 'factura lista', 'facturas listas')} para emitir`}
            </p>
          </div>

          {started && (
            <div className="px-5 pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium text-gray-700 tabular-nums">Emitidas {done.length} de {total}</span>
                <span className="text-[12px] tabular-nums text-gray-400">
                  {failed.length > 0 && <span className="text-rose-600 font-medium">{plural(failed.length, 'rechazada', 'rechazadas')} · </span>}
                  {money(issuedAmount)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden flex">
                <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${(done.length / (total || 1)) * 100}%` }} />
                <div className="h-full bg-rose-400 transition-all duration-300" style={{ width: `${(failed.length / (total || 1)) * 100}%` }} />
              </div>
            </div>
          )}

          {summary && (
            <div
              role={pendingAfter ? 'alert' : 'status'}
              className={`mx-5 mt-4 rounded-xl border px-4 py-3 ${pendingAfter ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}
            >
              <p className={`text-[13.5px] font-semibold ${pendingAfter ? 'text-amber-900' : 'text-emerald-900'}`}>
                {[
                  plural(summary.ok, 'factura emitida', 'facturas emitidas'),
                  summary.failed ? plural(summary.failed, 'rechazada', 'rechazadas') : null,
                  summary.stale ? `${summary.stale} sin emitir porque cambió` : null,
                  summary.skipped ? `${summary.skipped} sin emitir (se detuvo)` : null
                ].filter(Boolean).join(' · ')}
              </p>
              <p className={`text-[12px] mt-0.5 ${pendingAfter ? 'text-amber-800' : 'text-emerald-800'}`}>
                {money(issuedAmount)} facturados con fecha {formatShortDate(invoiceDate)}
                {summary.failed + summary.skipped > 0 && ' · lo rechazado y lo detenido se puede reintentar'}
                {summary.stale > 0 && ' · lo que cambió se revisa en la tabla: cerrá el lote y volvé a abrirlo'}
              </p>
            </div>
          )}

          {!started && rows.length > 6 && (
            <div className="px-5 pt-4">
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar por nombre o titular…"
                aria-label="Buscar en el lote"
                className="w-full text-[13px] rounded-xl border border-gray-200 bg-white px-3 py-2 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
          )}

          {!started && rows.length > 0 && (
            <div className="px-5 pt-3 flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-[12.5px] text-gray-600 cursor-pointer">
                <input type="checkbox" checked={allVisible} onChange={toggleAll} className="w-4 h-4 rounded border-gray-300 accent-emerald-600" />
                Marcar todas
              </label>
              <span className="text-[12px] text-gray-400 tabular-nums">
                {selected.size} {selected.size === 1 ? 'seleccionada' : 'seleccionadas'} · {money(selectionTotal)}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-3">
          <ul className="rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
            {shown.map(r => {
              const state = states[r.id]
              const meta = state ? STATE[state] : null
              const name = `${r.firstName} ${r.lastName}`
              return (
                <li key={r.id} className={`flex items-start gap-3 px-3 py-2.5 ${state === 'emitting' ? 'bg-indigo-50/40' : ''}`}>
                  {!started && (
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={`Incluir a ${name}`}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-emerald-600 shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-gray-800 truncate">{name}</p>
                    <p className="text-[11px] text-gray-400 truncate">{invoiceDetail(r)}</p>
                    {errors[r.id] && (
                      <p className={`text-[11px] mt-0.5 break-words ${state === 'stale' ? 'text-amber-700' : 'text-rose-600'}`}>{errors[r.id]}</p>
                    )}
                  </div>
                  <span className="text-[13px] font-semibold tabular-nums text-gray-900 shrink-0">{money(r.billable)}</span>
                  <span className="w-[88px] flex justify-end shrink-0">
                    {meta && <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${meta.cls}`}>{meta.label}</span>}
                  </span>
                </li>
              )
            })}
            {shown.length === 0 && (
              <li className="px-3 py-8 text-center text-[13px] text-gray-500">
                {rows.length === 0 ? `No queda ninguna factura lista para emitir en ${monthLabel}.` : 'Ningún cliente coincide con la búsqueda'}
              </li>
            )}
          </ul>

          {!started && excluded > 0 && (
            <p className="mt-3 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              {excluded === 1
                ? 'Queda afuera 1 factura sin cobrar o trabada por la ficha: no se puede emitir todavía.'
                : `Quedan afuera ${excluded} facturas sin cobrar o trabadas por la ficha: no se pueden emitir todavía.`}
            </p>
          )}
        </div>

        <div className="shrink-0">
          <div className="px-5 pb-3">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 flex items-baseline justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Fecha de emisión y vencimiento</p>
              <p className="text-[13.5px] font-semibold text-gray-900 tabular-nums">{formatShortDate(invoiceDate)}</p>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Último día hábil de {monthLabel}. No se edita: todas las facturas del mes salen con esa fecha.
            </p>
          </div>

          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
            {running ? (
              <button
                type="button"
                onClick={() => { stopRef.current = true }}
                className="text-[13px] font-medium text-gray-500 hover:text-gray-700 px-3 py-2"
              >
                Detener después de esta
              </button>
            ) : (
              <button type="button" onClick={close} className="text-[13px] font-medium text-gray-500 hover:text-gray-700 px-3 py-2">
                Cerrar
              </button>
            )}
            {!started || running ? (
              <button
                type="button"
                onClick={() => run([...selected])}
                disabled={running || selected.size === 0}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {running
                  ? `Emitiendo ${Math.min(done.length + failed.length + ids('stale').length + 1, total)} de ${total}…`
                  : `Emitir ${plural(selected.size, 'factura', 'facturas')}`}
              </button>
            ) : retryIds.length > 0 && (
              <button
                type="button"
                onClick={() => run(retryIds)}
                className="rounded-xl bg-amber-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-amber-700 transition-colors"
              >
                Reintentar {retryIds.length}
              </button>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  )
}
