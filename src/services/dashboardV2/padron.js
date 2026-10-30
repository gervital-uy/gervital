import { promoMonthCollection } from '../promotions/promotionsView'
import { billableTotal, prorateInvoiceLines } from '../invoices/invoiceAmounts'

// Padrón del mes de Gestión CFP: una fila por cliente que se cobra en el mes (la
// población de get_month_collection_panel) con todo lo que la pantalla deriva: qué
// se cobra, qué se factura, el IVA, el estado y lo que frena una factura. Lógica
// pura; las lecturas están en queries.js. month es 0-indexed.

// Vencimiento: igual que la ficha del cliente (ClientDetail), un mes sin cobrar
// está vencido pasado el día 11.
export const OVERDUE_AFTER_DAY = 11

const num = v => (v == null || v === '' ? 0 : Number(v) || 0)
const pad = n => String(n).padStart(2, '0')
const dayOf = iso => Number(String(iso).slice(8, 10))

export function monthBounds(year, month) {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return { first: `${year}-${pad(month + 1)}-01`, last: `${year}-${pad(month + 1)}-${pad(lastDay)}` }
}

// Alta o baja dentro del mes, como día del mes (o null). La baja es la
// deactivation_date: se cobra hasta el día anterior.
export function monthEvents(client, year, month) {
  const { first, last } = monthBounds(year, month)
  const inMonth = iso => !!iso && iso.slice(0, 10) >= first && iso.slice(0, 10) <= last
  return {
    startDay: inMonth(client?.startDate) ? dayOf(client.startDate) : null,
    leaveDay: inMonth(client?.deactivationDate) ? dayOf(client.deactivationDate) : null
  }
}

// Las filas con cuota proporcional (alta empezado el mes o baja): las únicas para
// las que hace falta pedir los días a calculate_month_billing.
export const needsProration = ({ startDay, leaveDay }) => (startDay != null && startDay > 1) || leaveDay != null

export function isPastDue(year, month, today) {
  return !!today && today > `${year}-${pad(month + 1)}-${pad(OVERDUE_AFTER_DAY)}`
}

