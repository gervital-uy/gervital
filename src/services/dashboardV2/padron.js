import { promoMonthCollection } from '../promotions/promotionsView'
import { billableTotal, prorateInvoiceLines } from '../invoices/invoiceAmounts'
import { PLATFORM_START_ISO } from './platform'

// Padrón del mes de Gestión CFP: una fila por cliente que se cobra en el mes (la
// población de get_month_collection_panel) con todo lo que la pantalla deriva: qué
// se cobra, qué se factura, el IVA, el estado y lo que frena una factura. Lógica
// pura; las lecturas están en queries.js. month es 0-indexed.
//
// Paneles: 'collection' (cobranza) e 'invoicing' (facturación).

// Vencimiento: igual que la ficha del cliente (ClientDetail), un mes sin cobrar
// está vencido pasado el día 11.
export const OVERDUE_AFTER_DAY = 11

const num = v => (v == null || v === '' ? 0 : Number(v) || 0)
const pad = n => String(n).padStart(2, '0')
const isoDay = iso => (iso ? String(iso).slice(0, 10) : null)
const dayOf = iso => Number(String(iso).slice(8, 10))

export function monthBounds(year, month) {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return { first: `${year}-${pad(month + 1)}-01`, last: `${year}-${pad(month + 1)}-${pad(lastDay)}` }
}

// Los períodos de inactividad [desde, hasta) de una ficha de clients_full. Son la
// fuente de verdad (un reingreso borra deactivation_date); deactivationDate solo se
// usa si la ficha no trae los períodos.
export const inactivityPeriodsOf = client => (Array.isArray(client?.inactivityPeriods)
  ? client.inactivityPeriods
  : client?.deactivationDate ? [{ fromDate: client.deactivationDate, toDate: null }] : [])

// Lo que pasa con el cliente dentro del mes, como día del mes (o null):
//   · startDay: alta. Los heredados (cargados con la fecha de lanzamiento) no son alta.
//   · leaveDay / returnDay: empieza o termina un período de inactividad
//     (inactivityPeriodsOf).
//   · inactive: algún período toca el mes, así que la cuota puede ser parcial.
export function monthEvents(client, year, month) {
  const { first, last } = monthBounds(year, month)
  const inMonth = iso => !!iso && isoDay(iso) >= first && isoDay(iso) <= last
  const periods = inactivityPeriodsOf(client)
  const leave = periods.find(p => inMonth(p.fromDate))
  const back = periods.find(p => inMonth(p.toDate))
  const start = isoDay(client?.startDate)
  return {
    startDay: inMonth(start) && start !== PLATFORM_START_ISO ? dayOf(start) : null,
    leaveDay: leave ? dayOf(leave.fromDate) : null,
    returnDay: back ? dayOf(back.toDate) : null,
    inactive: periods.some(p => isoDay(p.fromDate) <= last && (!p.toDate || isoDay(p.toDate) > first))
  }
}

// Un primer mes de promo que quedó pendiente con la promo cobrada: pasa si en la
// ficha se deshace el cobro solo de ese mes. collect_promo lo rechaza ("ya está
// cobrada"), así que lo único que lo arregla es deshacer el cobro del paquete.
export const isBrokenPackage = row => row.promoIndex === 1 && row.paymentStatus === 'pending' && !!row.promoPaidDate

// Las filas que pueden tener cuota proporcional: las únicas para las que hace falta
// pedirle los días a calculate_month_billing.
export const needsProration = ({ startDay, inactive }) => (startDay != null && startDay > 1) || !!inactive

export function isPastDue(year, month, today) {
  return !!today && today > `${year}-${pad(month + 1)}-${pad(OVERDUE_AFTER_DAY)}`
}

// IVA por línea: asistencia al 22% y transporte al 10%. Nunca una sola tasa.
export const VAT = { attendance: 1.22, transport: 1.10 }

// Neto de un importe con IVA, redondeado como lo emite biller.
export const netOfGross = (gross, rate) => Math.round(num(gross) / rate)

