import { MONTH_FULL, MONTH_SHORT } from '../../../format'
import { ymOfOrdinal } from '../../../../../services/dashboardV2/benefitsView'
import { promoOrdinal } from '../../../../../services/promotions/promotionsView'

// Textos del bloque Promociones y otros descuentos. Un mes se identifica por su
// ordinal (year * 12 + month), como en benefitsView.

export const ordOfIso = iso => promoOrdinal(Number(String(iso).slice(0, 4)), Number(String(iso).slice(5, 7)) - 1)

// ord → "oct 26"
export const shortOfOrd = ord => {
  const { year, month } = ymOfOrdinal(ord)
  return `${MONTH_SHORT[month]} ${String(year).slice(2)}`
}

// ord → "octubre 2026"
export const longOfOrd = ord => {
  const { year, month } = ymOfOrdinal(ord)
  return `${MONTH_FULL[month]} ${year}`
}

export const rangeText = a => (a.startOrd === a.endOrd ? shortOfOrd(a.startOrd) : `${shortOfOrd(a.startOrd)} – ${shortOfOrd(a.endOrd)}`)

export const monthsText = n => (n === 1 ? '1 mes' : `${n} meses`)

// Lo que sigue sin corte después de un acuerdo: otra promo o el próximo escalón.
export const nextText = next => (!next ? null : next.kind === 'promo' ? 'sigue con otra promo' : `sigue con ${next.percent}%`)

export const STATE_META = {
  expiring: { label: 'Por renovar', cls: 'bg-amber-50 text-amber-700' },
  active: { label: 'Vigente', cls: 'bg-emerald-50 text-emerald-700' },
  upcoming: { label: 'Próximo', cls: 'bg-sky-50 text-sky-700' },
  expired: { label: 'Finalizado', cls: 'bg-gray-100 text-gray-500' }
}
