/**
 * Corrección de un mes ya pago cuyo monto cambió (típicamente al marcar un día
 * como no cobrable, o al deshacer esa falta).
 *
 * Puro a propósito: el front usa esto solo para DECIDIR si abre el modal y qué
 * diferencia mostrar. El monto que se persiste lo recalcula la RPC
 * apply_month_billing_correction del lado del servidor — si el número viajara
 * desde el browser, un bug de redondeo en la UI se escribiría como monto cobrado.
 */

// Los montos se cobran redondeados a peso; comparar en flotante daría
// diferencias fantasma de centavos.
const toPesos = (n) => Math.round(Number(n) || 0)

/**
 * @param {{ isPaid: boolean, paidAmount: number|null, recalculatedAmount: number }} p
 * @returns {boolean}
 */
export function shouldPromptCorrection({ isPaid, paidAmount, recalculatedAmount }) {
  if (!isPaid) return false
  if (paidAmount === null || paidAmount === undefined) return false
  return toPesos(paidAmount) !== toPesos(recalculatedAmount)
}

/**
 * @param {{ paidAmount: number, recalculatedAmount: number }} p
 * @returns {{ amount: number, direction: 'refund' | 'debt' }} amount siempre positivo
 */
export function correctionDelta({ paidAmount, recalculatedAmount }) {
  const diff = toPesos(paidAmount) - toPesos(recalculatedAmount)
  return { amount: Math.abs(diff), direction: diff >= 0 ? 'refund' : 'debt' }
}
