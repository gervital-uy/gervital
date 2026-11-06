import { DIMENSIONS } from '../../../../services/dashboardV2/commercialView'
import { DEFAULT_SHIFT_CAPACITY } from '../../../../services/dashboardV2/occupancy'
import { PLATFORM_START_ISO } from '../../../../services/dashboardV2/platform'
import { DASH, MINUS, MONTH_FULL, formatDecimal, monthLabelOf, money, pctText, plural } from '../../format'

// Explicaciones de la pestaña Comercial. ctx = { month, occupancy, composition,
// mix, exits, cohorts, monthLabel }: month es commercialView.month(i); occupancy la
// del aforo en pantalla (guardado o a prueba); composition y mix { dimension, rows }
// de la dimensión elegida; exits y cohorts los de la ventana y la vista elegidas.

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const count = v => (isNum(v) ? String(v) : DASH)
const monthsText = n => (isNum(n) ? `${n} ${n === 1 ? 'mes' : 'meses'}` : DASH)
const signed = n => (!isNum(n) ? DASH : n > 0 ? `+${n}` : n < 0 ? `${MINUS}${-n}` : '0')
const negative = v => (isNum(v) ? -v : undefined)
const share = (part, total) => (isNum(part) && isNum(total) && total > 0 ? pctText((part / total) * 100, 0) : DASH)
const LAUNCH_YEAR = Number(PLATFORM_START_ISO.slice(0, 4))
const LAUNCH_MONTH = MONTH_FULL[Number(PLATFORM_START_ISO.slice(5, 7)) - 1]
const LAUNCH = monthLabelOf(LAUNCH_YEAR, Number(PLATFORM_START_ISO.slice(5, 7)) - 1)

const TIMELINE_SOURCE = 'Sale de la fecha de ingreso de cada ficha y de sus períodos de inactividad, que son la fuente de verdad de las bajas y los reingresos (la ficha solo guarda la baja actual). Los períodos superpuestos se unen y una baja deshecha al día siguiente no cuenta. Cada reingreso es un alta.'
const MRR_BASIS = 'la cuota de lista del plan vigente del mes con el descuento de ese mes (de una promo o suelto), más el transporte, todo sin IVA'

const activeClients = ({ month = {}, monthLabel = 'el mes' }) => {
  const c = month.counts || {}
  return {
    title: 'Clientes activos',
    unit: ['clientes regulares', month.partial ? 'al día de hoy' : 'al cierre del mes'],
    what: `Cuántos clientes regulares tenía el centro al cierre de ${monthLabel}${month.partial ? ' (el mes está en curso: al día de hoy)' : ''}.`,
    rows: [
      { label: c.inherited ? `Base al inicio (${plural(c.inherited, 'heredado', 'heredados')} del lanzamiento)` : 'Base al inicio del mes', text: count(c.opening) },
      { label: 'Altas nuevas', text: count(c.newAltas), op: '+' },
      { label: 'Reingresos', text: count(c.returns), op: '+' },
      { label: 'Bajas', text: count(c.bajas), op: '−' }
    ],
    total: { label: month.partial ? 'Activos hoy' : 'Activos al cierre', text: count(c.closing) },
    source: `${TIMELINE_SOURCE} Los clientes cargados con la fecha de lanzamiento de la plataforma (${LAUNCH}) son la base heredada, no altas.`,
    caveat: `Solo cuenta clientes regulares: los que están a prueba y los no facturables quedan afuera, y quien vino a prueba y no se quedó no es ni alta ni baja (la misma regla que /bajas). Quien se queda después de la prueba entra desde su fecha de ingreso, así que una conversión puede sumar a meses ya pasados. Una baja o un reingreso programados entran recién el día que ocurren.${c.pauses ? ` ${plural(c.pauses, 'baja del mes está', 'bajas del mes están')} en pausa temporal según su seguimiento: ${c.pauses === 1 ? 'cuenta' : 'cuentan'} como baja igual.` : ''}`
  }
}

