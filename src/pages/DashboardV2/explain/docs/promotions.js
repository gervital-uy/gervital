import { pctText, plural } from '../../format'

// Explicaciones del bloque Promociones y otros descuentos (Gestión CFP).
// ctx = { benefits: { kpis, history }, monthLabel }, con kpis de buildBenefits y
// history = totals de benefitHistory (null fuera del historial). Todo sale de
// services/dashboardV2/benefitsView.js.

const count = v => (typeof v === 'number' ? String(v) : '—')

const awayNote = k => {
  const notes = []
  if (k.offPadron > 0) notes.push(`${plural(k.offPadron, 'acuerdo vigente', 'acuerdos vigentes')} de clientes que no cobran este mes (por ejemplo, una baja) no se cuentan`)
  if (k.upcomingAway > 0) notes.push(`${plural(k.upcomingAway, 'acuerdo futuro', 'acuerdos futuros')} de clientes que no van a estar activos en su rango no figuran en Próximos`)
  return notes.length ? `${notes.join('; ')}.` : ''
}

const promotionsDocs = {
  benefCoverage: ({ benefits, monthLabel = 'el mes' }) => {
    const k = benefits?.kpis || {}
    const prev = k.previousCoverage
    return {
      title: 'Con beneficio',
      unit: ['clientes', 'padrón del mes'],
      what: 'Cuántos clientes del padrón del mes tienen ese mes una promo prepaga o un descuento suelto. Es la misma población que cobra la Cobranza de Gestión CFP.',
      rows: [
        ...(k.segments || []).map(s => ({ label: s.label, text: count(s.count) })),
        { label: 'Padrón del mes', text: count(k.base), info: true }
      ],
      total: { label: 'Con beneficio', text: `${count(k.withBenefit)} de ${count(k.base)} (${pctText(k.coveragePct)})` },
      source: `Un cliente de ${monthLabel} cuenta si su mes tiene una promo prepaga o un porcentaje de descuento sin promo. Las promos se agrupan por su duración real: puede haber promos de cualquier cantidad de meses y con cualquier porcentaje.`,
      caveat: [
        prev ? `La comparación es con ${plural(prev.base, 'cliente', 'clientes')} del padrón de hace seis meses.` : 'La comparación con hace seis meses aparece cuando haya seis meses de historia, desde diciembre de 2026.',
        awayNote(k)
      ].filter(Boolean).join(' ')
    }
  },

  benefDiscount: ({ benefits, monthLabel = 'el mes' }) => {
    const d = benefits?.kpis?.discount || {}
    const notes = []
    if (d.estimated > 0) notes.push(`En ${plural(d.estimated, 'cliente', 'clientes')} no se pudo calcular el mes y la lista se reconstruyó de lo cobrable (cobrable ÷ (1 − %)).`)
    if (d.missing > 0) notes.push(`${plural(d.missing, 'cliente', 'clientes')} con descuento del 100% y sin cálculo del mes no suman: no hay de dónde sacar su precio de lista.`)
    return {
      title: 'Descuento del mes',
      unit: ['con IVA', 'solo asistencia', 'mes seleccionado'],
      what: 'Lo que el mes deja de cobrar por descuentos: el precio de lista de la asistencia menos lo cobrable con el descuento. El transporte nunca lleva descuento.',
      rows: [
        { label: 'Meses de promo prepaga', value: d.promos },
        { label: 'Otros descuentos', value: d.discounts, op: '+' },
        { label: 'Asistencia del padrón a precio de lista', value: d.listAttendance, info: true },
        { label: 'Proporción descontada', text: pctText(d.sharePct), info: true }
      ],
      total: { label: 'Descuento del mes', value: d.total },
      source: `Para cada cliente con beneficio en ${monthLabel}, el precio de lista es lo que calcula la facturación del mes por los mismos días sin el descuento: los días cobrables sobre el mes pactado (4 por cada vez por semana) por la tarifa vigente del plan. Cada mes de una promo cuenta su propio descuento, también los meses 2 en adelante, y no el del paquete entero. La proporción es sobre la asistencia de todo el padrón a precio de lista: lo cobrable más lo descontado.`,
      caveat: notes.length ? notes.join(' ') : undefined
    }
  },

  benefPackages: ({ benefits }) => {
    const p = benefits?.kpis?.packages || {}
    return {
      title: 'Paquetes que arrancan',
      unit: ['con IVA', 'cobranza', 'mes seleccionado'],
      what: 'Las promos prepagas cuyo primer mes es este. Ese mes se cobra el paquete entero, y los meses siguientes de la promo quedan cubiertos en $ 0.',
      rows: [
        { label: `Cobrados (${count(p.collectedCount)})`, value: p.collected },
        { label: `Sin cobrar (${count(p.pendingCount)})`, value: p.pending, op: '+' }
      ],
      total: { label: 'Paquetes que arrancan', value: p.amount },
      source: 'Un paquete cobrado cuenta por lo que entró; uno sin cobrar, por el total pactado al crear la promo. Es la misma cifra de paquetes que suma la Cobranza del mes.',
      caveat: 'Es cobranza, no facturación: cada mes de la promo se factura por su propio servicio, nunca por el paquete.'
    }
  },

  benefRenewals: ({ benefits }) => {
    const r = benefits?.kpis?.renewals || {}
    return {
      title: 'Por renovar',
      unit: ['acuerdos', 'mes seleccionado'],
      what: 'Los acuerdos vigentes cuyo cliente se queda sin beneficio al terminar este mes o el siguiente: la lista de a quién hay que llamar.',
      rows: [
        { label: 'Promos prepagas', text: count(r.promos) },
        { label: 'Otros descuentos', text: count(r.discounts) },
        { label: 'Cuota del mes en juego', value: r.atStake, info: true }
      ],
      total: { label: 'Por renovar', text: count(r.count) },
      source: 'Se mira dónde termina la cadena de meses con beneficio del cliente, no cada acuerdo suelto. Una promo que ya tiene otra pegada a continuación, o un descuento que sigue escalonado (por ejemplo 25%, después 20%, después 15%), no aparece hasta su último tramo. La cuota en juego es el servicio del mes de esos clientes: la asistencia con el descuento más el transporte.',
      caveat: 'Renovar una promo o un descuento se hace desde la ficha de cada cliente: este bloque es de solo lectura.'
    }
  },

  benefPromos: () => ({
    title: 'Promos prepagas',
    unit: ['con IVA', 'por acuerdo'],
    what: 'Cada promo prepaga: meses seguidos con un porcentaje de descuento sobre la asistencia. El primer mes cobra el paquete entero y los demás quedan cubiertos en $ 0.',
    rows: [
      { label: 'Motivo', text: 'cargado al crearla' },
      { label: 'Avance', text: 'mes de la promo' },
      { label: 'Dto del mes', text: 'lista − cobrable' },
      { label: 'Paquete', text: 'cobrado o pactado' },
      { label: 'Dto total (historial)', text: 'pactado' }
    ],
    source: 'Motivo es el texto opcional que se carga al crear la promo; las promos creadas antes de que existiera no lo tienen. Avance es en qué mes de la promo cae el mes elegido. Dto del mes es el descuento de ese mes: su precio de lista menos lo cobrable. Paquete es lo que entró, o el total pactado si todavía no se cobró. En el historial, Dto total es el descuento del paquete entero, guardado al crear la promo. Si el cliente ya tiene otra promo o un descuento pegado a continuación, la fila dice con qué sigue.',
    caveat: 'Crear, cobrar o cancelar una promo se hace desde la ficha del cliente. Una promo puede tener cualquier cantidad de meses y cualquier porcentaje.'
  }),

  benefDiscounts: ({ benefits }) => {
    const missing = benefits?.history?.missingMonths
    return {
      title: 'Otros descuentos',
      unit: ['con IVA', 'por tramo'],
      what: 'Descuentos sueltos sobre la asistencia, sin paquete ni cobro adelantado. La base no guarda un acuerdo de descuento: cada fila son los meses seguidos de un cliente con el mismo porcentaje y el mismo motivo.',
      rows: [
        { label: 'Motivo', text: 'cargado al aplicarlo' },
        { label: 'Dto del mes', text: 'lista − cobrable' },
        { label: 'Cuota del mes', text: 'asistencia + transporte' },
        { label: 'Dto total (historial)', text: 'meses cobrados' }
      ],
      source: 'Motivo es el texto opcional que se carga al aplicar el descuento. Si el porcentaje o el motivo cambian de un mes a otro (un descuento escalonado), cada tramo es una fila y la anterior dice con cuánto sigue. La cuota del mes es el servicio del mes: la asistencia con el descuento más el transporte. En el historial, Dto total suma lo descontado en los meses cobrados, reconstruido de lo cobrado: cobrado × % ÷ (100 − %).',
      caveat: missing > 0
        ? `En el rango hay ${plural(missing, 'mes', 'meses')} sin cobrar (o al 100%) sin dato: no suman al Dto total.`
        : 'Los descuentos aplicados antes de que existiera el motivo no lo tienen.'
    }
  },

  benefHistory: ({ benefits }) => {
    const h = benefits?.history || {}
    return {
      title: 'Descuento otorgado',
      unit: ['con IVA', 'acuerdos terminados'],
      what: 'Lo descontado por los acuerdos que terminaron en el rango elegido.',
      rows: [
        { label: `Promos prepagas (${count(h.promos)})`, value: h.promoDiscount },
        { label: `Otros descuentos (${count(h.discounts)})`, value: h.looseDiscount, op: '+' }
      ],
      total: { label: 'Descuento otorgado', value: h.discount },
      source: 'Una promo aporta el descuento pactado de su paquete. Un tramo de descuento suelto aporta lo descontado en sus meses cobrados. Un acuerdo entra si su último mes cae en el rango, siempre antes del mes en curso.',
      caveat: h.missingMonths > 0
        ? `${plural(h.missingMonths, 'mes', 'meses')} sin cobrar (o al 100%) no tienen dato y no suman.`
        : 'El historial no sigue al mes elegido arriba: se recorta con su propio rango.'
    }
  }
}

export default promotionsDocs
