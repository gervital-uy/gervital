import { formatDecimal, formatShortDate, money, plural } from '../../format'
import { rowAmount } from '../../../../services/dashboardV2/padron'

// Textos y chips de cada fila del padrón (Gestión CFP). Las cuentas están en
// services/dashboardV2/padron.js; acá solo cómo se dicen. Paneles: 'collection'
// (Cobranza) e 'invoicing' (Facturación).

export const SCHEDULE_SHORT = { morning: 'Mañana', afternoon: 'Tarde', full_day: 'Día completo' }
export const DISTANCE_LABEL = { '0_to_2km': '0 a 2 km', '2_to_5km': '2 a 5 km', '5_to_10km': '5 a 10 km' }

export const CHIPS = {
  paid: { label: 'cobrado', cls: 'bg-emerald-50 text-emerald-700' },
  prepaid: { label: 'prepago', cls: 'bg-blue-50 text-blue-700' },
  pending: { label: 'pendiente', cls: 'bg-amber-50 text-amber-700' },
  overdue: { label: 'vencido', cls: 'bg-rose-50 text-rose-600' },
  inPackage: { label: 'en paquete', cls: 'bg-blue-50 text-blue-700' },
  noCharge: { label: 'sin cargo', cls: 'bg-gray-100 text-gray-500' },
  correction: { label: 'corrección pendiente', cls: 'bg-amber-50 text-amber-700' },
  newThisMonth: { label: 'alta del mes', cls: 'bg-violet-50 text-violet-700' },
  leavingThisMonth: { label: 'baja del mes', cls: 'bg-violet-50 text-violet-700' },
  returningThisMonth: { label: 'reingreso del mes', cls: 'bg-violet-50 text-violet-700' },
  invoiced: { label: 'facturada', cls: 'bg-emerald-50 text-emerald-700' },
  ready: { label: 'lista para emitir', cls: 'bg-amber-50 text-amber-700' },
  notCollected: { label: 'no cobrado', cls: 'bg-gray-100 text-gray-500' },
  mismatch: { label: 'monto distinto', cls: 'bg-amber-50 text-amber-700' },
  dgiPending: { label: 'DGI pendiente', cls: 'bg-gray-100 text-gray-500' },
  dgiRejected: { label: 'rechazada por DGI', cls: 'bg-rose-50 text-rose-600' }
}
const blockChip = label => ({ label, cls: 'bg-rose-50 text-rose-600' })
const warningChip = label => ({ label, cls: 'bg-amber-50 text-amber-700' })

const pctLabel = v => `${Number.isInteger(v) ? v : formatDecimal(v)}%`

// Estado de cobro de la fila, más lo que la distingue (alta, baja o reingreso del
// mes, corrección pendiente).
export function collectionChips(r) {
  const out = []
  if (r.paymentStatus === 'paid') out.push(CHIPS.paid)
  else if (r.paymentStatus === 'prepaid') out.push(CHIPS.prepaid)
  else if (r.awaitingPackage) out.push(CHIPS.inPackage)
  else if (r.due <= 0) out.push(CHIPS.noCharge)
  else out.push(r.isOverdue ? CHIPS.overdue : CHIPS.pending)
  if (r.correctionPending) out.push(CHIPS.correction)
  if (r.leaveDay != null) out.push(CHIPS.leavingThisMonth)
  else if (r.returnDay != null) out.push(CHIPS.returningThisMonth)
  else if (r.startDay != null) out.push(CHIPS.newThisMonth)
  return out
}

// Estado de facturación. Una fila puede estar frenada por dos cosas a la vez (la
// plata y un dato de la ficha): declara todos sus motivos, no solo el primero.
export function invoiceChips(r) {
  if (r.invoiceStatus === 'invoiced') {
    const out = [CHIPS.invoiced]
    if (r.invoiceMismatch) out.push(CHIPS.mismatch)
    if (r.dgiStatus === 'pending_dgi') out.push(CHIPS.dgiPending)
    else if (r.dgiStatus === 'rejected') out.push(CHIPS.dgiRejected)
    else if (r.dgiStatus && r.dgiStatus !== 'accepted') out.push(blockChip(`DGI: ${r.dgiStatus}`))
    return out
  }
  if (r.billable <= 0) return [CHIPS.noCharge]
  const out = []
  if (!r.isCollected) out.push(CHIPS.notCollected)
  if (r.block) out.push(blockChip(r.block.chip))
  else if (r.isCollected) out.push(CHIPS.ready)
  return [...out, ...r.warnings.map(warningChip)]
}

// Qué se le cobra al cliente este mes (el concepto, no el estado).
export function conceptOf(r) {
  if (r.promoIndex === 1) {
    return { label: `Paquete promo ${plural(r.promoTotal, 'mes', 'meses')} · ${pctLabel(r.promoPercent)}`, cls: 'bg-emerald-50 text-emerald-700' }
  }
  if (r.promoIndex > 1) return { label: `Mes de promo · ${r.promoIndex} de ${r.promoTotal}`, cls: 'bg-blue-50 text-blue-700' }
  if (r.discountPercent) return { label: `Con descuento puntual · ${pctLabel(r.discountPercent)}`, cls: 'bg-amber-50 text-amber-700' }
  return { label: 'Cuota del mes', cls: 'bg-gray-100 text-gray-500' }
}