const mrr = ({ month = {} }) => {
  const v = month.mrr?.closing || {}
  const missing = v.missing || {}
  return {
    title: 'MRR contratado',
    unit: ['sin IVA', 'con descuentos', 'cartera al cierre'],
    what: 'Lo que la cartera activa tiene pactado por mes. Es un run-rate, no lo facturado: un alta del día 20 vale su cuota entera y una falta no lo mueve.',
    rows: [
      { label: `Cuotas de lista de asistencia (${plural(v.count, 'cliente', 'clientes')})`, value: v.attendanceList },
      { label: 'Descuentos del mes (promos y sueltos)', value: negative(v.discount), op: '−' },
      { label: 'Transporte', value: v.transport, op: '+' },
      ...(missing.plan ? [{ label: 'Sin plan (valen $ 0)', text: count(missing.plan), info: true }] : []),
      ...(missing.price ? [{ label: 'Sin precio de lista para su plan (la asistencia vale $ 0)', text: count(missing.price), info: true }] : []),
      ...(missing.distance ? [{ label: 'Con transporte y sin distancia (el transporte vale $ 0)', text: count(missing.distance), info: true }] : [])
    ],
    total: { label: 'MRR contratado', value: v.total },
    source: `Por cliente activo, ${MRR_BASIS}. El plan es la versión vigente del mes (client_plans está versionado por fecha de vigencia y se toma una sola), el precio es el de lista vigente ese mes, el descuento sale del mes del cliente (monthly_invoices) y el transporte va por frecuencia y por la distancia de su dirección. La asistencia se netea al 22% y el transporte al 10%. El descuento corre solo sobre la asistencia, igual que en la facturación.`,
    caveat: 'No es el ingreso de Finanzas ni lo cobrado en Gestión CFP: no prorratea altas ni bajas, no descuenta faltas no cobrables y no sigue la caja. Un mes de promo prepaga vale su cuota con descuento, no el paquete entero en el primer mes. Quien se dio de baja en el mes ya no está.'
  }
}

const mrrFlow = ({ month = {} }) => {
  const r = month.mrr || {}
  const w = r.window || {}
  const c = month.counts || {}
  return {
    title: 'MRR ganado y perdido',
    unit: ['sin IVA', 'con descuentos', 'mes seleccionado'],
    what: `Cuánto MRR sumaron las altas del mes y cuánto se llevaron las bajas, valuados igual que el MRR: ${MRR_BASIS}.`,
    rows: [
      { label: c.inherited ? 'MRR de la base heredada' : 'MRR al cierre del mes anterior', value: r.opening },
      { label: `Ganado: ${plural(c.altas, 'alta', 'altas')}`, value: r.gained?.total, op: '+' },
      { label: `Perdido: ${plural(c.bajas, 'baja', 'bajas')}`, value: negative(r.lost?.total), op: '−' },
      { label: 'Cambios de plan, de precio y de descuento', value: r.other, op: r.other < 0 ? '−' : '+' },
      { label: `Ganado en ${monthsText(w.months)}`, text: money(w.gained), info: true },
      { label: `Perdido en ${monthsText(w.months)}`, text: money(w.lost), info: true }
    ],
    total: { label: 'MRR al cierre', value: r.closing?.total },
    source: 'Las altas y las bajas son las mismas que cuenta Clientes activos (un reingreso es un alta). Un alta suma lo que vale en su mes. Una baja resta lo que aportaba al MRR del cierre anterior, que es lo que efectivamente se fue; si entró y se fue en el mismo mes, resta lo mismo que sumó. Lo que se movió el MRR de los que estaban y siguen (un cambio de plan, un precio de lista nuevo, una promo que empieza o termina) queda como residuo, así que las filas siempre cierran.',
    caveat: `Las tarjetas comparan el mes con el promedio de los meses cerrados de la ventana (${monthsText(w.avgMonths)}: los que la plataforma lleva operando, hasta 12). El mes en curso no se compara: va hasta hoy y el promedio es de meses completos, así que se vería peor o mejor de lo que es. Los cambios de plan no se registran como evento, así que la venta de más días a un cliente que ya está (expansión) y la de menos (contracción) viajan juntas en el residuo.`
  }
}