// IVA contenido en un importe con IVA, línea por línea.
export function ivaOf({ attGross, transGross }) {
  const att = num(attGross)
  const trans = num(transGross)
  return (att - netOfGross(att, VAT.attendance)) + (trans - netOfGross(trans, VAT.transport))
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

// Lo que impide emitir la factura del mes. Biller rechaza sin documento (422); un
// cobro marcado para corregir está cobrado por un monto que ya no corresponde
// (mig 085), y facturarlo así deja una factura para anular; un rechazo anterior
// queda guardado en emit_error y se puede reintentar. Correo y dirección no frenan
// la emisión: son avisos (receiverWarnings).
export function blockOf(row) {
  if (row.invoiceStatus === 'invoiced') return null
  if (!row.documentNumber) {
    return { chip: 'falta CI', family: 'record', detail: 'Falta la cédula en la ficha del cliente: Biller no emite sin documento' }
  }
  if (row.correctionPending) {
    return { chip: 'corrección pendiente', family: 'record', detail: 'El cobro del mes requiere corrección: resolvela en la ficha del cliente antes de facturar' }
  }
  if (row.emitError) return { chip: 'error Biller', family: 'biller', detail: row.emitError }
  return null
}

// Un mes con la asistencia en $0 (descuento del 100%) y transporte cobrado: la
// factura sale sin la línea del plan, y ni biller ni la ficha la emiten así.
const NO_ATTENDANCE = {
  chip: 'asistencia en $0',
  family: 'record',
  detail: 'La asistencia del mes queda en $0 (descuento del 100%): no se emite una factura solo de transporte'
}

export function receiverWarnings(row) {
  if (row.invoiceStatus === 'invoiced') return []
  const out = []
  if (!row.email) out.push('sin correo')
  else if (!EMAIL.test(row.email)) out.push('correo inválido')
  if (!row.street) out.push('sin dirección')
  return out
}

// El monto que muestra cada panel (y por el que se ordena): lo que la fila aporta a
// la cobranza, o lo facturado / a facturar.
export const rowAmount = (r, domain) => (domain === 'collection'
  ? r.expected
  : r.invoiceStatus === 'invoiced' ? r.invoicedAmount : r.billable)

// Las dos líneas de la e-factura del mes (asistencia al 22%, transporte al 10%),
// como las arma biller por defecto.
export const invoiceLinesOf = row => prorateInvoiceLines({
  paymentStatus: row.paymentStatus,
  paidAmount: row.paidAmount,
  liveAttGross: row.attendanceGross,
  liveTransGross: row.transportGross,
  hasTransport: row.hasTransport,
  promoId: row.promoId
})

function derive(row, pastDue) {
  const isPromo = row.promoIndex != null
  const due = promoMonthCollection({ promoIndex: row.promoIndex, promoTotalAmount: row.promoTotalAmount, monthAmount: row.amount }).due
  const isPaid = row.paymentStatus === 'paid'
  const isCollected = isPaid || row.paymentStatus === 'prepaid'
  // Lo que el mes aporta a la cobranza: lo que entró si ya se cobró, si no lo que se debe.
  const expected = isPaid ? num(row.paidAmount) : row.paymentStatus === 'prepaid' ? 0 : due
  // Facturación: cada mes se factura por su propio servicio (CLAUDE.md). Un mes de
  // promo factura su cuota del mes con el descuento, nunca el paquete; un mes
  // normal factura lo cobrado si ya se cobró (invoiceAmounts.js, igual que biller).
  const billable = billableTotal({ paymentStatus: row.paymentStatus, paidAmount: row.paidAmount, liveAmount: row.amount, promoId: row.promoId })
  const lines = invoiceLinesOf(row)
  const block = blockOf(row) || (row.invoiceStatus !== 'invoiced' && billable > 0 && lines.attGross <= 0 ? NO_ATTENDANCE : null)
  const awaitingPackage = isPromo && row.promoIndex > 1 && row.paymentStatus === 'pending'

  return {
    ...row,
    due,
    expected,
    isCollected,
    awaitingPackage,
    billable,
    iva: ivaOf(lines),
    // Lo emitido, con las líneas tal como salieron (guardadas al emitir).
    invoicedIva: row.invoiceStatus === 'invoiced' ? ivaOf(row.invoicedLines) : 0,
    isOverdue: row.paymentStatus === 'pending' && due > 0 && pastDue,
    block,
    warnings: receiverWarnings(row),
    // Lo emitido no coincide con lo que corresponde facturar (p. ej. un mes ancla
    // facturado por el paquete entero). Se muestra, no se corrige: lo define el contador.
    invoiceMismatch: row.invoiceStatus === 'invoiced' && Math.abs(row.invoicedAmount - billable) > 1,
    // Se puede emitir: cobrado, sin factura, con monto y sin datos faltantes en la
    // ficha. Un rechazo de Biller se puede reintentar.
    canEmit: isCollected && row.invoiceStatus !== 'invoiced' && billable > 0 && block?.family !== 'record',
    collectionBucket: isCollected ? 'done' : due > 0 || awaitingPackage ? 'pending' : 'done',
    invoiceBucket: row.invoiceStatus === 'invoiced' || billable <= 0 ? 'issued' : !isCollected ? 'uncollected' : 'pending'
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
    const frequency = plan.frequency ?? client.plan?.frequency ?? null
    const days = billing[p.client_id]
    const invoiced = p.invoice_status === 'invoiced'
    const invoicedAmount = invoiced ? num(p.invoiced_amount) : 0
    const snapshotAtt = num(invoice.attendanceChargeableGross)
    const snapshotTrans = num(invoice.transportChargeableGross)

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
      frequency,
      schedule: plan.schedule ?? client.plan?.schedule ?? null,
      // Si el mes cobra transporte, tiene transporte aunque el desglose no traiga plan.
      hasTransport: transportGross > 0 || !!plan.hasTransport,
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
      invoicedAmount,
      // Las líneas guardadas al emitir; si faltan, lo emitido repartido como hoy.
      invoicedLines: !invoiced ? null
        : snapshotAtt + snapshotTrans > 0
          ? { attGross: snapshotAtt, transGross: snapshotTrans }
          : prorateInvoiceLines({ paymentStatus: 'paid', paidAmount: invoicedAmount, liveAttGross: attendanceGross, liveTransGross: transportGross, hasTransport: transportGross > 0 }),
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
      returnDay: events.returnDay,
      // Días que cobra calculate_month_billing: los cobrables, con tope en el mes
      // pactado (4 × frecuencia), sobre ese mes pactado.
      proration: days?.isProrated && frequency
        ? { days: Math.min(num(days.chargeableDays), 4 * frequency), of: 4 * frequency }
        : null
    }, pastDue)
  })
}