export function planText(r) {
  const base = r.frequency ? `${r.frequency}× ${SCHEDULE_SHORT[r.schedule] || ''}`.trim() : 'Plan sin datos'
  return r.hasTransport ? `${base} · transporte ${DISTANCE_LABEL[r.distanceRange] || 'sin distancia'}` : base
}

// collect_promo marca el ancla como monto ajustado aunque se cobre el paquete
// pactado: en el ancla solo es "pactado" si la plata difiere del paquete.
export const isNegotiated = r => r.isAmountOverridden && (r.promoIndex == null
  || (r.promoIndex === 1 && Math.abs((r.paidAmount ?? 0) - (r.promoTotalAmount ?? 0)) > 1))

// Segunda línea en Cobranza: el plan y lo que explica el monto.
export function collectionDetail(r) {
  const parts = [r.hasTransport ? planText(r) : `${planText(r)} · sin transporte`]
  const events = []
  if (r.startDay != null) events.push(`ingresó el ${r.startDay}`)
  if (r.returnDay != null) events.push(`volvió el ${r.returnDay}`)
  if (r.leaveDay != null) events.push(`se da de baja el ${r.leaveDay}`)
  if (events.length || r.proration) {
    const days = r.proration ? `${r.proration.days} de ${r.proration.of} días, cuota proporcional` : ''
    parts.push(events.length ? events.join(' y ') + (days ? `: ${days}` : '') : days)
  }
  if (r.paymentStatus === 'prepaid') parts.push('cubierto por el paquete')
  else if (r.awaitingPackage) parts.push('se cobra con el paquete del primer mes')
  if (r.paymentStatus === 'paid' && r.paymentNotes) parts.push(r.paymentNotes)
  if (isNegotiated(r)) parts.push('monto pactado')
  return parts.join(' · ')
}

// Línea principal en Facturación: el comprobante, o por qué todavía no hay.
export function invoiceDetail(r) {
  if (r.invoiceStatus === 'invoiced') {
    const base = `${r.invoiceNumber || 'sin número'} · ${formatShortDate(r.invoiceDate)}`
    return r.invoiceMismatch ? `${base} · por el servicio del mes corresponde ${money(r.billable)}` : base
  }
  if (r.billable <= 0) return 'Sin cargo este mes: no se factura'
  if (r.block && !r.isCollected) return `${r.block.detail} · y la cuota del mes todavía no se cobró`
  if (r.block) return r.block.detail
  if (!r.isCollected) {
    return r.awaitingPackage
      ? 'Se factura cuando se cobre el paquete de la promo'
      : 'La cuota del mes todavía no se cobró: sin cobro no se emite factura'
  }
  return planText(r)
}

// Qué se factura, debajo del comprobante; el color dice el tipo de cuota.
export function benefitOf(r) {
  if (r.promoIndex != null) {
    return { label: `Promo ${plural(r.promoTotal, 'mes', 'meses')} · ${pctLabel(r.promoPercent)} dto · mes ${r.promoIndex} de ${r.promoTotal}`, color: '#059669' }
  }
  if (r.discountPercent) return { label: `Descuento puntual ${pctLabel(r.discountPercent)}`, color: '#f59e0b' }
  if (r.invoiceStatus === 'invoiced') return { label: planText(r), color: '#d1d5db' }
  return null
}

export const holderOf = r => r.transferResponsible || `${r.firstName} ${r.lastName}`.trim()

// Un mes cubierto por un paquete no cobra nada: la tabla muestra su valor tachado.
export const isStruck = (r, domain) => domain === 'collection' && r.expected === 0 && r.promoIndex > 1

// Los montos usan el espacio duro de Intl: el buscador compara con espacios comunes.
export const normalizeSearch = text => String(text).replace(/\s+/g, ' ').trim().toLowerCase()

// El buscador barre lo que se ve en la fila en ese panel: nombre, titular, estados,
// detalle, comprobante, documento, fecha y monto.
export function searchText(r, domain) {
  const isCollection = domain === 'collection'
  const chips = isCollection ? collectionChips(r) : invoiceChips(r)
  const amount = isStruck(r, domain) ? r.amount : rowAmount(r, domain)
  return normalizeSearch([
    r.firstName, r.lastName, holderOf(r),
    ...chips.map(c => c.label),
    isCollection ? collectionDetail(r) : invoiceDetail(r),
    isCollection ? conceptOf(r).label : benefitOf(r)?.label,
    r.invoiceNumber, r.documentNumber,
    isCollection && r.paidDate && formatShortDate(r.paidDate),
    isCollection && r.promoPaidDate && formatShortDate(r.promoPaidDate),
    String(Math.round(amount)), money(amount)
  ].filter(Boolean).join(' '))
}