const churn = ({ month = {} }) => {
  const w = month.churn?.window || {}
  const base = month.counts?.opening
  return {
    title: 'Churn 12 meses',
    unit: ['% de la cartera media', `${monthsText(w.months)} con datos`],
    what: `Qué parte de la cartera se fue en los últimos 12 meses: las bajas de la ventana sobre la cartera media de esos meses.${isNum(w.months) && w.months < 12 ? ` La plataforma opera desde ${LAUNCH}, así que la ventana usa los ${w.months} meses que hay y divide por la cartera media de esos meses, nunca por doce.` : ''}`,
    rows: [
      { label: `Bajas en ${monthsText(w.months)}`, text: count(w.bajas) },
      { label: 'Cartera media (promedio de los cierres)', text: isNum(w.baseMedia) ? formatDecimal(w.baseMedia) : DASH, op: '÷' },
      { label: 'Bajas de este mes', text: count(month.counts?.bajas), info: true },
      { label: 'Churn del mes (bajas ÷ base al inicio)', text: pctText(month.churn?.month), info: true },
      { label: `Promedio de bajas por mes (${monthsText(w.avgMonths)} ${w.avgMonths === 1 ? 'cerrado' : 'cerrados'})`, text: formatDecimal(w.avgBajas), info: true },
      { label: 'Ventana anterior del mismo largo', text: w.prev ? pctText(w.prev.churn) : 'todavía no existe', info: true }
    ],
    total: { label: 'Churn de la ventana', text: pctText(w.churn) },
    source: 'Las bajas son las mismas que cuentan Clientes activos y Bajas por motivo. La cartera media es el promedio de los activos al cierre de cada mes de la ventana (el mes en curso, al día de hoy): si la cartera creció, dividir por el último cierre daría un churn más bajo que el real.',
    caveat: `${isNum(base) && base > 0 ? `Con ${base} clientes de base, una sola baja mueve el churn del mes ${formatDecimal(100 / base)} puntos: ` : 'Con una cartera chica, una sola baja mueve mucho el churn del mes: '}por eso el titular es la ventana y el mes va en personas. El color compara contra la ventana anterior del mismo largo (verde si bajó más de un punto, rojo si subió más de uno), que recién existe cuando la plataforma tiene el doble de historia: hasta entonces va en gris. Las bajas del mes se comparan con el promedio de los meses cerrados; en el mes en curso no se comparan, porque el mes no terminó. Una baja en pausa temporal cuenta como baja.`
  }
}

const tenure = ({ month = {} }) => {
  const t = month.tenure || {}
  const monthsOf = v => (isNum(v) ? `${formatDecimal(v)} meses` : DASH)
  return {
    title: 'Permanencia media',
    unit: ['meses', 'alta registrada por la plataforma'],
    what: 'Hace cuánto está, en promedio, un cliente activo cuya alta registró la plataforma. Se mide desde su última alta: quien reingresa empieza de cero.',
    rows: [
      { label: 'Activos con alta registrada', text: count(t.measured) },
      { label: 'Heredados, sin fecha de alta', text: count(t.inherited), info: true },
      { label: `Vida media de las bajas con alta registrada (${count(t.closedMeasured)})`, text: monthsOf(t.closedAvgMonths), info: true }
    ],
    total: { label: 'Permanencia media', text: monthsOf(t.measured ? t.avgMonths : null) },
    source: `Días desde el alta de cada activo hasta el cierre del mes (o hasta hoy), pasados a meses de 30,4 días. Los heredados, cargados al lanzar la plataforma en ${LAUNCH}, no tienen fecha de alta real: no entran al promedio ni se les inventa antigüedad.`,
    caveat: 'Mientras la plataforma sea nueva nadie puede tener más antigüedad que los meses que lleva operando, así que el número sube solo cada mes. Mide la antigüedad de los que siguen, no cuánto dura un cliente: para eso está la vida media de las bajas, que también es corta por la misma razón.'
  }
}

