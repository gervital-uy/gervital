import { useId } from 'react'
import Sheet from '../../ui/Sheet'
import { formatShortDate, money } from '../../format'
import { isNegotiated } from './cfpText'
import { isBrokenPackage } from '../../../../services/dashboardV2/padron'

// Confirmación antes de revertir un cobro: mueve plata registrada, así que dice
// qué se deshace. En un ancla se deshace el paquete entero, y en un paquete roto
// (la promo cobrada con su primer mes pendiente) es la única forma de repararlo.
export default function RevertSheet({ row, busy, onCancel, onConfirm }) {
  const titleId = useId()
  const name = `${row.firstName} ${row.lastName}`.trim()
  const isPackage = row.promoIndex === 1
  const broken = isBrokenPackage(row)

  return (
    <Sheet open onClose={busy ? () => {} : onCancel} labelledBy={titleId} maxWidth="sm:max-w-md">
      <div className="px-5 pt-5 pb-3 border-b border-gray-100">
        <h3 id={titleId} className="text-[15px] font-semibold text-gray-900">
          {isPackage ? 'Deshacer el cobro del paquete' : 'Revertir el cobro'}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">{name}</p>
      </div>
      <div className="px-5 py-4 flex flex-col gap-3 text-[13px] text-gray-600 leading-relaxed">
        {broken ? (
          <p>
            La promo figura cobrada el {formatShortDate(row.promoPaidDate)}, pero este primer mes quedó pendiente (se deshizo
            el cobro solo de este mes desde la ficha) y así no se puede volver a cobrar. Se deshace el cobro del paquete entero:
            todos sus meses vuelven a pendiente.
          </p>
        ) : (
          <p>
            Se borra el cobro de <span className="font-semibold text-gray-900 tabular-nums">{money(row.paidAmount)}</span>
            {row.paidDate && <> registrado el {formatShortDate(row.paidDate)}</>} y el mes vuelve a pendiente.
          </p>
        )}
        {isPackage && (
          <p>Los meses siguientes de la promo dejan de estar cubiertos. La promo sigue pactada y se puede volver a cobrar.</p>
        )}
        {isNegotiated(row) && (
          <p className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-[12.5px] text-amber-900">
            Este cobro tenía un monto pactado. Si lo volvés a registrar desde acá se toma el monto calculado: para respetar el pactado, registralo desde la ficha del cliente.
          </p>
        )}
      </div>
      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="text-[13px] font-medium text-gray-500 hover:text-gray-700 px-3 py-2 disabled:opacity-40">
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-xl bg-rose-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-rose-700 transition-colors disabled:opacity-60"
        >
          {busy ? 'Revirtiendo…' : broken ? 'Deshacer el paquete' : 'Revertir'}
        </button>
      </div>
    </Sheet>
  )
}
