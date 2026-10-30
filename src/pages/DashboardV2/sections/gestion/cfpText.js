import { formatDecimal, formatShortDate, money, plural } from '../../format'

// Textos y chips de cada fila del padrón (Gestión CFP). Las cuentas están en
// services/dashboardV2/padron.js; acá solo cómo se dicen.

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
  invoiced: { label: 'facturada', cls: 'bg-emerald-50 text-emerald-700' },
  ready: { label: 'lista para emitir', cls: 'bg-amber-50 text-amber-700' },
  notCollected: { label: 'no cobrado', cls: 'bg-gray-100 text-gray-500' },
  mismatch: { label: 'monto distinto', cls: 'bg-amber-50 text-amber-700' },
  dgiPending: { label: 'DGI pendiente', cls: 'bg-gray-100 text-gray-500' }
}
const blockChip = label => ({ label, cls: 'bg-rose-50 text-rose-600' })
const warningChip = label => ({ label, cls: 'bg-amber-50 text-amber-700' })

const pctLabel = v => `${Number.isInteger(v) ? v : formatDecimal(v)}%`

// Estado de cobro de la fila, más lo que la distingue (alta o baja del mes, corrección).
export function collectionChips(r) {
  const out = []
  if (r.paymentStatus === 'paid') out.push(CHIPS.paid)
  else if (r.paymentStatus === 'prepaid') out.push(CHIPS.prepaid)
  else if (r.promoIndex > 1 && r.due === 0) out.push(CHIPS.inPackage)
  else if (r.due <= 0) out.push(CHIPS.noCharge)
  else out.push(r.isOverdue ? CHIPS.overdue : CHIPS.pending)
  if (r.correctionPending) out.push(CHIPS.correction)
  if (r.leaveDay != null) out.push(CHIPS.leavingThisMonth)
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

// Segunda línea en Cobranza: el plan y lo que explica el monto.
export function collectionDetail(r) {
  const parts = [r.hasTransport ? planText(r) : `${planText(r)} · sin transporte`]
  const events = []
  if (r.startDay != null) events.push(`ingresó el ${r.startDay}`)
  if (r.leaveDay != null) events.push(`se da de baja el ${r.leaveDay}`)
  if (events.length) {
    parts.push(events.join(' y ') + (r.proration ? `: ${r.proration.days} de ${r.proration.of} días, cuota proporcional` : ''))
  }
  if (r.paymentStatus === 'prepaid') parts.push('cubierto por el paquete')
  else if (r.promoIndex > 1 && r.due === 0) parts.push('se cobra con el paquete del primer mes')
  if (r.paymentStatus === 'paid' && r.paymentNotes) parts.push(r.paymentNotes)
  if (r.isAmountOverridden) parts.push('monto pactado')
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
    return r.promoIndex > 1
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

// Monto de la fila en cada panel: lo que aporta a la cobranza, o lo facturado /
// a facturar.
export const rowAmount = (r, domain) => (domain === 'cobranza'
  ? r.expected
  : r.invoiceStatus === 'invoiced' ? r.invoicedAmount : r.billable)

// El buscador barre lo que se ve en la fila: nombre, titular, estados, detalle,
// comprobante, documento, fecha y monto.
export function searchText(r, domain) {
  const chips = domain === 'cobranza' ? collectionChips(r) : invoiceChips(r)
  const amount = rowAmount(r, domain)
  return [
    r.firstName, r.lastName, holderOf(r),
    ...chips.map(c => c.label),
    domain === 'cobranza' ? collectionDetail(r) : invoiceDetail(r),
    conceptOf(r).label, benefitOf(r)?.label,
    r.block ? `trabada ${r.block.chip}` : '',
    r.invoiceNumber, r.documentNumber,
    r.paidDate && formatShortDate(r.paidDate),
    r.promoPaidDate && formatShortDate(r.promoPaidDate),
    String(Math.round(amount)), money(amount)
  ].filter(Boolean).join(' ').toLowerCase()
}