const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0)

// KPIs de Cobranza, siempre sobre el padrón entero (no sobre el filtro).
export function collectionTotals(rows) {
  const expected = sum(rows, r => r.expected)
  const collected = sum(rows.filter(r => r.paymentStatus === 'paid'), r => num(r.paidAmount))
  const due = rows.filter(r => r.paymentStatus === 'pending' && r.due > 0)
  const anchors = rows.filter(r => r.promoIndex === 1)
  const covered = rows.filter(r => r.paymentStatus === 'prepaid')
  return {
    clients: rows.length,
    expected,
    collected,
    outstanding: expected - collected,
    collectedPct: expected > 0 ? (collected / expected) * 100 : null,
    outstandingPct: expected > 0 ? ((expected - collected) / expected) * 100 : null,
    dueCount: due.length,
    overdueCount: due.filter(r => r.isOverdue).length,
    upToDate: rows.filter(r => r.collectionBucket === 'done').length,
    // Lo que aporta cada paquete al previsto (lo cobrado si ya entró), para que
    // cuotas + paquetes = previsto cierre exacto.
    packages: sum(anchors, r => r.expected),
    packageCount: anchors.length,
    monthlyExpected: sum(rows.filter(r => r.promoIndex == null), r => r.expected),
    coveredNominal: sum(covered, r => r.amount),
    coveredCount: covered.length,
    awaitingPackage: rows.filter(r => r.awaitingPackage).length
  }
}

