import { billableTotal } from '../invoices/invoiceAmounts'
import { promoMonthCollection } from '../promotions/promotionsView'

// Filas del modal masivo (mode 'pay' = cobrar, 'emit' = facturar) a partir de las
// filas del panel de cobranza.
// Cobrar respeta las promos prepagas igual que el panel: el mes ancla cobra el
// paquete entero y se cobra como promo (promoId → collect_promo); los meses 2..N
// ya están cubiertos y no se cobran sueltos.
// Facturar = lo cobrado si el mes ya se cobró (regla: facturar = lo cobrado).
export function buildBulkRows(panelRows, mode) {
  const isPay = mode === 'pay'
  return (panelRows || [])
    .filter(r => isPay
      ? (r.paymentStatus !== 'paid' && r.paymentStatus !== 'prepaid')
      : r.invoiceStatus !== 'invoiced')
    .map(r => {
      const amount = isPay
        ? promoMonthCollection({ promoIndex: r.promoIndex, promoTotalAmount: r.promoTotalAmount, monthAmount: r.amount }).due
        : billableTotal({ paymentStatus: r.paymentStatus, paidAmount: r.paidAmount, liveAmount: r.amount })
      const coveredByPromo = isPay && r.promoIndex != null && r.promoIndex > 1
      const eligibility = (!isPay && !r.documentNumber) ? 'sin CI'
        : coveredByPromo ? 'en promo'
        : amount <= 0 ? 'monto 0'
        : 'listo'
      return {
        id: r.id,
        name: `${r.firstName} ${r.lastName}`,
        transferResponsible: r.transferResponsible,
        amount,
        paymentStatus: r.paymentStatus,
        paidAmount: r.paidAmount,
        eligibility,
        promoId: isPay && r.promoIndex === 1 ? r.promoId : null
      }
    })
}
