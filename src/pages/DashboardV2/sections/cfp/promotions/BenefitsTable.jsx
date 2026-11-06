import { Link } from 'react-router-dom'
import Card from '../../../../../components/ui/Card'
import Avatar from '../../../ui/Avatar'
import Chip from '../../../ui/Chip'
import InfoButton from '../../../explain/InfoButton'
import { DASH, formatShortDate, money, plural } from '../../../format'
import { STATE_META, monthsText, nextText, rangeText, shortOfOrd } from './benefitsFormat'

// Avance del acuerdo dentro de su propio plazo.
function Progress({ row, history }) {
  if (history || row.state === 'expired') {
    return (
      <div className="w-[76px]">
        <p className="text-[11px] text-gray-400">Completado</p>
        <div className="mt-1 h-1 w-full rounded-full bg-gray-200" />
      </div>
    )
  }
  if (row.state === 'upcoming') return <span className="text-[11px] text-gray-400">Arranca {shortOfOrd(row.startOrd)}</span>
  if (row.index == null) return <span className="text-[11px] text-gray-300">{DASH}</span>
  return (
    <div className="w-[76px]">
      <p className="text-[11px] text-gray-500 tabular-nums">Mes {row.index} de {row.months}</p>
      <div className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="bg-gray-400" style={{ width: `${(row.index / row.months) * 100}%` }} />
      </div>
    </div>
  )
}

function DiscountCell({ row, history }) {
  if (history) {
    return (
      <>
        <span className="block">{money(row.discountTotal)}</span>
        {row.discountTotalMissing > 0 && (
          <span className="block text-[10px] text-gray-400">{plural(row.discountTotalMissing, 'mes sin dato', 'meses sin dato')}</span>
        )}
      </>
    )
  }
  return (
    <>
      <span className="block">{row.monthDiscount == null ? DASH : money(row.monthDiscount)}</span>
      {row.monthDiscountEstimated && <span className="block text-[10px] text-gray-400">estimado</span>}
    </>
  )
}

// Una tabla del bloque: promos prepagas o descuentos sueltos (kind 'promo' | 'discount'),
// del mes o del historial. Solo lectura: crear, cobrar o cancelar vive en la ficha.
export default function BenefitsTable({ title, hint, docId, rows, kind, history = false, empty }) {
  const isPromo = kind === 'promo'
  const columns = [
    { label: 'Cliente', cls: 'px-5 text-left' },
    { label: 'Plazo', cls: 'px-2 text-left w-[84px]' },
    { label: '% dto', cls: 'px-2 text-center w-[64px] tracking-normal' },
    { label: 'Avance', cls: 'px-2 text-left w-[104px]' },
    { label: history ? 'Dto total' : 'Dto del mes', cls: 'px-3 text-right w-[112px] tracking-normal' },
    ...(isPromo
      ? [{ label: 'Paquete', cls: 'px-3 text-right w-[128px] tracking-normal' }]
      : history ? [] : [{ label: 'Cuota del mes', cls: 'px-3 text-right w-[124px] tracking-normal' }]),
    { label: 'Estado', cls: 'px-3 text-center w-[108px]' }
  ]

  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-clip">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-gray-900 flex items-center gap-1">
            {title}
            {docId && <InfoButton id={docId} />}
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>
        </div>
        <span className="text-[11px] text-gray-400 tabular-nums shrink-0">{rows.length}</span>
      </div>

      <div className="overflow-x-auto">
        <table className={`w-full table-fixed ${history && !isPromo ? 'min-w-[620px]' : 'min-w-[740px]'}`}>
          <thead>
            <tr className="bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-400">
              {columns.map(c => <th key={c.label} scope="col" className={`${c.cls} py-2.5 font-semibold`}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-5 py-10 text-center text-sm text-gray-400">{empty}</td></tr>
            )}
            {rows.map(r => {
              const name = `${r.firstName} ${r.lastName}`.trim()
              const after = nextText(r.next)
              return (
                <tr key={r.id} className="text-[13px] hover:bg-gray-50/70 transition-colors">
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={r.avatarUrl} />
                      <div className="min-w-0">
                        <Link to={`/clientes/${r.clientId}`} className="block font-medium text-gray-800 truncate hover:text-emerald-700 hover:underline">
                          {name || DASH}
                        </Link>
                        <p className="text-[11px] text-gray-400 truncate">
                          {rangeText(r)}{after && <span className="text-gray-500"> · {after}</span>}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-[12px] font-medium text-gray-700">{monthsText(r.months)}</td>
                  <td className="px-2 py-2.5 text-center">
                    <span className={`text-[12px] font-semibold tabular-nums rounded-full px-2 py-0.5 ${isPromo ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {r.percent}%
                    </span>
                  </td>
                  <td className="px-2 py-2.5"><Progress row={r} history={history} /></td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-600"><DiscountCell row={r} history={history} /></td>
                  {isPromo && (
                    <td className="px-3 py-2.5 text-right">
                      <span className="block font-semibold tabular-nums text-gray-900">{money(r.packageAmount)}</span>
                      <span className={`block text-[10px] ${r.collected ? 'text-gray-400' : 'text-amber-600 font-medium'}`}>
                        {r.collected ? `cobrado ${formatShortDate(r.paidDate)}` : 'sin cobrar'}
                      </span>
                    </td>
                  )}
                  {!isPromo && !history && (
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                      {r.monthAmount == null ? DASH : money(r.monthAmount)}
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-center"><Chip meta={STATE_META[history ? 'expired' : r.state]} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