// KPIs de Facturación, sobre el padrón entero.
export function invoicingTotals(rows) {
  const notIssued = rows.filter(r => r.invoiceStatus !== 'invoiced' && r.billable > 0)
  const collected = notIssued.filter(r => r.isCollected)
  const blocked = rows.filter(r => r.block)
  const reasons = new Map()
  for (const r of blocked) reasons.set(r.block.chip, (reasons.get(r.block.chip) || 0) + 1)
  const invoiced = rows.filter(r => r.invoiceStatus === 'invoiced')
  const issuedVat = sum(invoiced, r => r.invoicedIva)
  const pendingVat = sum(notIssued, r => r.iva)
  return {
    clients: rows.length,
    monthlyBillable: sum(rows.filter(r => r.promoIndex == null), r => r.billable),
    promoBillable: sum(rows.filter(r => r.promoIndex != null), r => r.billable),
    billable: sum(rows, r => r.billable),
    promoMonths: rows.filter(r => r.promoIndex != null).length,
    issued: sum(invoiced, r => r.invoicedAmount),
    issuedCount: invoiced.length,
    // Lo que falta emitir por servicio del mes, y lo ya emitido que no coincide con
    // ese servicio: a facturar − emitido + issuedMismatch = toIssue.
    toIssue: sum(notIssued, r => r.billable),
    issuedMismatch: sum(invoiced, r => r.invoicedAmount - r.billable),
    mismatchCount: invoiced.filter(r => r.invoiceMismatch).length,
    // IVA de ventas del mes: el de las facturas tal como se emitieron más el de lo
    // que falta emitir.
    vat: issuedVat + pendingVat,
    issuedVat,
    pendingVat,
    // Las que faltan emitir, en cuatro grupos que no se pisan.
    notIssued: notIssued.length,
    awaitingPayment: notIssued.filter(r => !r.isCollected).length,
    ready: collected.filter(r => !r.block).length,
    missingRecordData: collected.filter(r => r.block?.family === 'record').length,
    rejected: collected.filter(r => r.block?.family === 'biller').length,
    // Trabadas (todas, cobradas o no), para el aviso.
    blockedRecord: blocked.filter(r => r.block.family === 'record').length,
    blockedBiller: blocked.filter(r => r.block.family === 'biller').length,
    // Las trabadas por la ficha que se liberan al corregir el dato, y las que
    // además esperan el cobro; los rechazos que esperan el cobro antes de reintentar.
    blockedRecordCollected: blocked.filter(r => r.block.family === 'record' && r.isCollected).length,
    blockedRecordUncollected: blocked.filter(r => r.block.family === 'record' && !r.isCollected).length,
    rejectedUncollected: blocked.filter(r => r.block.family === 'biller' && !r.isCollected).length,
    blockedReasons: [...reasons].map(([chip, n]) => `${n} ${chip}`),
    withWarnings: notIssued.filter(r => r.warnings.length > 0).length
  }
}

// Orden por defecto ("Plan y promos"): primero las cuotas del mes, de mayor a menor
// frecuencia; después las promos (el paquete antes que los meses cubiertos); al
// final los descuentos puntuales. Empates por el monto que se ve.
const rank = r => (r.promoIndex != null ? 1 : r.discountPercent ? 2 : 0)

export function sortRows(rows, order, domain) {
  const byAmount = (a, b) => rowAmount(b, domain) - rowAmount(a, domain)
  const compare = order === 'name'
    ? (a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es')
    : order === 'amount'
      ? byAmount
      : (a, b) => (rank(a) - rank(b))
        || ((a.promoIndex === 1 ? 0 : 1) - (b.promoIndex === 1 ? 0 : 1))
        || ((b.frequency || 0) - (a.frequency || 0))
        || byAmount(a, b)
  return [...rows].sort(compare)
}

// Fecha de un giro respecto del mes de servicio: antes es "anticipado", después
// "atrasado".
export function paymentOffset(iso, year, month) {
  if (!iso) return null
  const { first, last } = monthBounds(year, month)
  const day = isoDay(iso)
  return day < first ? 'anticipado' : day > last ? 'atrasado' : null
}
