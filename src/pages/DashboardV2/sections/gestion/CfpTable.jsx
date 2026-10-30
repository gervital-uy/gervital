import { Link } from 'react-router-dom'
import Card from '../../../../components/ui/Card'
import Avatar from '../../ui/Avatar'
import Chip from '../../ui/Chip'
import { DASH, formatShortDate, money } from '../../format'
import { paymentOffset } from '../../../../services/dashboardV2/padron'
import {
  benefitOf, collectionChips, collectionDetail, conceptOf, holderOf, invoiceChips, invoiceDetail, rowAmount
} from './cfpText'

const COLUMNS = {
  cobranza: [
    { label: 'Cliente', width: '27%', cls: 'px-4' },
    { label: 'Estado', width: '14%', cls: 'px-2' },
    { label: 'Detalle de transferencia', width: '32%', cls: 'px-2' },
    { label: 'Monto', width: '12%', cls: 'px-3 text-right tracking-normal' },
    { label: 'Fecha de pago', width: '15%', cls: 'px-2 text-center' }
  ],
  facturacion: [
    { label: 'Cliente', width: '30%', cls: 'px-4' },
    { label: 'Estado', width: '19%', cls: 'px-2' },
    { label: 'Comprobante', width: '36%', cls: 'px-2' },
    { label: 'Monto', width: '15%', cls: 'px-3 text-right tracking-normal' }
  ]
}

function PaidDate({ row, year, month }) {
  if (row.paymentStatus === 'paid') {
    const offset = paymentOffset(row.paidDate, year, month)
    return (
      <>
        <span className="block text-[12px] text-gray-600 tabular-nums">{formatShortDate(row.paidDate)}</span>
        {offset && <span className={`text-[10px] font-medium ${offset === 'anticipado' ? 'text-blue-600' : 'text-amber-600'}`}>{offset}</span>}
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
  return <span className="text-[12px] text-gray-300">{DASH}</span>
}

// Padrón del mes, de solo lectura: el cobro y la emisión todavía se hacen desde la
// ficha del cliente (el nombre lleva ahí).
export default function CfpTable({ domain, rows, year, month }) {
  const columns = COLUMNS[domain]
  const isCollection = domain === 'cobranza'

  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className={`w-full text-left table-fixed ${isCollection ? 'min-w-[640px]' : 'min-w-[520px]'}`}>
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
              const concept = conceptOf(r)
              // Un mes cubierto por un paquete no cobra nada: se muestra su valor tachado.
              const struck = isCollection && r.expected === 0 && r.promoIndex > 1
              return (
                <tr key={r.id} className="text-[13px] transition-colors hover:bg-gray-50/70">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={r.avatarUrl} />
                      <Link to={`/clientes/${r.id}`} className="font-medium text-gray-800 truncate hover:text-emerald-700 hover:underline">
                        {r.firstName} {r.lastName}
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
                          <span className="truncate text-[13px] text-gray-900 font-medium">{holderOf(r)}</span>
                          <Chip meta={concept} />
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
                      <PaidDate row={r} year={year} month={month} />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
