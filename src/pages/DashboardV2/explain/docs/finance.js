import { DASH, MONTH_SHORT, money, monthLabelOf, pctText, plural } from '../../format'
import { deltaView } from '../../ui/DeltaTag'

// Explicaciones de Finanzas. Dos contextos:
//   · la sección (KPIs del mes): ctx = { finance: { q, open }, monthLabel }, con q de
//     financeQuadrantsV2 (services/dashboardV2/financeSeriesV2.js);
//   · el gráfico principal, que tiene su propio contexto: ctx = { chart: { money,
//     trend, margins, target, periods }, monthLabel } (FinanceChart.jsx).
// Todo sin IVA y sobre "A ingresar al banco", salvo donde se dice otra cosa.

const neg = v => (typeof v === 'number' ? -v : undefined)
const pp = v => (typeof v === 'number' && Number.isFinite(v) ? `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1).replace('.', ',')} pp` : DASH)

const BASE_RULE = 'Cada línea va sin su IVA: asistencia ÷ 1,22 y transporte ÷ 1,10. El IVA se cobra para la DGI: no es ingreso del centro.'
const EXPENSES_IVA = 'Los gastos van con el IVA adentro, porque la plataforma no separa el IVA de las compras; el ingreso va sin IVA. El resultado real es algo mejor que el que se ve.'
const PROVIDERS_RULE = 'La tabla de prestadores no guarda desde y hasta cuándo trabajó cada uno: cuenta desde el mes en que se cargó, con su monto de hoy, así que en meses pasados es una aproximación. Antes de septiembre de 2026 sus pagos se cargaban como extraordinarios sueltos de Sueldos: los que hay cuentan como prestadores, una sola vez, y un mes sin ninguno cargado queda sin ese costo.'
const TAXES_RULE = 'Ya descuenta los impuestos cargados como gasto en Costos (Impuestos y cargas fiscales, con el adelanto mensual de IRAE): no hay que volver a restarlos.'
const DELTA_RULE = 'Las variaciones de la tarjeta comparan contra el mes anterior y contra el mismo mes del año anterior (recién desde junio de 2027): en porcentaje si la base es positiva y, si es cero o negativa, la diferencia en pesos, porque un porcentaje sobre una base así engaña. Lo que redondeado da cero se muestra "=".'

// Un mes sin pagos a prestadores cargados (jun de 2026): el gasto está incompleto.
const missingProviders = name => `En ${name} no hay ningún pago a prestadores cargado (ni en la tabla ni como extraordinario suelto de Sueldos): el gasto de ese mes está incompleto y su resultado sale más alto de lo que fue.`
const monthNames = list => (list || []).map(m => `${MONTH_SHORT[m.month]} ${m.year}`).join(', ')
const signedMoney = v => (typeof v === 'number' && Math.round(v) > 0 ? `+${money(v)}` : money(v))

// Las variaciones de una tarjeta como filas que aclaran (no suman): el valor de
// referencia y la diferencia, solo las que existen (junio de 2026 no tiene mes
// anterior). key: 'income' | 'expenses' | 'result', las de q.deltas.
function deltaRows(q, key) {
  return [
    { c: q?.deltas?.[`${key}MoM`], ref: q?.prev, what: 'Mes anterior' },
    { c: q?.deltas?.[`${key}YoY`], ref: q?.yoyRef, what: 'Mismo mes del año anterior' }
  ].filter(r => r.c && r.ref).flatMap(({ c, ref, what }) => {
    const name = monthLabelOf(ref.year, ref.month)
    return [
      { label: `${what}: ${name}`, value: c.base, info: true },
      {
        label: `Variación contra ${name}`,
        text: c.pct == null ? `${signedMoney(c.diff)} (base cero o negativa: va en pesos)` : `${signedMoney(c.diff)} · ${deltaView(c).text}`,
        info: true
      }
    ]
  })
}

