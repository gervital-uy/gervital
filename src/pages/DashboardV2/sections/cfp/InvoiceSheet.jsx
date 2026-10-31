import { useId } from 'react'
import Sheet from '../../ui/Sheet'
import { formatLongDate, money } from '../../format'
import { ivaOf } from '../../../../services/dashboardV2/padron'
import { invoicePreview } from '../../../../services/dashboardV2/invoicing'

const BOX = 'rounded-xl border border-gray-100 px-4 py-3'
const CAPTION = 'text-[10px] font-semibold uppercase tracking-wide text-gray-400'

function ReceiverField({ label, value, missing, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12.5px]">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`truncate ${value ? (tone || 'text-gray-700') : 'text-amber-700 font-medium'}`}>{value || missing}</span>
    </div>
  )
}

// Paso previo de una factura: qué se emite, a quién y con qué fecha. Muestra el
// texto que va impreso en el comprobante y el monto que sale, que es el servicio del
// mes (en un primer mes de promo, no el paquete cobrado).
export default function InvoiceSheet({ row, monthLabel, invoiceDate, busy, onCancel, onConfirm }) {
  const titleId = useId()
  const name = `${row.firstName} ${row.lastName}`.trim()
  const { lines, items, total } = invoicePreview(row)
  const iva = ivaOf(lines)
  const isRetry = !!row.emitError
  const packageCollected = row.promoIndex === 1 && row.paymentStatus === 'paid' && Math.abs((row.paidAmount ?? 0) - total) > 1
  const emailBad = row.warnings.includes('correo inválido')

  return (
    <Sheet open onClose={busy ? () => {} : onCancel} labelledBy={titleId} maxWidth="sm:max-w-md">
      <div className="px-5 pt-5 pb-3 border-b border-gray-100">
        <h3 id={titleId} className="text-[15px] font-semibold text-gray-900">
          {isRetry ? 'Reintentar la factura' : 'Emitir la factura'}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">{name} · {monthLabel}</p>
      </div>

      <div className="px-5 py-4 flex flex-col gap-3">
        <div className={`${BOX} bg-gray-50/60 flex flex-col gap-1.5`}>
          <p className={CAPTION}>Detalle impreso en la factura</p>
          {items.map(item => (
            <div key={item.concept} className="flex items-start justify-between gap-3 text-[12.5px]">
              <span className="text-gray-700 leading-snug">
                {item.concept}
                <span className="text-gray-400"> · IVA {item.vatRate}%</span>
              </span>
              <span className="tabular-nums text-gray-700 shrink-0">{money(item.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-[13px] pt-1.5 border-t border-gray-200">
            <span className="font-medium text-gray-700">Total de la factura</span>
            <span className="font-semibold tabular-nums text-gray-900">{money(total)}</span>
          </div>
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-gray-400">IVA incluido</span>
            <span className="tabular-nums text-gray-500">{money(iva)}</span>
          </div>
        </div>

        {packageCollected && (
          <p className="text-[12px] text-gray-500 leading-relaxed">
            Es el primer mes de la promo: se factura el servicio del mes, no el paquete de {money(row.paidAmount)} que se cobró.
            Los meses siguientes se facturan cada uno por su servicio.
          </p>
        )}

        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Fecha de emisión y vencimiento</p>
          <p className="text-[15px] font-semibold text-gray-900 mt-0.5 tabular-nums">{formatLongDate(invoiceDate)}</p>
          <p className="text-[11.5px] text-gray-500 mt-1 leading-relaxed">
            Último día hábil de {monthLabel}. Se emite con esa fecha, no con la de hoy.
          </p>
        </div>

        <div className={`${BOX} flex flex-col gap-1`}>
          <p className={CAPTION}>Datos del receptor</p>
          <ReceiverField label="Documento" value={row.documentNumber} missing="falta la CI" />
          <ReceiverField label="Correo" value={row.email} missing="sin correo" tone={emailBad ? 'text-amber-700 font-medium' : null} />
          <ReceiverField label="Dirección" value={row.street} missing="sin dirección" />
          {row.warnings.length > 0 && (
            <p className="text-[11.5px] text-amber-800 mt-1 leading-relaxed">
              La factura se emite igual{row.warnings.some(w => w.includes('correo')) ? ', pero Biller no puede mandarla por correo' : ''}: los datos se corrigen en la ficha del cliente.
            </p>
          )}
        </div>

        {isRetry && (
          <p className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-[12.5px] text-amber-900 leading-relaxed break-words">
            El intento anterior falló: {row.emitError}
          </p>
        )}

        <p className="text-[12.5px] text-gray-500">
          Una factura emitida no se puede borrar: se anula desde la ficha del cliente, con una nota de crédito.
        </p>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="text-[13px] font-medium text-gray-500 hover:text-gray-700 px-3 py-2 disabled:opacity-40">
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-60"
        >
          {busy ? 'Emitiendo…' : isRetry ? 'Reintentar' : 'Emitir factura'}
        </button>
      </div>
    </Sheet>
  )
}
