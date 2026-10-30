import { Link } from 'react-router-dom'
import Card from '../../../../components/ui/Card'
import Avatar from '../../ui/Avatar'
import Chip from '../../ui/Chip'
import { DASH, formatShortDate, money, plural } from '../../format'
import { paymentOffset, rowAmount } from '../../../../services/dashboardV2/padron'
import {
  benefitOf, collectionChips, collectionDetail, conceptOf, holderOf, invoiceChips, invoiceDetail, isStruck
} from './cfpText'
import PaymentDateCell from './PaymentDateCell'

const COLUMNS = {
  collection: [
    { label: 'Cliente', width: '25%', cls: 'px-4' },
    { label: 'Estado', width: '11%', cls: 'px-2' },
    { label: 'Detalle de transferencia', width: '27%', cls: 'px-2' },
    { label: 'Monto', width: '11%', cls: 'px-3 text-right tracking-normal' },
    { label: 'Fecha de pago', width: '14%', cls: 'px-2 text-center' },
    { label: 'Acción', width: '12%', cls: 'px-3 text-center tracking-normal' }
  ],
  invoicing: [
    { label: 'Cliente', width: '30%', cls: 'px-4' },
    { label: 'Estado', width: '19%', cls: 'px-2' },
    { label: 'Comprobante', width: '36%', cls: 'px-2' },
    { label: 'Monto', width: '15%', cls: 'px-3 text-right tracking-normal' }
  ]
}

const OFFSET_CLS = { anticipado: 'text-blue-600', atrasado: 'text-amber-600' }

function PaymentDate({ row, year, month, actions }) {
  if (row.paymentStatus === 'paid') {
    const offset = paymentOffset(row.paidDate, year, month)
    return (
      <>
        <span className="block text-[12px] text-gray-600 tabular-nums">{formatShortDate(row.paidDate)}</span>
        {offset && <span className={`text-[10px] font-medium ${OFFSET_CLS[offset]}`}>{offset}</span>}
      </>
    )
  }
  if (row.paymentStatus === 'prepaid' && row.promoPaidDate) {
    return (
      <>
        <span className="block text-[12px] text-gray-600 tabular-nums">{formatShortDate(row.promoPaidDate)}</span>
        <span className="text-[10px] text-blue-600">pago del paquete</span>
      </>
    )
  }
  if (actions?.canCollect(row)) {
    const value = actions.dates[row.id] || ''
    const offset = paymentOffset(value, year, month)
    return (
      <>
        <PaymentDateCell
          value={value}
          min={actions.dateWindow.min}
          max={actions.dateWindow.max}
          disabled={actions.busy}
          onChange={v => actions.onDate(row.id, v)}
          label={`Fecha de pago de ${row.firstName} ${row.lastName}`}
        />
        {offset && <span className={`block mt-0.5 text-[10px] font-medium ${OFFSET_CLS[offset]}`}>pago {offset}</span>}
      </>
    )
  }
  return <span className="text-[12px] text-gray-300">{DASH}</span>
}

function RowAction({ row, actions }) {
  if (actions.canCollect(row)) {
    const dateError = actions.dateError(row)
    return (
      <button
        type="button"
        onClick={e => { e.stopPropagation(); actions.onPayRow(row) }}
        disabled={actions.busy || !!dateError}
        title={dateError ? 'Cargá primero la fecha del pago' : undefined}
        className="text-[12px] font-semibold text-emerald-700 hover:text-emerald-800 rounded-lg border border-emerald-200 px-2.5 py-1 hover:bg-emerald-50 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        {row.promoIndex === 1 ? 'Cobrar paquete' : 'Marcar cobrado'}
      </button>
    )
  }
  if (row.paymentStatus === 'paid') {
    const block = actions.revertBlock(row)
    if (block) return <span className="text-[12px] text-gray-300" title={block}>{DASH}</span>
    return (
      <button
        type="button"
        onClick={e => { e.stopPropagation(); actions.onRevert(row) }}
        disabled={actions.busy}
        className="text-[12px] text-gray-400 hover:text-rose-600 transition-colors disabled:opacity-40"
      >
        Revertir
      </button>
    )
  }
  return <span className="text-[12px] text-gray-300">{DASH}</span>
}

