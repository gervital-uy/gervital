import { useId, useState } from 'react'
import Sheet from '../../ui/Sheet'
import { money, plural } from '../../format'
import { paymentDateError } from '../../../../services/dashboardV2/collect'

// Registrar el cobro de varias filas con una misma fecha. La fecha es la del
// depósito, no la de hoy: un pago del 3 registrado el 20 tiene que quedar con su
// fecha real, o la tasa de cobro del mes miente.
export default function PaymentSheet({ rows, defaultDate, defaultNote = '', dateWindow, busy, onCancel, onConfirm }) {
  const titleId = useId()
  const [date, setDate] = useState(defaultDate || '')
  const [note, setNote] = useState(defaultNote)
  const [error, setError] = useState(null)
  const total = rows.reduce((s, r) => s + r.due, 0)
  const packages = rows.filter(r => r.promoIndex === 1).length

  const confirm = () => {
    const problem = paymentDateError(date, dateWindow)
    if (problem) { setError(problem); return }
    onConfirm({ date, note })
  }

  return (
    <Sheet open onClose={busy ? () => {} : onCancel} labelledBy={titleId} maxWidth="sm:max-w-md">
      <div className="px-5 pt-5 pb-3 border-b border-gray-100">
        <h3 id={titleId} className="text-[15px] font-semibold text-gray-900">Registrar cobro</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          {plural(rows.length, 'cliente', 'clientes')} · <span className="tabular-nums font-medium text-gray-600">{money(total)}</span>
        </p>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        {rows.length <= 6 && (
          <ul className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2 flex flex-col gap-1">
            {rows.map(r => (
              <li key={r.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="truncate text-gray-600">
                  {r.firstName} {r.lastName}
                  {r.transferResponsible && <span className="text-gray-400"> · transfiere {r.transferResponsible}</span>}
                </span>
                <span className="tabular-nums text-gray-800 shrink-0">{money(r.due)}</span>
              </li>
            ))}
          </ul>
        )}

        {packages > 0 && (
          <p className="text-[12px] text-gray-500 leading-relaxed">
            {packages === 1 ? 'Incluye un paquete de promo: se cobra entero' : `Incluye ${packages} paquetes de promo: cada uno se cobra entero`} y los meses siguientes quedan cubiertos.
          </p>
        )}

        <div>
          <label htmlFor="cfp-payment-date" className="block text-[12px] font-medium text-gray-600 mb-1">
            Fecha del depósito o pago <span className="text-rose-500">*</span>
          </label>
          <input
            id="cfp-payment-date"
            type="date"
            value={date}
            min={dateWindow.min}
            max={dateWindow.max}
            onChange={e => { setDate(e.target.value); setError(null) }}
            className="w-full text-[13px] rounded-xl border border-gray-200 px-3 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          />
          <p className="text-[11px] text-gray-400 mt-1">La fecha en que entró el dinero, no la de hoy.</p>
        </div>

        <div>
          <label htmlFor="cfp-payment-note" className="block text-[12px] font-medium text-gray-600 mb-1">
            Nota <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <textarea
            id="cfp-payment-note"
            rows={2}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Transferencia a nombre de la hija, efectivo…"
            className="w-full text-[13px] rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-rose-50 border border-rose-100 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>
        )}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="text-[13px] font-medium text-gray-500 hover:text-gray-700 px-3 py-2 disabled:opacity-40">
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-60"
        >
          {busy ? 'Registrando…' : 'Registrar cobro'}
        </button>
      </div>
    </Sheet>
  )
}
