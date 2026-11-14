import { useId } from 'react'

// Motivo opcional de un descuento o una promo prepaga (texto libre). Lo usan
// ApplyDiscountModal y PrepaidPromoModal; se muestra en el bloque Promociones y otros
// descuentos del dashboard.
export const REASON_MAX_LENGTH = 300

// Lo que se manda al RPC: recortado y, si queda vacío, null.
export const reasonOrNull = text => (text || '').trim() || null

export default function BenefitReasonField({ value, onChange }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        Motivo <span className="normal-case tracking-normal font-normal text-gray-300">(opcional)</span>
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={REASON_MAX_LENGTH}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Ej.: situación económica, convenio, reclamo"
        className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
      />
    </div>
  )
}