const capacityOrigin = o => (o.simulated
  ? 'un aforo a prueba, sin guardar'
  : o.isDefaultCapacity ? `el aforo por defecto (no hay uno guardado)` : 'el aforo guardado del centro')

// Quiénes ocupan un lugar: la ocupación cuenta a todos, pague o no.
const OCCUPANTS = 'todos los que ocupan un lugar al cierre del mes (o hoy, si está en curso), paguen o no: los clientes regulares, los no facturables y los que están a prueba (también la prueba de quien después se quedó, desde la fecha en que empezó)'

const occupancy = ({ occupancy: o = {}, monthLabel = 'el mes' }) => {
  const shifts = o.shifts || []
  const [am, pm] = shifts
  const busiest = shifts.filter(s => s.busiest.users > 0).map(s => `${s.label.toLowerCase()}, el ${s.busiest.label.toLowerCase()} con ${s.busiest.users} de ${o.capacity}`).join('; ')
  const unpaid = isNum(o.taken) && isNum(o.sold) ? o.taken - o.sold : null
  return {
    title: 'Ocupación y rendimiento por lugar',
    unit: ['sobre lo contratado', 'lugares por turno', o.simulated ? 'aforo a prueba' : 'mes seleccionado'],
    what: `Qué parte de los lugares de cada turno está ocupada y cuánto MRR rinde cada lugar. Se toman ${count(o.capacity)} lugares por turno (${capacityOrigin(o)}), iguales para la mañana y la tarde: cada turno ofrece ese aforo por cada día hábil del mes.`,
    rows: [
      { label: `Días hábiles de ${monthLabel} (lunes a viernes)`, text: count(o.workdays) },
      { label: `Lugares por turno en el mes (${count(o.capacity)} × ${count(o.workdays)})`, text: count(o.seatsPerShift) },
      { label: 'Ocupados a la mañana (incluye día completo)', text: am ? `${am.taken} · ${pctText(am.pct, 0)}` : DASH },
      { label: 'Ocupados a la tarde (incluye día completo)', text: pm ? `${pm.taken} · ${pctText(pm.pct, 0)}` : DASH },
      { label: 'Promedio por día: mañana / tarde', text: am && pm ? `${formatDecimal(am.perDay)} / ${formatDecimal(pm.perDay)}` : DASH },
      { label: 'De los ocupados, de no facturables o a prueba', text: count(unpaid), info: true },
      { label: 'MRR por lugar disponible', text: money(o.revenuePerSeat), info: true },
      { label: `MRR por lugar vendido (${count(o.sold)} de clientes regulares)`, text: money(o.revenuePerSoldSeat), info: true }
    ],
    total: { label: 'Ocupación general', text: isNum(o.pct) ? `${pctText(o.pct, 0)} de ${o.seatsMonth} lugares-turno` : DASH },
    source: `Cuenta a ${OCCUPANTS}. Lo que se agota es el lugar, no la cuota. De cada uno se toman los días de la semana de su plan vigente del mes y se cuentan las veces que cae cada uno en el mes (un mes con cinco lunes ocupa cinco lunes). Un plan de día completo ocupa un lugar a la mañana y otro a la tarde. El aforo se guarda en la configuración del centro (shift_capacity) desde esta tarjeta; mientras no haya uno guardado se usan ${DEFAULT_SHIFT_CAPACITY}. El rendimiento divide el MRR contratado del mes, sin IVA, entre los lugares disponibles o entre los vendidos, que son solo los de clientes regulares (los únicos que pagan).`,
    caveat: `Los libres son un promedio del mes, y lo que limita una venta es el día más cargado${busiest ? ` (${busiest})` : ''}: el detalle está en el mapa de calor. Se mide sobre lo contratado, así que no baja cuando alguien falta (eso es Asistencia). No hay calendario de feriados: cuentan todos los días de lunes a viernes.${o.simulated ? ' El aforo que se ve es una prueba: no está guardado.' : ''}`
  }
}