// El padrón del mes. En Cobranza se cobra desde acá (con `actions`): fecha por fila,
// selección y revertir. Facturación sigue de solo lectura hasta la fase 4. El nombre
// lleva a la ficha del cliente.
export default function CfpTable({ domain, rows, year, month, actions }) {
  const isCollection = domain === 'collection'
  const columns = COLUMNS[domain].filter(c => isCollection ? (actions || c.label !== 'Acción') : true)
  const selectedRows = isCollection && actions ? rows.filter(r => actions.selected.has(r.id)) : []
  const selectedTotal = selectedRows.reduce((s, r) => s + r.due, 0)
  const ready = actions?.ready || []

  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
      {/* Cobros preparados: cada fila se registra con la fecha que se le cargó, así
          que no hace falta seleccionar nada. */}
      {isCollection && ready.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-emerald-100 bg-emerald-50/60 px-5 py-2.5">
          <span className="text-[12.5px] text-emerald-900">
            <span className="font-semibold tabular-nums">{ready.length}</span>
            {ready.length === 1 ? ' cobro con fecha cargada' : ' cobros con fecha cargada'}
            <span className="text-emerald-700"> · </span>
            <span className="font-semibold tabular-nums">{money(ready.reduce((s, r) => s + r.due, 0))}</span>
            {actions.hiddenReady > 0 && <span className="text-emerald-700"> · {actions.hiddenReady} fuera de este filtro</span>}
          </span>
          <button
            type="button"
            onClick={actions.onClearDates}
            disabled={actions.busy}
            className="text-[11.5px] text-emerald-800/70 hover:text-emerald-900 underline decoration-emerald-300 disabled:opacity-40"
          >
            Vaciar fechas
          </button>
          <button
            type="button"
            onClick={actions.onPayReady}
            disabled={actions.busy}
            className="ml-auto rounded-xl bg-emerald-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors disabled:opacity-60"
          >
            {actions.busy ? 'Registrando…' : `Marcar cobrados (${ready.length})`}
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className={`w-full text-left table-fixed ${isCollection ? 'min-w-[820px]' : 'min-w-[640px]'}`}>
          <colgroup>
            {columns.map(c => <col key={c.label} style={{ width: c.width }} />)}
          </colgroup>
          <thead>
            <tr className="bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-400">
              {columns.map(c => <th key={c.label} scope="col" className={`${c.cls} py-2.5 font-semibold`}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-gray-400">No hay clientes en este filtro</td></tr>
            )}
            {rows.map(r => {
              const chips = isCollection ? collectionChips(r) : invoiceChips(r)
              const benefit = isCollection ? null : benefitOf(r)
              const struck = isStruck(r, domain)
              const selectable = isCollection && actions?.canCollect(r)
              const isSelected = selectable && actions.selected.has(r.id)
              const name = `${r.firstName} ${r.lastName}`
              return (
                <tr
                  key={r.id}
                  onClick={selectable && !actions.busy ? () => actions.onToggle(r.id) : undefined}
                  className={`text-[13px] transition-colors ${selectable ? 'cursor-pointer' : ''} ${
                    isSelected ? 'bg-emerald-50/70 shadow-[inset_3px_0_0_0_#059669]' : 'hover:bg-gray-50/70'
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={actions.busy}
                          onClick={e => e.stopPropagation()}
                          onChange={() => actions.onToggle(r.id)}
                          aria-label={`Seleccionar a ${name}`}
                          className="w-3.5 h-3.5 shrink-0 accent-emerald-600 cursor-pointer"
                        />
                      )}
                      <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={r.avatarUrl} />
                      <Link
                        to={`/clientes/${r.id}`}
                        onClick={e => e.stopPropagation()}
                        className="font-medium text-gray-800 truncate hover:text-emerald-700 hover:underline"
                      >
                        {name}
                      </Link>
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {chips.map(m => <Chip key={m.label} meta={m} />)}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-[12px] text-gray-500">
                    {isCollection ? (
                      <>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate min-w-[6rem] text-[13px] text-gray-900 font-medium" title={holderOf(r)}>{holderOf(r)}</span>
                          <span className="min-w-0 truncate"><Chip meta={conceptOf(r)} /></span>
                        </div>
                        <span className="block truncate mt-0.5 text-[11px] text-gray-400" title={collectionDetail(r)}>{collectionDetail(r)}</span>
                      </>
                    ) : (
                      <>
                        <span className="block truncate text-[13px] text-gray-700" title={invoiceDetail(r)}>{invoiceDetail(r)}</span>
                        {benefit && (
                          <span className="flex items-center gap-1.5 mt-0.5 min-w-0">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: benefit.color }} />
                            <span className="truncate text-[11px] text-gray-400">{benefit.label}</span>
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900">
                    {struck
                      ? <span className="text-gray-400 line-through font-normal">{money(r.amount)}</span>
                      : money(rowAmount(r, domain))}
                  </td>
                  {isCollection && (
                    <td className="px-2 py-2.5 text-center">
                      <PaymentDate row={r} year={year} month={month} actions={actions} />
                    </td>
                  )}
                  {isCollection && actions && (
                    <td className="px-3 py-2.5 text-center">
                      <RowAction row={r} actions={actions} />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Barra de cobro masivo: aparece con la selección y registra todo con una misma fecha. */}
      {selectedRows.length > 0 && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-gray-100 bg-gray-50/90 px-5 py-3 backdrop-blur">
          <span className="text-[13px] text-gray-600">
            {plural(selectedRows.length, 'cliente', 'clientes')} ·{' '}
            <span className="font-semibold tabular-nums text-gray-900">{money(selectedTotal)}</span>
          </span>
          <button type="button" onClick={actions.onClearSelection} disabled={actions.busy} className="text-[12px] text-gray-500 hover:text-gray-700 disabled:opacity-40">
            Limpiar
          </button>
          <button
            type="button"
            onClick={() => actions.onPaySelected(selectedRows)}
            disabled={actions.busy}
            className="ml-auto rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-60"
          >
            Registrar cobro ({selectedRows.length})
          </button>
        </div>
      )}
    </Card>
  )
}