// IVA contenido en un importe con IVA, línea por línea: asistencia al 22% y
// transporte al 10%, con los netos redondeados como los emite biller.
export function ivaOf({ attGross, transGross }) {
  const att = num(attGross)
  const trans = num(transGross)
  return (att - Math.round(att / 1.22)) + (trans - Math.round(trans / 1.10))
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

// Lo que impide emitir la factura del mes. Biller rechaza sin documento (422) y un
// rechazo anterior queda guardado en emit_error. Correo y dirección no frenan la
// emisión: son avisos (receiverWarnings).
export function blockOf(row) {
  if (row.invoiceStatus === 'invoiced') return null
  if (!row.documentNumber) {
    return { chip: 'falta CI', family: 'ficha', detail: 'Falta la cédula en la ficha del cliente: Biller no emite sin documento' }
  }
  if (row.emitError) return { chip: 'error Biller', family: 'facturador', detail: row.emitError }
  return null
}

export function receiverWarnings(row) {
  if (row.invoiceStatus === 'invoiced') return []
  const out = []
  if (!row.email) out.push('sin correo')
  else if (!EMAIL.test(row.email)) out.push('correo inválido')
  if (!row.street) out.push('sin dirección')
  return out
}

function derive(row, pastDue) {
  const isPromo = row.promoIndex != null
  const due = promoMonthCollection({ promoIndex: row.promoIndex, promoTotalAmount: row.promoTotalAmount, monthAmount: row.amount }).due
  const isPaid = row.paymentStatus === 'paid'
  const isCollected = isPaid || row.paymentStatus === 'prepaid'
  // Lo que el mes aporta a la cobranza: lo que entró si ya se cobró, si no lo que se debe.
  const expected = isPaid ? num(row.paidAmount) : row.paymentStatus === 'prepaid' ? 0 : due
  // Facturación: cada mes se factura por su propio servicio (CLAUDE.md). Un mes de
  // promo factura su cuota del mes con el descuento, nunca el paquete; un mes
  // normal factura lo cobrado si ya se cobró (invoiceAmounts.js).
  const billable = isPromo
    ? row.amount
    : billableTotal({ paymentStatus: row.paymentStatus, paidAmount: row.paidAmount, liveAmount: row.amount })
  const lines = isPromo
    ? { attGross: Math.round(row.attendanceGross), transGross: Math.round(row.transportGross) }
    : prorateInvoiceLines({
      paymentStatus: row.paymentStatus,
      paidAmount: row.paidAmount,
      liveAttGross: row.attendanceGross,
      liveTransGross: row.transportGross,
      hasTransport: row.hasTransport
    })
  const invoicedLines = row.invoiceStatus === 'invoiced'
    ? prorateInvoiceLines({
      paymentStatus: 'paid',
      paidAmount: row.invoicedAmount,
      liveAttGross: row.attendanceGross,
      liveTransGross: row.transportGross,
      hasTransport: row.hasTransport
    })
    : null
  const block = blockOf(row)

  const collectionBucket = isCollected ? 'hechas'
    : due > 0 || (isPromo && row.promoIndex > 1) ? 'pendientes'
    : 'hechas'
  const invoiceBucket = row.invoiceStatus === 'invoiced' || billable <= 0 ? 'emitidas'
    : !isCollected ? 'nocobrado'
    : 'pendientes'

  return {
    ...row,
    due,
    expected,
    isCollected,
    billable,
    iva: ivaOf(lines),
    invoicedIva: invoicedLines ? ivaOf(invoicedLines) : 0,
    isOverdue: row.paymentStatus === 'pending' && due > 0 && pastDue,
    block,
    warnings: receiverWarnings(row),
    // Lo emitido no coincide con lo que corresponde facturar (p. ej. un mes ancla
    // facturado por el paquete entero). Se muestra, no se corrige: lo define el contador.
    invoiceMismatch: row.invoiceStatus === 'invoiced' && Math.abs(row.invoicedAmount - billable) > 1,
    // Se puede emitir ya: cobrado, sin factura, con monto y sin datos faltantes en la
    // ficha. Un rechazo de Biller sí se puede reintentar.
    canEmit: isCollected && row.invoiceStatus !== 'invoiced' && billable > 0 && block?.family !== 'ficha',
    collectionBucket,
    invoiceBucket
  }
}

const byKey = (list, key) => new Map((list || []).map(item => [item[key], item]))

export function buildPadron({ panel, clients, breakdown, invoices, promotions, billing = {} }, { year, month, today }) {
  const clientById = byKey(clients, 'id')
  const planById = byKey(breakdown, 'clientId')
  const invoiceById = byKey(invoices, 'clientId')
  const promoById = byKey(promotions, 'id')
  const pastDue = isPastDue(year, month, today)

  return (panel || []).map(p => {
    const client = clientById.get(p.client_id) || {}
    const plan = planById.get(p.client_id) || {}
    const invoice = invoiceById.get(p.client_id) || {}
    const promo = p.promo_id ? promoById.get(p.promo_id) : null
    const attendanceGross = num(p.attendance_gross)
    const transportGross = num(p.transport_gross)
    const events = monthEvents(client, year, month)
    const days = billing[p.client_id]
    const invoiced = p.invoice_status === 'invoiced'

    return derive({
      id: p.client_id,
      firstName: client.firstName || '',
      lastName: client.lastName || '',
      avatarUrl: client.avatarUrl || null,
      documentNumber: client.documentNumber || null,
      email: client.email || null,
      street: client.address?.street || null,
      distanceRange: client.address?.distanceRange || null,
      transferResponsible: client.transferResponsible || null,
      // El plan del mes (versionado), no el de hoy.
      frequency: plan.frequency ?? client.plan?.frequency ?? null,
      schedule: plan.schedule ?? client.plan?.schedule ?? null,
      hasTransport: plan.hasTransport ?? transportGross > 0,
      attendanceGross,
      transportGross,
      amount: attendanceGross + transportGross,
      paymentStatus: p.payment_status || 'pending',
      paidAmount: p.paid_amount == null ? null : num(p.paid_amount),
      paidDate: p.paid_date || null,
      paymentNotes: invoice.paymentNotes || null,
      invoiceStatus: p.invoice_status || 'pending',
      invoiceNumber: p.invoice_number || null,
      invoiceDate: p.invoice_date || null,
      invoicedAmount: invoiced ? num(p.invoiced_amount) : 0,
      emitError: invoice.emitError || null,
      dgiStatus: invoice.dgiStatus || null,
      discountPercent: p.promo_id ? null : (num(invoice.discountPercent) || null),
      promoId: p.promo_id || null,
      promoIndex: p.promo_index ?? null,
      promoTotal: p.promo_total ?? null,
      promoPercent: p.promo_percent == null ? null : num(p.promo_percent),
      promoTotalAmount: p.promo_total_amount == null ? null : num(p.promo_total_amount),
      promoPaidDate: promo?.paid_date || null,
      correctionPending: !!invoice.correctionPending,
      isAmountOverridden: !!invoice.isAmountOverridden,
      startDay: events.startDay,
      leaveDay: events.leaveDay,
      proration: days && days.plannedDays < days.fullMonthDays ? { days: days.plannedDays, of: days.fullMonthDays } : null
    }, pastDue)
  })
}

const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0)