const perDay = shift => shift.cells.map(c => c.users).join(' · ')

const heatmapSeats = ({ occupancy: o = {} }) => {
  const shifts = o.shifts || []
  const room = shifts.filter(s => s.mostRoom.free > 0).map(s => `${s.label.toLowerCase()} del ${s.mostRoom.label.toLowerCase()}`).join(' y ')
  return {
    title: 'Mapa de calor de ocupación',
    unit: ['sobre lo contratado', '% del aforo', o.simulated ? 'aforo a prueba' : 'mes seleccionado'],
    what: 'Qué parte del aforo está ocupada en cada casillero: día de la semana por turno. Es la ocupación de la tarjeta de arriba abierta por casillero; mide lugares contratados, no gente que vino.',
    rows: [
      { label: `Aforo por turno (${capacityOrigin(o)})`, text: count(o.capacity) },
      ...shifts.map(s => ({ label: `${s.label}: clientes por día (lun a vie)`, text: perDay(s) })),
      ...shifts.map(s => ({ label: `${s.label}: lugares ocupados en el mes`, text: `${s.taken} de ${o.seatsPerShift}` }))
    ],
    total: { label: 'Ocupación del turno', text: shifts.map(s => `${s.label} ${pctText(s.pct, 0)}`).join(' · ') || DASH },
    source: `Cada celda son los que tienen ese día en su plan vigente del mes, sobre el aforo. Cuenta a ${OCCUPANTS}. El promedio de la fila se pondera por las veces que cae cada día en el mes y da exactamente la ocupación del turno de la tarjeta de arriba. Un plan de día completo cuenta en las dos filas.`,
    caveat: `Como mide lo contratado, no baja cuando alguien falta: para planificar personal hace falta la asistencia esperada, que es de Asistencia. No hay calendario de feriados.${room ? ` Donde entra un cliente más con menos carga de alta dependencia: ${room}.` : ''}`
  }
}

const heatmapTiers = ({ occupancy: o = {} }) => {
  const shifts = o.shifts || []
  return {
    title: 'Mapa de ocupación por tier',
    unit: ['sobre lo contratado', 'clientes por casillero', 'mes seleccionado'],
    what: 'La misma ocupación del mapa de cupos, abierta por el tier de cada cliente. La barra llena es el aforo y cada tramo es cuántos clientes de ese nivel de dependencia tienen ese día en su plan.',
    rows: shifts.flatMap(s => [
      { label: `${s.label}: clientes por día (lun a vie)`, text: perDay(s) },
      { label: `${s.label}: de ellos, tier C o D`, text: s.cells.map(c => c.dependents).join(' · ') }
    ]),
    total: {
      label: 'Casillero con más alta dependencia',
      text: shifts.map(s => (s.mostDependents.dependents > 0
        ? `${s.label.toLowerCase()} ${s.mostDependents.label.toLowerCase()}: ${s.mostDependents.dependents} de ${s.mostDependents.users}`
        : `${s.label.toLowerCase()}: sin tier C ni D`)).join(' · ') || DASH
    },
    source: 'Cruza el tier de la ficha con los días y el turno del plan vigente del mes, de todos los que ocupan un lugar (regulares, no facturables y a prueba). El total de cada casillero es el mismo de la vista Cupos: una dice cuántos y la otra, quiénes.',
    caveat: 'El tier es el que tiene hoy la ficha: no se guarda su historia, así que en un mes pasado se ve el tier actual de cada cliente. El aforo es el mismo para todos los perfiles: la plataforma no tiene una relación de atención por tier. Como todo el mapa, mide lo contratado.'
  }
}

