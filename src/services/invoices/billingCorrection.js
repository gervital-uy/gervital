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

/**
 * Meses calendario tocados por un rango de fechas, inclusive. Un rango de
 * faltas puede cruzar meses y descuadrar más de un mes pago.
 * @param {string} fromDate - 'YYYY-MM-DD'
 * @param {string} toDate - 'YYYY-MM-DD'
 * @returns {Array<{year: number, month: number}>} month 0-indexed
 */
export function monthsInRange(fromDate, toDate) {
  const [fy, fm] = String(fromDate).split('-').map(Number)
  const [ty, tm] = String(toDate).split('-').map(Number)
  if (!fy || !fm || !ty || !tm) return []
  const months = []
  for (let i = fy * 12 + (fm - 1), last = ty * 12 + (tm - 1); i <= last; i++) {
    months.push({ year: Math.floor(i / 12), month: i % 12 })
  }
  return months
}