// KPIs de Cobranza, siempre sobre el padrón entero (no sobre el filtro).
export function collectionTotals(rows) {
  const previsto = sum(rows, r => r.expected)
  const cobrado = sum(rows.filter(r => r.paymentStatus === 'paid'), r => num(r.paidAmount))
  const porCobrar = rows.filter(r => r.paymentStatus === 'pending' && r.due > 0)
  const anchors = rows.filter(r => r.promoIndex === 1)
  return {
    clientes: rows.length,
    previsto,
    cobrado,
    pendiente: previsto - cobrado,
    pctCobro: previsto > 0 ? (cobrado / previsto) * 100 : null,
    pctPendiente: previsto > 0 ? ((previsto - cobrado) / previsto) * 100 : null,
    pendientes: porCobrar.length,
    vencidos: porCobrar.filter(r => r.isOverdue).length,
    alDia: rows.length - porCobrar.length,
    // Lo que aporta cada paquete al previsto (lo cobrado si ya entró), para que
    // cuotas + paquetes = previsto cierre exacto.
    paquetes: sum(anchors, r => r.expected),
    paquetesCount: anchors.length,
    previstoCuotas: sum(rows.filter(r => r.promoIndex == null), r => r.expected),
    prepagasNominal: sum(rows.filter(r => r.promoIndex > 1), r => r.amount),
    prepagasCount: rows.filter(r => r.promoIndex > 1).length
  }
}

// KPIs de Facturación, sobre el padrón entero.
export function invoicingTotals(rows) {
  const pendingRows = rows.filter(r => r.invoiceStatus !== 'invoiced' && r.billable > 0)
  const blocked = rows.filter(r => r.block)
  const reasons = new Map()
  for (const r of blocked) reasons.set(r.block.chip, (reasons.get(r.block.chip) || 0) + 1)
  const invoiced = rows.filter(r => r.invoiceStatus === 'invoiced')
  const ivaEmitido = sum(invoiced, r => r.invoicedIva)
  const ivaFaltante = sum(pendingRows, r => r.iva)
  return {
    clientes: rows.length,
    facturableCuotas: sum(rows.filter(r => r.promoIndex == null), r => r.billable),
    facturablePromos: sum(rows.filter(r => r.promoIndex != null), r => r.billable),
    facturableTotal: sum(rows, r => r.billable),
    promoMeses: rows.filter(r => r.promoIndex != null).length,
    facturado: sum(invoiced, r => r.invoicedAmount),
    emitidas: invoiced.length,
    // Lo que falta emitir por servicio del mes, y lo ya emitido que no coincide con
    // ese servicio: A facturar − emitido + emitidoDistinto = faltaEmitir.
    faltaEmitir: sum(pendingRows, r => r.billable),
    emitidoDistinto: sum(invoiced, r => r.invoicedAmount - r.billable),
    // IVA de ventas del mes: el de las facturas tal como se emitieron más el de lo
    // que falta emitir.
    ivaDelMes: ivaEmitido + ivaFaltante,
    ivaEmitido,
    ivaFaltante,
    sinEmitir: pendingRows.length,
    listas: pendingRows.filter(r => r.canEmit).length,
    esperandoCobro: pendingRows.filter(r => !r.isCollected).length,
    trabadasFicha: blocked.filter(r => r.block.family === 'ficha').length,
    trabadasFacturador: blocked.filter(r => r.block.family === 'facturador').length,
    trabadasConCobro: blocked.filter(r => r.isCollected).length,
    trabadasSinCobro: blocked.filter(r => !r.isCollected).length,
    detalleTrabadas: [...reasons].map(([chip, n]) => `${n} ${chip}`),
    conAvisos: pendingRows.filter(r => r.warnings.length > 0).length,
    distintas: invoiced.filter(r => r.invoiceMismatch).length
  }
}

// Orden por defecto ("Plan y promos"): primero las cuotas del mes, de mayor a menor
// frecuencia; después las promos (el paquete antes que los meses cubiertos); al
// final los descuentos puntuales. Empates por monto.
const rank = r => (r.promoIndex != null ? 1 : r.discountPercent ? 2 : 0)
const amountFor = domain => r => (domain === 'cobranza' ? r.due : r.billable)

export function sortRows(rows, order, domain) {
  const amount = amountFor(domain)
  const byAmount = (a, b) => amount(b) - amount(a)
  const compare = order === 'nombre'
    ? (a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es')
    : order === 'monto'
      ? byAmount
      : (a, b) => (rank(a) - rank(b))
        || ((a.promoIndex === 1 ? 0 : 1) - (b.promoIndex === 1 ? 0 : 1))
        || ((b.frequency || 0) - (a.frequency || 0))
        || byAmount(a, b)
  return [...rows].sort(compare)
}

// Ventana razonable para la fecha de un giro: del 1 del mes anterior al último del
// siguiente. Antes del mes de servicio es "anticipado", después "atrasado".
export function paymentOffset(iso, year, month) {
  if (!iso) return null
  const { first, last } = monthBounds(year, month)
  const day = iso.slice(0, 10)
  return day < first ? 'anticipado' : day > last ? 'atrasado' : null
}