const composition = ({ composition: comp = {} }) => {
  const rows = comp.rows || []
  const total = rows.reduce((s, r) => s + r.value, 0)
  const dimension = DIMENSIONS[comp.dimension]?.label
  return {
    title: 'Composición de la base',
    unit: ['clientes activos', 'mes seleccionado'],
    what: `Cómo se reparten los clientes activos${dimension ? ` por ${dimension.toLowerCase()}` : ''}. Plan, tier y edad son escalas: las filas van en su orden, no de mayor a menor.`,
    rows: rows.map(r => ({ label: r.label, text: `${r.value} · ${share(r.value, total)}` })),
    total: { label: 'Clientes activos', text: rows.length ? String(total) : DASH },
    source: 'Los activos al cierre del mes, cada uno con la versión vigente de su plan ese mes. La edad es la cumplida al cierre, según la fecha de nacimiento de la ficha; los tramos son de cinco años entre los 75 y los 89, con una punta abierta a cada lado.',
    caveat: 'El tier es el actual de la ficha (no tiene historial). Lo que falta en la ficha va en "Sin dato". Es una foto del mes: para ver cómo cambió la mezcla hay que recorrer los meses.'
  }
}

const revenueMix = ({ mix = {}, month = {} }) => {
  const rows = mix.rows || []
  return {
    title: 'Aporte a la facturación',
    unit: ['sin IVA', 'MRR contratado', 'mes seleccionado'],
    what: 'Cuánto del MRR contratado trae cada segmento, de mayor a menor. La flecha de cada fila compara su parte de la plata con su parte de los clientes, en puntos porcentuales: ▲ es un segmento que factura más de lo que pesa en gente.',
    rows: rows.map((r, i) => ({ label: `${r.label} (${plural(r.clients, 'cliente', 'clientes')})`, value: r.value, op: i === 0 ? undefined : '+' })),
    total: { label: 'MRR contratado', value: month.mrr?.closing?.total },
    source: `Es el MRR de la tarjeta de arriba repartido por segmento: ${MRR_BASIS}. Los segmentos suman exacto el MRR.`,
    caveat: 'Es contrato, no facturación ni caja: no coincide con los ingresos de Finanzas ni con lo cobrado en Gestión CFP. El transporte suma al segmento de cada cliente. El tier es el actual de la ficha.'
  }
}

const clientFlow = ({ month = {} }) => {
  const c = month.counts || {}
  const flow = month.flow || []
  const total = key => (flow.length ? flow.reduce((s, r) => s + r[key], 0) : undefined)
  return {
    title: 'Altas vs Bajas',
    unit: ['clientes', 'hasta 12 meses'],
    what: 'Cuántos clientes entraron y cuántos se fueron cada mes, en personas. Arriba las altas, abajo las bajas; la línea es la variación (altas − bajas), que es exactamente cuánto cambió la cartera ese mes.',
    rows: [
      { label: 'Altas nuevas del mes', text: count(c.newAltas) },
      { label: 'Reingresos del mes', text: count(c.returns), op: '+' },
      { label: 'Bajas del mes', text: count(c.bajas), op: '−' },
      { label: `Altas en ${monthsText(flow.length)}`, text: count(total('altas')), info: true },
      { label: `Bajas en ${monthsText(flow.length)}`, text: count(total('bajas')), info: true }
    ],
    total: { label: 'Variación del mes', text: signed(isNum(c.altas) && isNum(c.bajas) ? c.altas - c.bajas : null) },
    source: `${TIMELINE_SOURCE} Abajo, los activos al cierre de cada mes: cada uno es el anterior más la variación.`,
    caveat: `La vista interanual compara el mismo mes en cada año con el centro operando: cada mes se puede comparar recién cuando el centro lo operó en dos años distintos (${LAUNCH_MONTH}, por ejemplo, recién desde ${LAUNCH_MONTH} de ${LAUNCH_YEAR + 1}). El mes en curso cuenta hasta hoy. Cuenta personas, no plata: el efecto en la facturación está en el MRR ganado y perdido.`
  }
}

