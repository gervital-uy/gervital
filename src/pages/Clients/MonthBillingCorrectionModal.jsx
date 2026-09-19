import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { formatCurrency } from '../../utils/format'
import { correctionDelta } from '../../services/invoices/billingCorrection'
import { applyMonthBillingCorrection, flagMonthCorrectionPending } from '../../services/api'

// Corrección de meses ya pagos que quedaron descuadrados. `months` puede traer
// más de uno: un rango de faltas cruza meses. Se procesan encadenados, en el
// orden recibido, y cancelar uno marca ese mes y pasa al siguiente.
export default function MonthBillingCorrectionModal({ isOpen, onClose, months, clientId, userName, onDone }) {
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) { setIndex(0); setBusy(false); setError('') }
  }, [isOpen])

  const current = months?.[index]
  if (!current) return null

  const delta = correctionDelta({ paidAmount: current.paidAmount, recalculatedAmount: current.recalculatedAmount })
  const monthLabel = format(new Date(current.year, current.month, 1), 'MMMM yyyy', { locale: es })

  const advance = async () => {
    if (index + 1 < months.length) { setIndex(index + 1); setBusy(false); return }
    setBusy(false)
    await onDone()
    onClose()
  }

  const handleApply = async () => {
    setBusy(true); setError('')
    try {
      await applyMonthBillingCorrection(clientId, current.year, current.month, userName)
      await advance()
    } catch (e) { setError(e.message); setBusy(false) }
  }

  const handleSkip = async () => {
    setBusy(true); setError('')
    try {
      await flagMonthCorrectionPending(clientId, current.year, current.month)
      await advance()
    } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleSkip} title={`Corregir cobro — ${monthLabel}`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Este mes ya está cobrado por un monto que dejó de corresponder.
        </p>

        <dl className="rounded-lg border border-gray-200 divide-y divide-gray-100">
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-sm text-gray-500">Cobrado</dt>
            <dd className="text-sm font-medium text-gray-900">{formatCurrency(current.paidAmount)}</dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-sm text-gray-500">Corresponde</dt>
            <dd className="text-sm font-medium text-gray-900">{formatCurrency(current.recalculatedAmount)}</dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
            <dt className="text-sm font-medium text-gray-700">
              {delta.direction === 'refund' ? 'A favor del cliente' : 'El cliente debe'}
            </dt>
            <dd className={`text-sm font-semibold ${delta.direction === 'refund' ? 'text-red-600' : 'text-emerald-600'}`}>
              {formatCurrency(delta.amount)}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-gray-500">
          Corregir reescribe el monto cobrado del mes. La transferencia se hace por fuera del sistema.
        </p>

        {/* El e-Ticket ya emitido no se re-emite: corregir deja el sistema diciendo
            un monto distinto del que DGI tiene aceptado. */}
        {current.invoiceStatus === 'invoiced' && (
          <p className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            Este mes ya está facturado. Corregirlo reescribe el monto de una factura
            electrónica aceptada por DGI, que no se modifica: habrá que emitir una nota
            de crédito o débito por fuera del sistema.
          </p>
        )}

        {months.length > 1 && (
          <p className="text-xs text-gray-400">Mes {index + 1} de {months.length}</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleSkip} disabled={busy}>Ahora no</Button>
          <Button onClick={handleApply} disabled={busy}>
            {busy ? 'Corrigiendo...' : 'Corregir monto cobrado'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
