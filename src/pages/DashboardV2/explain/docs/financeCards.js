import { DASH, plural, pctText } from '../../format'
import { BRIDGE_LABELS, PART_LABELS } from '../../sections/finance/cardsText'

// Explicaciones de las tarjetas de análisis de Finanzas. ctx = { finance: { q, open,
// cards, transport }, monthLabel }: q de financeQuadrantsV2, cards de financeCards y
// transport de buildTransportEconomics (null mientras carga la programación).

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const neg = v => (typeof v === 'number' ? -v : undefined)
const sumOf = (...values) => (values.every(v => typeof v === 'number') ? values.reduce((a, v) => a + v, 0) : undefined)
const partOf = (block, key) => block?.parts?.find(p => p.key === key)?.value
const count = v => (typeof v === 'number' ? String(v) : DASH)

const financeCardsDocs = {
  finPersonal: ({ finance, monthLabel = 'el mes' }) => {
    const b = finance?.cards?.personal
    const income = finance?.q?.income
    return {
      title: 'Personal',
      unit: ['con IVA', 'mes seleccionado'],
      what: 'Lo que cuesta la gente que hace funcionar el centro: sueldos, prestadores de servicios, extras del personal y el aporte jubilatorio de los directores.',
      rows: [
        { label: PART_LABELS.salaries, value: partOf(b, 'salaries') },
        { label: PART_LABELS.providers, value: partOf(b, 'providers'), op: '+' },
        { label: PART_LABELS.extras, value: partOf(b, 'extras'), op: '+' },
        { label: PART_LABELS.director, value: partOf(b, 'director'), op: '+' },
        { label: 'Sobre lo que tiene que entrar al banco', text: pctText(income > 0 && b ? (b.total / income) * 100 : null, 0), info: true }
      ],
      total: { label: 'Personal del mes', value: b?.total },
      source: `Sueldos: el costo para la empresa de cada empleada en ${monthLabel} (el líquido llevado a nominal, los aportes patronales, el aguinaldo y el salario vacacional mensualizados). Prestadores: el monto mensual de cada prestador activo; la tabla no guarda desde cuándo trabaja cada uno, así que cuenta desde que se cargó y en meses pasados es aproximado. Antes de septiembre de 2026 sus pagos se cargaban como extraordinarios sueltos de Sueldos y cuentan acá. Extras: los extraordinarios del personal, en su mes. Aporte de directores: el del mes, calculado si Costos todavía no generó su fila.`,
      caveat: finance?.q?.row?.costs?.providersMissing
        ? 'En este mes no hay ningún pago a prestadores cargado: el personal está incompleto y el resultado sale más alto de lo que fue.'
        : 'La variación de cada pieza es contra el mes anterior: como es gasto, subir va en rojo.'
    }
  },

  finOperating: ({ finance, monthLabel = 'el mes' }) => {
    const b = finance?.cards?.operating
    return {
      title: 'Gastos fijos, variables y extraordinarios',
      unit: ['con IVA', 'fijos mensualizados', 'mes seleccionado'],
      what: 'Todo el gasto que no es personal, en sus tres tipos de Costos.',
      rows: [
        { label: 'Fijos (mensualizados)', value: partOf(b, 'fixed') },
        { label: 'Variables', value: partOf(b, 'variable'), op: '+' },
        { label: 'Extraordinarios', value: partOf(b, 'extraordinary'), op: '+' }
      ],
      total: { label: 'Gastos sin el personal', value: b?.total },
      source: `Fijos: las plantillas de gastos fijos de Costos, mensualizadas (un pago anual pesa un doceavo cada mes). Si en ${monthLabel} ese gasto ya estaba cargado como variable, la plantilla no cuenta, para no contarlo dos veces. Variables: los gastos variables cargados en el mes. Extraordinarios: los gastos extraordinarios del mes.`,
      caveat: partOf(b, 'extraordinary') === 0
        ? 'Extraordinarios da $ 0 cuando no hay gastos extraordinarios cargados en Costos para el mes. Los variables incluyen las compras puntuales: una compra de activo cargada como variable pesa entera en su mes.'
        : 'Los variables incluyen las compras puntuales: una compra de activo cargada como variable pesa entera en su mes.'
    }
  },

  finCategories: ({ finance, monthLabel = 'el mes' }) => {
    const c = finance?.cards?.categories
    return {
      title: 'Gastos por categoría',
      unit: ['con IVA', 'sin el personal', 'fijos mensualizados'],
      what: 'El gasto que no es personal, por la categoría con que se cargó en Costos, contra el mes anterior.',
      rows: [
        ...(c?.rows || []).map((r, i) => ({ label: r.label, value: r.value, ...(i ? { op: '+' } : {}) })),
        ...(c?.prevTotal != null ? [{ label: 'El mes anterior', value: c.prevTotal, info: true }] : [])
      ],
      total: { label: 'Gastos sin el personal', value: c?.total },
      source: `Cada movimiento de Costos de ${monthLabel}, agrupado por su categoría: las plantillas fijas (mensualizadas), los gastos variables y los extraordinarios. Una categoría junta los tres tipos; el reparto se ve al pasar sobre la fila. Una categoría que el mes anterior tuvo gasto y este no aparece en $ 0, para que las variaciones sumen la del total.`,
      caveat: 'La categoría es la que se eligió al cargar el gasto: si algo quedó mal clasificado, se corrige en Costos.'
    }
  },

  finCash: ({ finance }) => {
    const c = finance?.cards?.cash
    return {
      title: 'Caja del mes',
      unit: ['con IVA', 'mes seleccionado'],
      what: 'Lo que el mes tiene que cobrar, cuánto ya entró y cuánto falta, con IVA: el Previsto de la Cobranza de Gestión CFP. Al lado, la caja real del mes por fecha de pago.',
      rows: [
        { label: 'Ya entró', value: c?.collected },
        { label: 'Falta cobrar', value: c?.pending, op: '+' },
        { label: 'Caja del mes (todo lo pagado con fecha en el mes)', value: c?.cash, info: true },
        { label: 'De esa caja, pagos de otros meses', value: c?.cashOtherMonths, info: true },
        ...(c?.packageAdvance > 0 ? [{ label: 'Del total, adelanto de paquetes de promo', value: c.packageAdvance, info: true }] : [])
      ],
      total: { label: 'A ingresar al banco (con IVA)', value: c?.bank },
      source: 'Una cuota ya cobrada cuenta por lo que entró y una pendiente por lo que debe; el paquete de una promo entra entero en su primer mes. Falta cobrar es solo lo de este mes: no acumula deuda de meses anteriores. La caja del mes es otra medida: toda la plata con fecha de pago en el mes, sea del mes que sea.',
      caveat: finance?.open ? 'Es el mes en curso: lo que falta cobrar todavía es una expectativa.' : 'Con IVA: no se compara con los ingresos sin IVA de las tarjetas de arriba.'
    }
  },

  finVat: ({ finance }) => {
    const c = finance?.cards?.cash
    return {
      title: 'IVA de ventas',
      unit: ['IVA', 'servicio del mes'],
      what: 'El IVA contenido en el servicio del mes, que es lo que se factura.',
      rows: [
        { label: 'Asistencia (22%)', value: num(c?.vatAttendance) },
        { label: 'Transporte (10%)', value: num(c?.vatTransport), op: '+' }
      ],
      total: { label: 'IVA de ventas', value: num(c?.vat) },
      source: 'Cada línea del servicio del mes con su tasa: la asistencia lleva 22% y el transporte 10%. Un paquete de promo no cambia el IVA del mes: cada mes se factura por su propio servicio.',
      caveat: 'Es el IVA de las ventas, no lo que se le paga a la DGI: falta descontar el IVA de las compras, que la plataforma no registra. La obligación real la determina el contador.'
    }
  },

  finBridge: ({ finance }) => {
    const b = finance?.cards?.bridge
    const costs = (b?.steps || []).filter(s => s.kind === 'cost')
    return {
      title: 'Puente de rentabilidad',
      unit: ['ingresos sin IVA', 'gastos con IVA', 'fijos mensualizados'],
      what: 'El resultado del mes abierto en sus partes: arranca en lo que tiene que entrar al banco y le resta cada bloque de gasto.',
      rows: [
        { label: 'A ingresar al banco (sin IVA)', value: b?.income },
        ...costs.map(s => ({ label: BRIDGE_LABELS[s.key].join(' '), value: neg(s.amount), op: '−' }))
      ],
      total: { label: 'Resultado del mes', value: b?.net },
      source: 'Es el mismo número que el KPI Resultado del mes. Sueldos y prestadores van primero porque son el costo directo del servicio; los extras del personal y el aporte de los directores son del mes. Los fijos van mensualizados.',
      caveat: 'Un bloque sin movimiento en el mes no se dibuja, así que la cantidad de barras puede cambiar de un mes a otro: se comparan por los porcentajes, no por la forma.'
    }
  },

  finLines: ({ finance }) => {
    const l = finance?.cards?.lines
    const a = l?.attendance
    const t = l?.transport
    return {
      title: 'Ingreso por línea',
      unit: ['sin IVA', 'servicio del mes'],
      what: 'Asistencia y transporte por separado: cuánto factura cada línea, cuántos clientes la tienen y cuánto deja cada uno.',
      rows: [
        { label: `Asistencia (${plural(a?.clients, 'cliente', 'clientes')})`, value: a?.revenue },
        { label: `Transporte (${plural(t?.clients, 'cliente', 'clientes')})`, value: t?.revenue, op: '+' }
      ],
      total: { label: 'Servicio del mes, sin IVA', value: sumOf(a?.revenue, t?.revenue) },
      source: 'Cada línea del servicio del mes sin su IVA: asistencia ÷ 1,22 y transporte ÷ 1,10. Se mide sobre el servicio y no sobre la caja, porque un cobro no se puede partir entre asistencia y transporte sin prorratearlo. Por cliente divide el ingreso de la línea entre los clientes que la tienen; en transporte, además, cuántos de los clientes facturados lo usan.',
      caveat: 'Es el servicio del mes, no lo que tiene que entrar al banco: no incluye los paquetes de promo adelantados. La comparación con el año anterior aparece desde junio de 2027.'
    }
  },

  finTransport: ({ finance }) => {
    const t = finance?.transport
    const known = t?.cost != null
    const notes = [
      t?.unbilledClients > 0 ? `${plural(t.unbilledClients, 'cliente viajó', 'clientes viajaron')} sin transporte en su cuota del mes (${plural(t.unbilledTrips, 'viaje', 'viajes')}): su parte del costo queda en su banda.` : null,
      t?.open ? 'Es el mes en curso: el costo y lo que cobra son del mes entero, pero los tramos y los viajes, solo los que ya pasaron.' : null,
      'Si un chofer no está cargado en Prestadores, el costo sale más bajo de lo que es.'
    ]
    return {
      title: 'Transporte por banda de distancia',
      unit: ['sin IVA', 'servicio del mes'],
      what: 'Si lo que cobra el transporte cubre lo que cuesta, banda por banda de distancia.',
      rows: [
        { label: 'Cobra el transporte (sin IVA)', value: t?.revenueNet },
        known
          ? { label: `Cuesta: ${plural(t.drivers?.length, 'chofer prestador', 'choferes prestadores')}`, value: neg(t.cost), op: '−' }
          : { label: 'Cuesta', text: 'sin choferes cargados' },
        { label: 'Tramos del mes', text: count(t?.legs), info: true },
        { label: 'Viajes', text: count(t?.trips), info: true },
        { label: 'Ocupación de los autos', text: pctText(t?.occupancyPct, 0), info: true },
        ...(t?.costPerLeg != null ? [{ label: 'Costo por tramo', value: t.costPerLeg, info: true }] : [])
      ],
      total: known ? { label: 'Margen del transporte', value: t.margin } : { label: 'Margen del transporte', text: DASH },
      source: 'Cobra: la línea de transporte del servicio del mes de cada cliente, sin el 10% de IVA, en la banda de distancia de su ficha. Cuesta: el monto mensual de los prestadores con rol de chofer. La base no guarda qué chofer maneja cada auto ni si se le paga por tramo, así que el costo del mes se reparte en partes iguales entre los tramos (un auto con al menos un pasajero en un turno de un día) y el de cada tramo, entre sus pasajeros. Los gastos del vehículo propio no entran. La ocupación son los pasajeros sobre los asientos de esos tramos.',
      caveat: notes.filter(Boolean).join(' ')
    }
  },

  finBreakeven: ({ finance }) => {
    const b = finance?.cards?.breakeven
    const be = typeof b?.breakevenUsers === 'number' ? Math.ceil(b.breakevenUsers) : null
    return {
      title: 'Punto de equilibrio',
      unit: ['servicio del mes sin IVA', 'gastos con IVA'],
      what: 'Cuánto deja cada usuario facturado y cuántos hacen falta para cubrir los costos que no cambian con la cantidad de usuarios.',
      rows: [
        { label: 'Costos que no cambian con los usuarios', value: b?.fixedCosts, info: true },
        { label: 'Aporte de cada usuario (ingreso − gasto variable por usuario)', value: b?.contributionPerUser, info: true },
        { label: 'Usuarios facturados en el mes', text: count(b?.users), info: true }
      ],
      total: { label: 'Usuarios para cubrir esos costos', text: be == null ? DASH : String(be) },
      source: 'El ingreso es el servicio del mes sin IVA: lo devengado y no el banco, porque el banco mete paquetes enteros que son de otros meses. Los costos que no cambian con los usuarios son todo el personal, los fijos mensualizados y los extraordinarios. El gasto variable por usuario es el gasto variable del mes dividido los usuarios facturados. El equilibrio es costos fijos ÷ aporte de cada usuario, redondeado para arriba.',
      caveat: 'Los gastos variables incluyen las compras puntuales: en un mes con una compra grande cargada como variable, el aporte por usuario sale más bajo y el equilibrio, más alto.'
    }
  }
}

export default financeCardsDocs