const exitsByReason = ({ exits: e = {} }) => {
  const rows = e.rows || []
  const scope = e.requested == null ? 'toda la historia cargada' : `los últimos ${e.requested} meses`
  return {
    title: 'Bajas por motivo',
    unit: ['bajas', e.requested == null ? 'histórico' : `ventana de ${e.requested} meses`],
    what: `Por qué se fueron los clientes en ${scope}. La ventana nombra lo que se pide; lo que se cuenta son los meses que existen desde ${LAUNCH}${isNum(e.requested) && isNum(e.months) && e.months < e.requested ? `: hoy, ${e.months}` : ''}.`,
    rows: rows.map(r => ({ label: r.pauses ? `${r.label} (${r.pauses} en pausa)` : r.label, text: `${r.value} · ${share(r.value, e.total)}` })),
    total: { label: 'Bajas de la ventana', text: count(e.total) },
    source: 'El motivo es el que se eligió al dar la baja, con los nombres del catálogo de motivos de /bajas. Las filas van de más a menos bajas y, a igual cantidad, en el orden del catálogo. Si dos bajas se superponen cuenta una sola, con el motivo de la que la abre. La comparación con la ventana anterior aparece solo cuando esa ventana entra entera desde el lanzamiento.',
    caveat: 'Con una o dos bajas por mes, el orden de los motivos en una ventana corta es casi azar: para decidir sirve la ventana larga. El dato depende de elegir bien el motivo al dar la baja: si muchas quedan en "Otro", no dice nada. Las bajas en pausa temporal (según su seguimiento) cuentan igual y se marcan aparte.'
  }
}

const cohorts = ({ cohorts: k = {} }) => {
  const unit = k.mode === 'quarter' ? 'trimestre' : 'mes'
  const next = (k.average || []).find(a => a.k === 1)
  return {
    title: 'Retención por cohortes',
    unit: ['clientes', '% de las altas de cada cohorte'],
    what: 'Agrupa las altas por el período en que entraron y sigue cuántas siguen activas al cierre de cada período siguiente. Cada fila es una cohorte y cada columna, los períodos desde el alta: en horizontal se ve el desgaste de una camada; en vertical, si las camadas nuevas retienen mejor o peor que las viejas en el mismo momento.',
    rows: [
      { label: 'Cohortes a la vista', text: count(k.rows?.length) },
      { label: 'Altas en esas cohortes', text: count(k.entries) },
      { label: 'Cohortes sin altas', text: count(k.emptyCohorts), info: true },
      { label: 'Cada celda', text: 'siguen activos ÷ altas' }
    ],
    total: { label: `Todas juntas, un ${unit} después del alta`, text: next ? `${pctText(next.pct, 0)} (${next.active} de ${next.base})` : DASH },
    source: 'Las altas son las mismas de Altas vs Bajas: primeras altas y reingresos. Se sigue cada tramo y no a la persona: quien se va y reingresa queda como baja en su cohorte y abre un registro en la del reingreso. Los heredados no tienen alta y no están en ninguna cohorte: los vivos de todas las cohortes más los heredados activos son los activos del mes.',
    caveat: `La columna 0 es el cierre del mismo ${unit} del alta, así que puede no ser 100%: quien entró y se fue en el mismo ${unit} ya cuenta como baja. Con cohortes de dos o tres personas cada celda salta mucho: la fila Todas, ponderada por tamaño, es la única con algo de peso. En la vista trimestral el primer trimestre arranca con el lanzamiento (${LAUNCH}) y tiene menos de tres meses.`
  }
}

const commercialDocs = {
  activeClients,
  mrr,
  mrrFlow,
  churn,
  tenure,
  occupancy,
  heatmapSeats,
  heatmapTiers,
  composition,
  revenueMix,
  clientFlow,
  exitsByReason,
  cohorts
}

export default commercialDocs
