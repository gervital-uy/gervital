// Helpers puros de promociones. Un mes se identifica por su ordinal:
// year * 12 + month (month 0-indexed).

export function promoOrdinal(year, month) {
  return year * 12 + month
}

const startOrd = (p) => promoOrdinal(p.startYear, p.startMonth)
const endOrd = (p) => promoOrdinal(p.endYear, p.endMonth)

// Estado ÚNICO de una promo respecto de un mes de referencia. Devolver un solo
// valor es lo que impide que la misma promo aparezca en dos listas del dashboard.
// - upcoming: todavía no arrancó
// - expiring: vigente y termina este mes o el próximo (ventana de renovación)
// - active:   vigente, sin urgencia
// - expired:  terminó
export function promoState(promo, refYear, refMonth) {
  const ref = promoOrdinal(refYear, refMonth)
  const s = startOrd(promo)
  const e = endOrd(promo)
  if (s > ref) return 'upcoming'
  if (e < ref) return 'expired'
  return e <= ref + 1 ? 'expiring' : 'active'
}

// Posición 1-based del mes dentro de la promo, o null si cae fuera del rango.
export function promoMonthIndex(promo, year, month) {
  const ord = promoOrdinal(year, month)
  const s = startOrd(promo)
  if (ord < s || ord > endOrd(promo)) return null
  return ord - s + 1
}

// Cuánto se cobra en un mes y qué nominal se muestra tachado al lado.
// El paquete entero se cobra en el mes ancla; el resto de los meses no cobran
// nada porque ya están cubiertos. Un mes sin promo cobra lo suyo.
export function promoMonthCollection({ promoIndex, promoTotalAmount, monthAmount }) {
  const month = Number(monthAmount) || 0
  if (promoIndex == null) return { due: month, struck: null }
  const total = Number(promoTotalAmount) || 0
  return { due: promoIndex === 1 ? total : 0, struck: month }
}

// Monto del paquete a mostrar: una vez cobrada manda lo que realmente entró
// (puede diferir del pactado si se ajustó el monto al cobrar); antes, el pactado.
export function promoPackageAmount(promo) {
  if (!promo) return 0
  if (promo.paidDate && promo.paidAmount != null) return Number(promo.paidAmount) || 0
  return Number(promo.totalAmount) || 0
}

// paidDate 'YYYY-MM-DD' -> ordinal de su mes
const paidOrdinal = (paidDate) => {
  if (!paidDate) return null
  const [y, m] = String(paidDate).slice(0, 10).split('-').map(Number)
  return promoOrdinal(y, m - 1)
}

export function promoKpis(promos, refYear, refMonth) {
  const ref = promoOrdinal(refYear, refMonth)
  const states = (promos || []).map(p => ({ promo: p, state: promoState(p, refYear, refMonth) }))
  const current = states.filter(s => s.state === 'active' || s.state === 'expiring')
  // Cash real: sólo promos efectivamente cobradas en el mes de referencia.
  const prepaidCashInPeriod = (promos || [])
    .filter(p => p.paidDate && paidOrdinal(p.paidDate) === ref)
    .reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0)
  // Descuento otorgado: ahorro REAL (sólo asistencia), guardado al crear la promo.
  const totalDiscountGranted = current
    .reduce((sum, { promo }) => sum + (Number(promo.discountAmount) || 0), 0)
  return {
    activeCount: states.filter(s => s.state === 'active').length,
    prepaidCashInPeriod,
    totalDiscountGranted: Math.round(totalDiscountGranted),
    expiringCount: states.filter(s => s.state === 'expiring').length
  }
}
