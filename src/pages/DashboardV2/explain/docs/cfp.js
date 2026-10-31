import { money, pctText, plural } from '../../format'

// Explicaciones de Gestión CFP. ctx = { cfp: { collection, invoicing }, domain, monthLabel },
// con los totales de services/dashboardV2/padron.js.

const collectionDoc = ({ cfp, monthLabel = 'el mes' }) => {
  const t = cfp?.collection || {}
  return {
    title: 'Cobranza del mes',
    unit: ['con IVA', 'a cobrar en el mes', 'mes seleccionado'],
    what: 'El padrón del mes: qué corresponde cobrarle a cada cliente y qué entró. Una cuota ya cobrada cuenta por lo que se cobró; una pendiente, por lo que se debe.',
    rows: [
      { label: 'Cuotas del mes (asistencia + transporte)', value: t.monthlyExpected },
      { label: 'Paquetes de promo que arrancan este mes', value: t.packages, op: '+' },
      { label: `Meses ya cubiertos por un paquete (${t.coveredCount ?? 0})`, text: money(0), op: '+' },
      { label: `Meses de promo esperando el cobro del paquete (${t.awaitingPackage ?? 0})`, text: money(0), op: '+' },
      { label: 'Previsto del mes', value: t.expected, op: '=' },
      { label: 'Cobrado', value: t.collected == null ? undefined : -t.collected, op: '−' },
      { label: 'Tasa de cobro', text: pctText(t.collectedPct, 0), info: true }
    ],
    total: { label: 'Pendiente de cobro', value: t.outstanding },
    source: `Una fila por cliente regular que se cobra en ${monthLabel}, incluidas las altas y los reingresos (con su cuota proporcional: los días cobrables sobre el mes pactado, 4 por cada vez por semana) y las bajas del mes mientras tengan algo que pagar. Cada fila aporta lo que hay que cobrarle ese mes: la cuota, o el paquete entero si es el primer mes de una promo prepaga. Los meses siguientes de una promo no cobran nada: o ya están cubiertos (su servicio del mes vale ${money(t.coveredNominal)}) o se cobran con el paquete del primer mes.`,
    caveat: 'Cobranza y facturación miden cosas distintas a propósito: el paquete de una promo entra entero en el primer mes, pero cada mes se factura por su propio servicio. Por eso en Facturación un mes de promo muestra la cuota del mes y no el paquete. Y este previsto es con IVA: no se compara con los ingresos netos de Finanzas.'
  }
}

const invoicingDoc = ({ cfp, monthLabel = 'el mes' }) => {
  const f = cfp?.invoicing || {}
  return {
    title: 'Facturación del mes',
    unit: ['con IVA', 'servicio del mes', 'mes seleccionado'],
    what: 'Lo que corresponde facturar por el servicio de este mes. No sigue a la caja: una promo se cobra entera en el primer mes, pero cada mes se factura por su propio servicio, con el descuento aplicado. Un mes que ya se cobró se factura por lo cobrado.',
    rows: [
      { label: 'Cuotas del mes (asistencia + transporte)', value: f.monthlyBillable },
      { label: `Meses de promo en curso (${f.promoMonths ?? 0})`, value: f.promoBillable, op: '+' },
      { label: 'A facturar este mes', value: f.billable, op: '=' },
      { label: 'Ya emitido', value: f.issued == null ? undefined : -f.issued, op: '−' },
      { label: 'Emitido por un monto distinto del servicio', value: f.issuedMismatch, op: (f.issuedMismatch || 0) < 0 ? '−' : '+' },
      { label: 'Clientes sin factura emitida', text: String(f.notIssued ?? '—'), info: true },
      { label: 'Trabadas por datos de la ficha', text: String(f.blockedRecord ?? '—'), info: true },
      { label: 'Rechazadas por el facturador', text: String(f.blockedBiller ?? '—'), info: true }
    ],
    total: { label: 'Falta emitir', value: f.toIssue },
    source: `Cada cliente de ${monthLabel} factura su propio servicio del mes: la asistencia con el descuento que tenga y el transporte pleno. Si el mes ya se cobró, el monto es lo cobrado, repartido entre asistencia y transporte como lo hace la emisión hacia Biller. Un mes de promo factura su cuota del mes, nunca el paquete. Sin cobro no se emite: un mes de promo cuenta como cobrado cuando se cobró el paquete.`,
    caveat: f.mismatchCount > 0
      ? `Hay ${plural(f.mismatchCount, 'factura emitida', 'facturas emitidas')} por un monto distinto del servicio del mes (por ejemplo, un primer mes de promo facturado por el paquete entero). Se muestran tal cual se emitieron: cómo se corrigen lo define el contador.`
      : `Las facturas de ${monthLabel} se emiten con fecha de su último día hábil, de a una en Biller. Desde esta pantalla cada una sale por el servicio del mes, también el primer mes de una promo. Si alguna se emite por otro monto (por ejemplo, desde la ficha a mano), la fila va a aparecer con "monto distinto".`
  }
}

const cfpDocs = {
  cfp: ctx => (ctx?.domain === 'invoicing' ? invoicingDoc(ctx) : collectionDoc(ctx)),

  monthVat: ({ cfp, monthLabel = 'el mes' }) => {
    const f = cfp?.invoicing || {}
    return {
      title: 'IVA del mes',
      unit: ['IVA de ventas', 'mes seleccionado'],
      what: 'El IVA contenido en la facturación del mes: asistencia al 22% y transporte al 10%, las tasas con las que se emiten las facturas.',
      rows: [
        { label: 'IVA de lo ya emitido', value: f.issuedVat },
        { label: 'IVA de lo que falta emitir', value: f.pendingVat, op: '+' }
      ],
      total: { label: 'IVA del mes', value: f.vat },
      source: `Para lo emitido, el IVA de cada factura de ${monthLabel} con las líneas tal como salieron; para lo que falta, el de lo que corresponde facturar. En las dos la asistencia lleva 22% y el transporte 10%.`,
      caveat: 'Es el IVA de las ventas, no lo que se le paga a la DGI: falta descontar el IVA de las compras, que la plataforma no registra. La obligación real la determina la liquidación del contador.'
    }
  }
}

export default cfpDocs