const financeDocs = {
  finIncome: ({ finance, monthLabel = 'el mes' }) => {
    const q = finance?.q || {}
    return {
      title: 'A ingresar al banco',
      unit: ['sin IVA', 'a ingresar al banco', 'mes seleccionado'],
      what: 'Lo que el mes tiene que cobrar, sin IVA: lo que ya entró más lo que falta. Es el Previsto de Cobranza de Gestión CFP, fila por fila, sin el IVA de cada línea: una cuota ya cobrada cuenta por lo que se cobró y una pendiente, por lo que debe. El paquete de una promo prepaga entra entero en su primer mes y los meses que cubre aportan $ 0, porque así se cobra.',
      rows: [
        { label: 'Ya entró (cuotas y paquetes del mes cobrados)', value: q.collected },
        { label: 'Falta cobrar', value: q.pending, op: '+' },
        { label: `Del total, adelanto de ${plural(q.packages ?? 0, 'paquete', 'paquetes')} de promo`, value: q.packageAdvance, info: true },
        { label: `Servicio de ${plural(q.coveredMonths ?? 0, 'mes cubierto', 'meses cubiertos')} por un paquete ya cobrado (aporta $ 0)`, value: q.covered, info: true },
        ...(q.awaitingMonths ? [{ label: `Servicio de ${plural(q.awaitingMonths, 'mes que espera', 'meses que esperan')} el cobro de su paquete (aporta $ 0: va en el primer mes de la promo)`, value: q.awaiting, info: true }] : []),
        ...(q.paidOff ? [{ label: `${plural(q.paidOff, 'cuota cobrada', 'cuotas cobradas')} por otro monto: lo que entró menos lo que hoy se le calcula`, value: q.paidDiff, info: true }] : []),
        ...deltaRows(q, 'income')
      ],
      total: { label: 'A ingresar al banco (sin IVA)', value: q.income },
      source: `Una fila por cliente del padrón de ${monthLabel}: el mismo de Gestión CFP, que incluye a quien se dio de baja en el mes mientras tenga algo que pagar. Cada fila cobrada aporta lo que entró; una sin cobrar, lo que hay que cobrarle: la cuota del mes (las altas, los reingresos y las bajas del mes, proporcional a sus días cobrables), el paquete entero si es el primer mes de una promo, o $ 0 si es un mes que cubre un paquete. ${BASE_RULE} "Ya entró" es lo cobrado de las filas de este mes, con la fecha de pago que tenga: un pago adelantado a fin del mes anterior cuenta acá. ${DELTA_RULE}`,
      caveat: `No es caja: es lo que tiene que entrar. Un mes con paquetes de promo se ve mejor de lo que fue y los meses que esos paquetes cubren se ven peor, sin que el negocio cambie: por eso la marca al lado del número.${finance?.open ? ' Es el mes en curso: lo que falta cobrar todavía es una expectativa.' : ''}`
    }
  },

  finExpenses: ({ finance, monthLabel = 'el mes' }) => {
    const q = finance?.q || {}
    const p = q.personal || {}
    const o = q.operating || {}
    const c = q.row?.costs || {}
    return {
      title: 'Total gastos',
      unit: ['con IVA', 'fijos mensualizados', 'mes seleccionado'],
      what: 'Todo lo que cuesta operar el centro en el mes: el personal y el resto de los gastos. El porcentaje dice qué parte de lo que tiene que entrar se va en operar.',
      rows: [
        { label: 'Sueldos (costo para la empresa)', value: p.salaries },
        { label: `Prestadores de servicios${c.providerCount ? ` (${c.providerCount})` : ''}`, value: p.providers, op: '+' },
        { label: 'Extras del personal', value: p.extras, op: '+' },
        { label: `Aporte jubilatorio de directores${c.directorBpsEstimated ? ' (calculado)' : ''}`, value: p.director, op: '+' },
        { label: 'Gastos fijos (mensualizados)', value: o.fixed, op: '+' },
        { label: 'Gastos variables', value: o.variable, op: '+' },
        { label: 'Gastos extraordinarios', value: o.extraordinary, op: '+' },
        { label: 'Sobre lo que tiene que entrar al banco', text: pctText(q.expensesPct, 0), info: true },
        ...(c.fixedShadowedCount ? [{
          label: `${plural(c.fixedShadowedCount, 'plantilla fija que no cuenta', 'plantillas fijas que no cuentan')} este mes: el gasto ya estaba cargado como variable`,
          value: c.fixedShadowedMonthly,
          info: true
        }] : []),
        ...deltaRows(q, 'expenses')
      ],
      total: { label: 'Total gastos', value: q.expenses },
      source: `Los sueldos salen de Sueldos: el costo mensual para la empresa de cada empleada según su líquido vigente en ${monthLabel} (aportes patronales, aguinaldo y salario vacacional repartidos por mes). Los prestadores, del monto mensual de su ficha. Los extras del personal son los extraordinarios de Sueldos (de una empleada o sueltos), en su mes. Los gastos salen de Costos: los fijos de sus plantillas repartidos en su periodicidad (un pago anual pesa un doceavo por mes); los variables y los extraordinarios, los cargados en el mes. Una plantilla cargada con un inicio anterior a su carga no cuenta en un mes que ya tenía ese gasto como variable (cargado antes que la plantilla, con la misma descripción o el mismo proveedor): cuenta la fila variable, que es lo que se pagó, y el gasto no entra dos veces. ${DELTA_RULE} Acá subir es en contra: un aumento va en rojo.`,
      caveat: `${c.providersMissing ? `${missingProviders(monthLabel)} ` : ''}${PROVIDERS_RULE}${c.directorBpsEstimated ? ' El aporte de directores de este mes todavía no tiene su fila (Costos la crea cuando alguien lo abre): se calcula igual que la crearía, sin guardarla.' : ''} ${EXPENSES_IVA} La vista Pesos del gráfico pone los fijos en su mes de pago, así que su resultado no es el de estas tarjetas.`
    }
  },

  finResult: ({ finance, monthLabel = 'el mes' }) => {
    const q = finance?.q || {}
    return {
      title: 'Resultado del mes',
      unit: ['sin IVA', 'con los impuestos cargados en Costos', 'mes seleccionado'],
      what: 'Lo que queda de lo que tiene que entrar al banco después de todos los gastos del mes.',
      rows: [
        { label: 'A ingresar al banco (sin IVA)', value: q.income },
        { label: 'Total gastos', value: neg(q.expenses), op: '−' },
        { label: 'Margen: resultado ÷ lo que tiene que entrar', text: pctText(q.resultPct, 1), info: true },
        ...deltaRows(q, 'result')
      ],
      total: { label: 'Resultado del mes', value: q.result },
      source: `La resta de las dos tarjetas de al lado. Es la misma cuenta que el margen neto de la vista Márgenes, en pesos. ${DELTA_RULE}`,
      caveat: `${TAXES_RULE} No es la ganancia final: no descuenta el saldo de IRAE que no cubran los adelantos, y una compra de activo pesa entera en su mes, sin amortizar. Las dos puntas no miden lo mismo: el ingreso es lo que tiene que entrar en el mes (con los paquetes de promo enteros en su primer mes) y el gasto es el del mes. ${EXPENSES_IVA}${q.row?.costs?.providersMissing ? ` ${missingProviders(monthLabel)}` : ''}${finance?.open ? ' Es el mes en curso: los gastos variables y extraordinarios se siguen cargando, así que el resultado va a bajar a medida que se carguen.' : ''}`
    }
  },

  finAverage: ({ finance }) => {
    const a = finance?.q?.average || {}
    const months = a.months ?? 0
    return {
      title: `Margen promedio ${months} meses`,
      unit: ['sin IVA', `ventana de ${plural(months, 'mes', 'meses')}`],
      what: `El margen sin el ruido del mes suelto: cuánto quedó, en promedio, en la ventana de hasta 12 meses que termina en el mes elegido. La serie arranca en junio de 2026, así que hoy la ventana tiene ${plural(months, 'mes', 'meses')}, no doce.`,
      rows: [
        { label: `Resultado acumulado (${plural(months, 'mes', 'meses')})`, value: a.sumResult },
        { label: 'Meses con ingresos', text: String(a.operatingMonths ?? DASH), op: '÷' },
        { label: 'Resultado promedio por mes', value: a.resultPerMonth, op: '=' },
        { label: 'Lo que tuvo que entrar en la ventana', value: a.sumIncome, info: true },
        { label: 'Margen: resultado acumulado ÷ lo que tuvo que entrar', text: pctText(a.pct, 1), info: true },
        { label: 'Este mes contra el promedio', text: pp(a.monthVsAveragePp), info: true },
        { label: 'Contra la ventana anterior del mismo largo', text: pp(a.vsPrevWindowPp), info: true },
        ...(a.incompleteMonths?.length ? [{ label: 'Meses de la ventana sin pagos a prestadores cargados', text: monthNames(a.incompleteMonths), info: true }] : [])
      ],
      total: { label: 'Margen promedio', text: `${money(a.resultPerMonth)} por mes · ${pctText(a.pct, 0)}`, check: false },
      source: 'El importe es el resultado de toda la ventana dividido por los meses que tuvieron ingresos. El porcentaje suma lo que tuvo que entrar y los resultados de la ventana y recién ahí divide: promediar los porcentajes de cada mes le daría a un mes flojo el peso de uno lleno. Las dos puntas, como en el Resultado del mes.',
      caveat: `Las dos variaciones miden cosas distintas: la primera, si este mes estuvo por encima o por debajo de lo normal; la segunda, si el negocio mejoró de fondo, y aparece recién cuando haya dos ventanas completas para comparar. ${a.negativeMonths > 0 ? `${plural(a.negativeMonths, 'mes de la ventana cerró', 'meses de la ventana cerraron')} en rojo y el promedio lo esconde.` : 'Ningún mes de la ventana cerró en rojo.'}${a.incompleteMonths?.length ? ` La ventana incluye ${monthNames(a.incompleteMonths)}, sin ningún pago a prestadores cargado: su gasto está incompleto, su resultado sale inflado y sube el promedio.` : ''} Si la ventana incluye el mes en curso, todavía le faltan gastos por cargar.`
    }
  },

  finChartMoney: ({ chart, monthLabel = 'el mes' }) => {
    const m = chart?.money || {}
    return {
      title: 'Resultado con fijos en caja',
      unit: ['sin IVA', 'gastos fijos en su mes de pago', 'mes seleccionado'],
      what: 'El resultado del mes elegido con los gastos fijos en el mes en que se pagan, en vez de repartidos. Las barras verdes son lo que tiene que entrar al banco cada mes, partido en asistencia y transporte; las grises, el personal y el resto de los gastos; la línea, este resultado mes a mes, que baja del cero cuando el mes da pérdida.',
      rows: [
        { label: 'A ingresar al banco (sin IVA)', value: m.income },
        { label: 'Personal (sueldos, prestadores, extras y aporte de directores)', value: neg(m.personal), op: '−' },
        { label: 'Gastos fijos pagados en el mes', value: neg(m.fixed), op: '−' },
        { label: 'Gastos variables', value: neg(m.variable), op: '−' },
        { label: 'Gastos extraordinarios', value: neg(m.extraordinary), op: '−' }
      ],
      total: { label: `Resultado de ${m.name || monthLabel}, fijos en caja`, value: m.result },
      source: `Los mismos ingresos y gastos que las tarjetas de abajo, con una sola diferencia: los fijos de ${m.name || monthLabel} van por lo que se paga ese mes según el calendario de cada plantilla. ${BASE_RULE} El selector de período no cambia la cuenta: elige qué meses se ven (6, 12 o 24 seguidos, o el cruce de años por meses).`,
      caveat: `No es el Resultado del mes de abajo (${money(m.resultMonthly)}): allá los fijos van mensualizados (${money(m.fixedMonthly)} este mes) y acá por lo que se pagó (${money(m.fixed)}). Un mes en que cae un pago anual se ve peor acá sin que el negocio haya cambiado.${m.prevName ? ` La comparación es contra ${m.prevName} (${money(m.prev?.result)}).` : ''}`
    }
  },

  finChartTrend: ({ chart, monthLabel = 'el mes' }) => {
    const t = chart?.trend || {}
    return {
      title: 'A ingresar al banco contra costo total',
      unit: ['sin IVA', 'fijos mensualizados', 'último mes del período'],
      what: 'Las dos líneas que mandan: lo que tiene que entrar cada mes y lo que cuesta operar. El área entre las dos es el resultado: verde cuando queda plata, rosa cuando el costo supera al ingreso.',
      rows: [
        { label: 'A ingresar al banco (sin IVA)', value: t.income },
        { label: 'Costo total (personal y gastos)', value: neg(t.costs), op: '−' },
        { label: 'Margen neto', text: pctText(t.netPct, 1), info: true },
        ...(t.comp ? [{ label: `Resultado de ${t.comp.name}`, value: t.comp.result, info: true }] : [])
      ],
      total: { label: `Resultado de ${t.name || monthLabel}`, value: t.result },
      source: 'El costo es el Total gastos de las tarjetas de abajo, mes por mes, así que el área es, peso por peso, el Resultado del mes. Las cifras de arriba son las del último mes del período. Con el filtro de Meses en uno solo, cada punto se compara contra el mismo mes del año anterior y no contra el de al lado: en un negocio estacional, comparar contra el mes anterior hace pasar la estación por gestión.',
      caveat: `La comparación entre años necesita historia: la serie arranca en junio de 2026, así que recién desde junio de 2027 hay un mes contra qué comparar. Si el período termina en el mes en curso, ese mes todavía no cerró y exagera la diferencia. ${EXPENSES_IVA}`
    }
  },

  finChartMargins: ({ chart, monthLabel = 'el mes' }) => {
    const m = chart?.margins || {}
    const label = (name, pct) => `${name} (${pctText(pct, 0)})`
    return {
      title: 'Evolución de márgenes',
      unit: ['% sobre lo que tiene que entrar', 'sin IVA', 'último mes del período'],
      what: 'El mismo ingreso con una capa más de costo en cada línea: si el servicio deja margen (bruto), si lo deja después de sostener la estructura fija (operativo) y cuánto queda al final (neto).',
      rows: [
        { label: 'A ingresar al banco (sin IVA)', value: m.income },
        { label: 'Sueldos (costo para la empresa)', value: neg(m.salaries), op: '−' },
        { label: 'Prestadores de servicios', value: neg(m.providers), op: '−' },
        { label: label('Margen bruto', m.grossPct), value: m.gross, op: '=' },
        { label: 'Gastos fijos (mensualizados)', value: neg(m.fixed), op: '−' },
        { label: label('Margen operativo', m.operatingPct), value: m.operating, op: '=' },
        { label: 'Gastos variables', value: neg(m.variable), op: '−' },
        { label: 'Gastos extraordinarios', value: neg(m.extraordinary), op: '−' },
        { label: 'Extras del personal', value: neg(m.extras), op: '−' },
        { label: 'Aporte jubilatorio de directores', value: neg(m.director), op: '−' },
        { label: label('Margen neto', m.netPct), value: m.net, op: '=' },
        { label: 'Meta de margen neto', text: typeof m.target === 'number' ? `${m.target}%` : 'sin definir', info: true }
      ],
      total: { label: `Margen neto de ${m.name || monthLabel}`, text: pctText(m.netPct, 1) },
      source: 'Cada capa sale de Sueldos y Costos: sueldos a costo empresa y prestadores en la primera; los gastos fijos mensualizados en la segunda; los variables, los extraordinarios, los extras del personal y el aporte jubilatorio de directores en la tercera. Las tres capas suman el Total gastos y el margen neto es el Resultado del mes dividido lo que tiene que entrar: la misma cuenta.',
      caveat: `Hay piezas aproximadas: los prestadores cuentan desde el mes en que se cargaron, con su monto de hoy, y antes de septiembre de 2026 son los pagos cargados como extraordinarios sueltos${m.providersMissing ? ` (${m.name || monthLabel} no tiene ninguno cargado, así que su margen sale inflado)` : ''}${m.directorEstimated ? '; el aporte de directores de este mes se calcula sin fila guardada' : ''}. Los gastos variables incluyen compras de activo (Inversiones y mejoras del centro), que pesan enteras en su mes: una obra o una compra grande hunde el neto de ese mes sin que la operación cambie. La tercera capa junta cosas distintas (esas compras, los extraordinarios de una vez y el aporte de directores, que es costo de los dueños): cuando el neto se despega del operativo, conviene ver cuál se movió. ${TAXES_RULE}`
    }
  },

  finTarget: ({ chart }) => {
    const t = chart?.target || {}
    const s = t.suggestion
    return {
      title: 'Meta de margen neto',
      unit: ['% sobre lo que tiene que entrar', 'configuración del centro'],
      what: 'El margen neto que el centro se pone como objetivo. La define el centro y no el tablero: arranca sin definir y, mientras no se defina, el gráfico no dibuja ninguna línea de meta.',
      rows: [
        { label: 'Meta guardada', text: typeof t.value === 'number' ? `${t.value}%` : 'sin definir' },
        ...(s ? [
          { label: `Resultado de ${s.fromName === s.toName ? s.toName : `${s.fromName} a ${s.toName}`}`, value: s.result, info: true },
          { label: 'Lo que tuvo que entrar en esos meses', value: s.income, info: true },
          { label: `Margen neto de ${plural(s.months, 'mes cerrado', 'meses cerrados')} (la sugerencia)`, text: pctText(s.exactPct, 1), info: true },
          ...(s.skipped?.length ? [{ label: 'Afuera de la sugerencia, sin pagos a prestadores cargados', text: monthNames(s.skipped), info: true }] : [])
        ] : [])
      ],
      source: 'Se guarda en la configuración de la plataforma (app_settings), solo cuando se aprieta Guardar; "Sin meta" la deja otra vez sin definir. Mientras el panel está abierto, el gráfico muestra el valor que se está probando. La sugerencia es el margen neto de hasta 12 meses cerrados, sin el mes en curso ni los meses con el gasto incompleto (sin ningún pago a prestadores cargado, como junio de 2026): acumula lo que tuvo que entrar y los resultados, y recién ahí divide.',
      caveat: `El margen del tablero ya descuenta los impuestos cargados en Costos (el adelanto de IRAE incluido); no descuenta los retiros ni el saldo de IRAE que no cubran los adelantos: una meta realista tiene que dejarles lugar. Es un valor global: cambiarla la cambia para todos los que miran el tablero.${t.persisted === false ? ' No se pudo leer la meta guardada: los cambios de esta sesión solo se prueban en el gráfico, no se guardan.' : ''}`
    }
  },

  finPeriods: ({ chart }) => {
    const f = chart?.periods?.first || {}
    return {
      title: 'Comparación de períodos',
      unit: ['sin IVA', 'fijos mensualizados', 'período del filtro'],
      what: 'Cada mes del filtro con sus números, el más reciente arriba, y su resultado contra el mismo mes del año anterior.',
      rows: [
        { label: 'A ingresar al banco (sin IVA)', value: f.income },
        { label: 'Costo total (personal y gastos)', value: neg(f.costs), op: '−' },
        { label: 'Margen neto', text: pctText(f.netPct, 1), info: true }
      ],
      total: { label: `Resultado de ${f.name || 'el mes más reciente'}`, value: f.result },
      source: 'Los mismos números que la vista Tendencia, mes por mes. La variación es contra el mismo mes del año anterior que esté en el filtro: en porcentaje si ese resultado fue positivo y, si fue cero o negativo, la diferencia en pesos (el porcentaje sobre una base negativa engaña).',
      caveat: 'La serie arranca en junio de 2026: hasta junio de 2027 ningún mes tiene contra qué compararse y la columna queda vacía.'
    }
  }
}

export default financeDocs
