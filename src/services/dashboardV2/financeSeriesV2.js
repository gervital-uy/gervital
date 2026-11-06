import {
  salaryCostForMonth, employeeExtraForMonth, standaloneExtraForMonth, contingencyForMonth
} from '../dashboard/financeSeries'
import { fixedCashForMonth, fixedMonthlyForMonth, hitsMonth, isActive, monthlyAmount } from '../expenses/fixedExpenseCalc'
import { DIRECTOR_SYSTEM_KEY, monthKey, pendingContributions } from '../salaries/directorContribution'
import { promoMonthCollection } from '../promotions/promotionsView'
import { parseDateOnly } from '../../utils/date'
import { PLATFORM_START_ISO } from './platform'
import { VAT, monthBounds, netOfGross } from './padron'

// Serie financiera de la pestaña Finanzas: una fila por mes, desde que arrancó la
// plataforma hasta el mes en curso. Lógica pura; las lecturas están en
// financeQueries.js. month es 0-indexed.
//
// Ingresos. Salen del panel del mes (get_month_collection_panel: la población del
// padrón de Gestión CFP, que incluye a quien después se dio de baja) y de los cobros
// registrados con fecha en el mes. Tres bases, cada una por línea y con o sin IVA
// (asistencia al 22%, transporte al 10%, nunca una sola tasa):
//   · bank     A ingresar al banco, la cifra principal: lo que el mes tiene que
//              cobrar, con el paquete de una promo entero en su mes ancla y $0 en
//              los meses que cubre (promoMonthCollection, igual que Cobranza).
//   · accrued  Previsto devengado: el servicio del mes, cobrado o no.
//   · cash     Caja real: lo cobrado por fecha de pago, sea del mes que sea.
//
// Gastos. Con los selectores de legacy (financeSeries.js) más los prestadores, el
// aporte de directores y el desglose del personal.

const num = v => (v == null || v === '' ? 0 : Number(v) || 0)
const ord = (year, month) => year * 12 + month
const sum = (list, f) => (list || []).reduce((s, x) => s + f(x), 0)
const monthOf = iso => String(iso || '').slice(0, 7)

// ── Líneas ────────────────────────────────────────────────────────────────────
// Un importe partido en asistencia y transporte, con y sin IVA:
// { attGross, transGross, attNet, transNet }.

const emptyLines = () => ({ attGross: 0, transGross: 0, attNet: 0, transNet: 0 })

function addLines(acc, parts) {
  acc.attGross += parts.attGross
  acc.transGross += parts.transGross
  acc.attNet += parts.attNet
  acc.transNet += parts.transNet
  return acc
}

const subLines = (a, b) => ({
  attGross: a.attGross - b.attGross,
  transGross: a.transGross - b.transGross,
  attNet: a.attNet - b.attNet,
  transNet: a.transNet - b.transNet
})

// Reparte un importe con IVA entre asistencia y transporte en la proporción de las
// líneas del mes, y netea cada parte con su tasa (redondeada por fila, como emite
// biller). Sin líneas, todo es asistencia. Si el importe es el del mes, la partición
// es exacta: asistencia y transporte tal cual.
export function splitByLines(amount, attGross, transGross) {
  const value = num(amount)
  const att = num(attGross)
  const total = att + num(transGross)
  const attPart = total > 0 ? Math.round((value * att) / total) : value
  const transPart = value - attPart
  return {
    attGross: attPart,
    transGross: transPart,
    attNet: netOfGross(attPart, VAT.attendance),
    transNet: netOfGross(transPart, VAT.transport)
  }
}

export const linesTotal = (lines, withIva = false) => (lines
  ? (withIva ? lines.attGross + lines.transGross : lines.attNet + lines.transNet)
  : 0)

// ── Ventana ───────────────────────────────────────────────────────────────────

// Los meses de la serie: desde el lanzamiento hasta el mes de `todayIso`, inclusive.
export function financeMonths(todayIso) {
  const start = parseDateOnly(PLATFORM_START_ISO)
  const today = parseDateOnly(todayIso)
  if (!today) return []
  const out = []
  for (let i = ord(start.getFullYear(), start.getMonth()), last = ord(today.getFullYear(), today.getMonth()); i <= last; i++) {
    out.push({ year: Math.floor(i / 12), month: i % 12 })
  }
  return out
}

// ── Ingresos ──────────────────────────────────────────────────────────────────

// Ingresos del mes a partir de las filas del panel. Las piezas cierran exacto, línea
// por línea y con y sin IVA:
//   bank = accrued + packageAdvance − covered
//     packageAdvance: lo que el paquete de un mes ancla trae de los meses que cubre
//     covered: el servicio de los meses 2..N de una promo, que al banco aportan $0
//   bank = collected + pending + gap
//     collected: lo cobrado de las filas del mes (paid_amount), sea cual sea la fecha
//     pending: lo que deben las filas sin cobrar
//     gap: lo que debía un mes cobrado por otro monto (debido − cobrado: positivo
//     si entró menos de lo previsto)
export function panelIncome(panel) {
  const accrued = emptyLines()
  const bank = emptyLines()
  const collected = emptyLines()
  const pending = emptyLines()
  const packageAdvance = emptyLines()
  const covered = emptyLines()
  const counts = {
    rows: 0, clients: 0, attendanceClients: 0, transportClients: 0,
    paid: 0, pending: 0, packages: 0, packagesCollected: 0, covered: 0
  }

  for (const p of panel || []) {
    const att = num(p.attendance_gross)
    const trans = num(p.transport_gross)
    const amount = att + trans
    const promoIndex = p.promo_index == null ? null : Number(p.promo_index)
    const status = p.payment_status || 'pending'
    const due = promoMonthCollection({ promoIndex, promoTotalAmount: p.promo_total_amount, monthAmount: amount }).due
    const service = splitByLines(amount, att, trans)
    const owed = splitByLines(due, att, trans)

    counts.rows++
    if (amount > 0) counts.clients++
    if (att > 0) counts.attendanceClients++
    if (trans > 0) counts.transportClients++

    addLines(accrued, service)
    addLines(bank, owed)
    if (status === 'paid') {
      counts.paid++
      addLines(collected, splitByLines(p.paid_amount, att, trans))
    } else if (status === 'pending') {
      if (due > 0) counts.pending++
      addLines(pending, owed)
    }
    if (promoIndex === 1) {
      counts.packages++
      if (status === 'paid') counts.packagesCollected++
      addLines(packageAdvance, subLines(owed, service))
    } else if (promoIndex != null) {
      counts.covered++
      addLines(covered, service)
    }
  }

  const gap = subLines(subLines(bank, collected), pending)
  return { accrued, bank, collected, pending, gap, packageAdvance, covered, counts }
}

// Caja real del mes: cada cobro (paid_amount) con fecha de pago en el mes, partido
// por línea con lo que se guardó al cobrar. Un mes prepago no suma: su plata entró
// entera con el ancla, en la fecha de pago del paquete. otherMonths es la parte que
// paga un servicio de otro mes (adelantos y atrasos).
export function cashIncome(payments, year, month) {
  const { first, last } = monthBounds(year, month)
  const cash = emptyLines()
  const otherMonths = emptyLines()
  const counts = { payments: 0, paymentsOtherMonths: 0, paymentsPackages: 0 }

  for (const r of payments || []) {
    if (r.payment_status && r.payment_status !== 'paid') continue
    const day = String(r.paid_date || '').slice(0, 10)
    if (!day || day < first || day > last) continue
    const parts = splitByLines(r.paid_amount, r.attendance_chargeable_gross, r.transport_chargeable_gross)
    addLines(cash, parts)
    counts.payments++
    if (r.promo_id) counts.paymentsPackages++
    if (ord(Number(r.year), Number(r.month)) !== ord(year, month)) {
      addLines(otherMonths, parts)
      counts.paymentsOtherMonths++
    }
  }
  return { cash, otherMonths, counts }
}

// ── Gastos ────────────────────────────────────────────────────────────────────

// Desde cuándo existe la tabla de prestadores (migración 078, septiembre de 2026).
// Antes, sus pagos se cargaban como extraordinarios sin empleado: jul y ago de 2026
// tienen 114.500 por mes así.
export const PROVIDERS_TABLE_SINCE = '2026-09'

const monthOrdOfInstant = iso => {
  const d = parseDateOnly(iso)
  return d ? ord(d.getFullYear(), d.getMonth()) : null
}

// La tabla de prestadores no guarda vigencia (B6, sin cambiar la base). Un
// prestador cuenta desde el mes en que se cargó (created_at), con su monto de hoy.
// Uno dado de baja deja de contar desde el mes de su última edición (updated_at),
// que es la baja si nadie lo tocó después. En meses pasados es una aproximación.
export function providerActiveIn(provider, year, month) {
  const t = ord(year, month)
  const from = monthOrdOfInstant(provider?.createdAt)
  if (from == null || t < from) return false
  if (provider.active !== false) return true
  const to = monthOrdOfInstant(provider.updatedAt)
  return to != null && t < to
}

export const providersForMonth = (providers, year, month) => (providers || []).filter(p => providerActiveIn(p, year, month))

export const isDriver = provider => /chofer/i.test(provider?.role || '')

// Los extraordinarios sin empleado, en tres baldes que no se pisan:
//   · director: el aporte jubilatorio de directores (filas del sistema);
//   · legacyProviders: pagos a prestadores cargados como extra antes de que
//     existiera su tabla. Cuentan como prestadores, y la tabla recién cuenta desde
//     que existe (created_at): así esos 114.500 por mes de jul y ago no se cuentan
//     dos veces, sin tocar la base;
//   · staff: el resto (feriados, paseos): extras del personal.
export function partitionExtras(extraCosts) {
  const director = []
  const legacyProviders = []
  const staff = []
  for (const x of extraCosts || []) {
    if (x.employeeId) continue // los de una empleada vienen con la empleada
    if (x.systemKey === DIRECTOR_SYSTEM_KEY) director.push(x)
    else if (!x.systemKey && monthOf(x.date) < PROVIDERS_TABLE_SINCE) legacyProviders.push(x)
    else staff.push(x)
  }
  return { director, legacyProviders, staff }
}

// Aporte jubilatorio de directores del mes. La fila se crea recién al abrir Costos
// (self-heal), así que un mes sin fila se calcula igual que la crearía Costos, sin
// guardarla (B14). Antes del mes ancla (director_contribution_start) no hay aporte.
export function directorContributionForMonth({ rows, employees, startKey }, year, month) {
  const key = monthKey(year, month)
  const saved = (rows || []).filter(r => monthOf(r.date) === key)
  if (saved.length) return { amount: sum(saved, r => num(r.amount)), estimated: false }
  if (!startKey || key < startKey) return { amount: 0, estimated: false }
  const [row] = pendingContributions({ startKey: key, currentKey: key, existing: [], employees })
  return { amount: row ? row.amount : 0, estimated: !!row }
}

// Gastos de un mes. costs: lo global (empleadas, extras sueltos, prestadores,
// plantillas fijas, ancla del aporte de directores); sources: lo del mes (gastos
// variables y extraordinarios del mes).
export function monthCosts(costs, { year, month, variableRows, extraordinaryRows }) {
  const { employees = [], extraCosts = [], providers = [], fixedTemplates = [], directorStart = null } = costs || {}
  const extras = partitionExtras(extraCosts)
  const active = providersForMonth(providers, year, month)
  const drivers = active.filter(isDriver)
  const director = directorContributionForMonth({ rows: extras.director, employees, startKey: directorStart }, year, month)
  return {
    salaries: salaryCostForMonth(employees, year, month),
    employeeExtras: employeeExtraForMonth(employees, year, month),
    staffExtras: standaloneExtraForMonth(extras.staff, year, month),
    providersTable: sum(active, p => num(p.monthlyAmount)),
    providersLegacy: standaloneExtraForMonth(extras.legacyProviders, year, month),
    providerCount: active.length,
    drivers: sum(drivers, p => num(p.monthlyAmount)),
    driverCount: drivers.length,
    directorBps: director.amount,
    directorBpsEstimated: director.estimated,
    fixedMonthly: fixedMonthlyForMonth(fixedTemplates, year, month),
    fixedCash: fixedCashForMonth(fixedTemplates, year, month),
    variable: sum((variableRows || []).filter(r => Number(r.year) === year && Number(r.month) === month), r => num(r.amount)),
    contingency: contingencyForMonth(extraordinaryRows, year, month)
  }
}

// ── Serie ─────────────────────────────────────────────────────────────────────

// sources: { year, month, panel, payments, variableRows, extraordinaryRows }
export function buildFinanceMonth(sources, costs) {
  const { year, month } = sources
  const income = panelIncome(sources.panel)
  const cash = cashIncome(sources.payments, year, month)
  return {
    year,
    month,
    income: {
      bank: income.bank,
      accrued: income.accrued,
      cash: cash.cash,
      collected: income.collected,
      pending: income.pending,
      gap: income.gap,
      packageAdvance: income.packageAdvance,
      covered: income.covered,
      cashOtherMonths: cash.otherMonths
    },
    counts: { ...income.counts, ...cash.counts },
    costs: monthCosts(costs, sources)
  }
}

export function buildFinanceSeries(monthSources, costs) {
  return [...(monthSources || [])]
    .sort((a, b) => ord(a.year, a.month) - ord(b.year, b.month))
    .map(s => buildFinanceMonth(s, costs))
}

export const findMonthIndex = (series, year, month) => (series || []).findIndex(r => r.year === year && r.month === month)

// ── Selectores ────────────────────────────────────────────────────────────────

export const INCOME_BASES = ['bank', 'accrued', 'cash']

// Ingreso de una fila: base, IVA y, opcionalmente, una sola línea.
export function incomeOf(row, { basis = 'bank', withIva = false, line = null } = {}) {
  const lines = row?.income?.[basis]
  if (!lines) return 0
  if (line === 'attendance') return withIva ? lines.attGross : lines.attNet
  if (line === 'transport') return withIva ? lines.transGross : lines.transNet
  return linesTotal(lines, withIva)
}

// Personal: sueldos (costo empresa), prestadores (tabla + los cargados como extra),
// extras del personal (de una empleada o sueltos) y el aporte de directores.
export function personalOf(row) {
  const c = row?.costs || {}
  const salaries = num(c.salaries)
  const providers = num(c.providersTable) + num(c.providersLegacy)
  const extras = num(c.employeeExtras) + num(c.staffExtras)
  const director = num(c.directorBps)
  return { salaries, providers, extras, director, total: salaries + providers + extras + director }
}

// Gastos de funcionamiento. Los fijos, mensualizados (por defecto) o en caja.
export function operatingOf(row, { fixedBasis = 'monthly' } = {}) {
  const c = row?.costs || {}
  const fixed = fixedBasis === 'cash' ? num(c.fixedCash) : num(c.fixedMonthly)
  const variable = num(c.variable)
  const extraordinary = num(c.contingency)
  return { fixed, variable, extraordinary, total: fixed + variable + extraordinary }
}

export const expensesOf = (row, opts = {}) => personalOf(row).total + operatingOf(row, opts).total

export const resultOf = (row, opts = {}) => incomeOf(row, opts) - expensesOf(row, opts)

// Variación contra una referencia. Con una base cero o negativa el porcentaje no
// significa nada (de −9.400 a +111.800 daría −1289%): queda solo la diferencia.
export function change(current, before) {
  if (before == null || current == null) return null
  const diff = current - before
  return { base: before, diff, pct: before > 0 ? (diff / before) * 100 : null }
}

// ── Cascada de márgenes ───────────────────────────────────────────────────────
// Tres márgenes sobre el mismo ingreso sin IVA (A ingresar al banco por defecto),
// cada uno con una capa más de costo, todas baldes reales de Costos:
//   bruto     = ingresos − sueldos − prestadores (quienes prestan el servicio)
//   operativo = bruto − gastos fijos (mensualizados)
//   neto      = operativo − variables − extraordinarios − extras del personal
//               − aporte jubilatorio de directores
export function marginKpisV2(row, { basis = 'bank' } = {}) {
  if (!row) return null
  const income = incomeOf(row, { basis })
  if (!(income > 0)) return null
  const p = personalOf(row)
  const o = operatingOf(row)
  const direct = p.salaries + p.providers
  const structure = o.fixed
  const belowLine = o.variable + o.extraordinary + p.extras + p.director
  const gross = income - direct
  const operating = gross - structure
  const net = operating - belowLine
  const pct = v => (v / income) * 100
  return {
    year: row.year,
    month: row.month,
    income,
    direct,
    structure,
    belowLine,
    salaries: p.salaries,
    providers: p.providers,
    fixed: o.fixed,
    variable: o.variable,
    extraordinary: o.extraordinary,
    extras: p.extras,
    director: p.director,
    gross,
    operating,
    net,
    grossPct: pct(gross),
    operatingPct: pct(operating),
    netPct: pct(net)
  }
}

// ── Cuadrantes del mes ────────────────────────────────────────────────────────

export const AVERAGE_WINDOW = 12

// El mes elegido como estado de resultados: ingresos, gastos (personal y
// funcionamiento), resultado, variaciones y margen promedio. opts: basis (bank),
// withIva, fixedBasis (monthly).
export function financeQuadrantsV2(series, year, month, opts = {}) {
  const idx = findMonthIndex(series, year, month)
  if (idx < 0) return null
  const { basis = 'bank', withIva = false, fixedBasis = 'monthly' } = opts
  const row = series[idx]
  const prev = idx > 0 ? series[idx - 1] : null
  const yoy = idx >= 12 ? series[idx - 12] : null

  const income = r => incomeOf(r, { basis, withIva })
  const expenses = r => expensesOf(r, { fixedBasis })
  const result = r => income(r) - expenses(r)

  const inc = income(row)
  const exp = expenses(row)
  const res = inc - exp
  const personal = personalOf(row)
  const operating = operatingOf(row, { fixedBasis })
  const share = (part, whole) => (whole > 0 ? (part / whole) * 100 : null)

  // Margen promedio: ingresos y resultados de la ventana se suman y recién ahí se
  // dividen (promediar porcentajes le daría a un mes flojo el peso de uno lleno).
  // La ventana arranca en el lanzamiento: hasta tener 12 meses, son los que hay.
  const window = series.slice(Math.max(0, idx - (AVERAGE_WINDOW - 1)), idx + 1)
  const sumIncome = sum(window, income)
  const sumResult = sum(window, result)
  const operatingMonths = window.filter(r => income(r) > 0).length
  const averagePct = sumIncome > 0 ? (sumResult / sumIncome) * 100 : null
  // La ventana anterior del mismo largo, solo cuando existe entera.
  const prevWindow = idx + 1 >= 2 * window.length
    ? series.slice(idx + 1 - 2 * window.length, idx + 1 - window.length)
    : []
  const prevIncome = sum(prevWindow, income)
  const prevAveragePct = prevIncome > 0 ? (sum(prevWindow, result) / prevIncome) * 100 : null
  const resultPct = share(res, inc)

  const lines = key => linesTotal(row.income[key], withIva)

  return {
    row,
    prev: prev ? { year: prev.year, month: prev.month } : null,
    yoyRef: yoy ? { year: yoy.year, month: yoy.month } : null,
    income: inc,
    expenses: exp,
    result: res,
    resultPct,
    expensesPct: share(exp, inc),
    personal,
    operating,
    personalOfIncomePct: share(personal.total, inc),
    personalOfExpensesPct: share(personal.total, exp),
    operatingOfIncomePct: share(operating.total, inc),
    operatingOfExpensesPct: share(operating.total, exp),
    // Lo que ya entró y lo que falta del banco del mes, por el estado de cada fila
    // (no por la caja del mes: en junio entró plata de junio con fecha de mayo).
    collected: lines('collected'),
    pending: lines('pending'),
    gap: lines('gap'),
    packageAdvance: lines('packageAdvance'),
    covered: lines('covered'),
    packages: row.counts.packages,
    coveredMonths: row.counts.covered,
    average: {
      pct: averagePct,
      resultPerMonth: operatingMonths ? sumResult / operatingMonths : null,
      months: window.length,
      operatingMonths,
      negativeMonths: window.filter(r => result(r) < 0).length,
      sumIncome,
      sumResult,
      monthVsAveragePp: averagePct == null || resultPct == null ? null : resultPct - averagePct,
      prevWindowPct: prevAveragePct,
      vsPrevWindowPp: averagePct == null || prevAveragePct == null ? null : averagePct - prevAveragePct
    },
    deltas: {
      incomeMoM: prev ? change(inc, income(prev)) : null,
      incomeYoY: yoy ? change(inc, income(yoy)) : null,
      expensesMoM: prev ? change(exp, expenses(prev)) : null,
      expensesYoY: yoy ? change(exp, expenses(yoy)) : null,
      resultMoM: prev ? change(res, result(prev)) : null,
      resultYoY: yoy ? change(res, result(yoy)) : null
    }
  }
}

// ── Puente de rentabilidad ────────────────────────────────────────────────────
// De los ingresos a la ganancia, bloque por bloque. Un bloque sin movimiento en el
// mes no se dibuja. Las claves las rotula la UI.
export const BRIDGE_COSTS = ['salaries', 'providers', 'extras', 'fixed', 'variable', 'extraordinary']

export function bridgeStepsV2(row, { basis = 'bank', withIva = false, fixedBasis = 'monthly' } = {}) {
  if (!row) return null
  const income = incomeOf(row, { basis, withIva })
  const p = personalOf(row)
  const o = operatingOf(row, { fixedBasis })
  const amounts = {
    salaries: p.salaries,
    providers: p.providers,
    // Extras del personal y aporte de directores: no son estructura, son del mes.
    extras: p.extras + p.director,
    fixed: o.fixed,
    variable: o.variable,
    extraordinary: o.extraordinary
  }
  const steps = [{ key: 'income', kind: 'start', amount: income, from: 0, to: income }]
  let running = income
  for (const key of BRIDGE_COSTS) {
    const amount = amounts[key]
    if (!(amount > 0)) continue
    steps.push({ key, kind: 'cost', amount, from: running, to: running - amount })
    running -= amount
  }
  steps.push({ key: 'net', kind: 'end', amount: running, from: 0, to: running })
  return { steps, income, net: running }
}

// ── Gastos por categoría ──────────────────────────────────────────────────────
// Gastos del mes sin el personal, por categoría: cada movimiento pertenece a un
// tipo (fijo, variable, extraordinario) y la categoría suma los tres.

const NO_CATEGORY = 'Sin categoría'

export function categoryTotals({ year, month, variableRows, extraordinaryRows }, fixedTemplates, { fixedBasis = 'monthly' } = {}) {
  const totals = new Map()
  const add = (label, type, amount) => {
    if (!amount) return
    const key = label || NO_CATEGORY
    if (!totals.has(key)) totals.set(key, { label: key, value: 0, byType: { fixed: 0, variable: 0, extraordinary: 0 } })
    const entry = totals.get(key)
    entry.value += amount
    entry.byType[type] += amount
  }
  for (const t of fixedTemplates || []) {
    if (fixedBasis === 'cash') {
      if (hitsMonth(t, year, month)) add(t.categoryName, 'fixed', num(t.amount))
    } else if (isActive(t, year, month)) {
      add(t.categoryName, 'fixed', monthlyAmount(t))
    }
  }
  for (const e of variableRows || []) {
    if (Number(e.year) === year && Number(e.month) === month) add(e.categoryName, 'variable', num(e.amount))
  }
  for (const x of extraordinaryRows || []) {
    if (Number(x.year) === year && Number(x.month) === month) add(x.categoryName, 'extraordinary', num(x.amount))
  }
  return totals
}

// current / previous: { year, month, variableRows, extraordinaryRows } (previous
// puede faltar). Una categoría que el mes anterior tuvo y este no aparece en 0, para
// que la suma de las variaciones sea la variación del total.
export function expensesByCategoryV2(current, previous, fixedTemplates, opts = {}) {
  const now = categoryTotals(current, fixedTemplates, opts)
  const before = previous ? categoryTotals(previous, fixedTemplates, opts) : null
  if (before) {
    for (const label of before.keys()) {
      if (!now.has(label)) now.set(label, { label, value: 0, byType: { fixed: 0, variable: 0, extraordinary: 0 } })
    }
  }
  const rows = [...now.values()]
    .map(entry => {
      const prev = before ? (before.get(entry.label)?.value ?? 0) : null
      return { ...entry, prev, ...withChange(entry.value, prev) }
    })
    .sort((a, b) => b.value - a.value || (b.prev || 0) - (a.prev || 0))
  const total = sum(rows, r => r.value)
  const prevTotal = before ? sum(rows, r => r.prev) : null
  return { rows, total, prevTotal, ...withChange(total, prevTotal) }
}

function withChange(value, prev) {
  const c = change(value, prev)
  return { delta: c ? c.diff : null, deltaPct: c ? c.pct : null }
}

// ── Caja e impuestos ──────────────────────────────────────────────────────────
// Con IVA: lo que el mes tiene que ingresar al banco, cuánto ya entró y cuánto
// falta (por el estado de cada fila), la caja real del mes por fecha de pago y el
// IVA de ventas del mes (el del servicio del mes, que es lo que se factura).
export function cashAndTaxesV2(row) {
  if (!row) return null
  const g = key => linesTotal(row.income[key], true)
  const accrued = row.income.accrued
  const bank = g('bank')
  const collected = g('collected')
  const cash = g('cash')
  const cashOtherMonths = g('cashOtherMonths')
  const vatAttendance = accrued.attGross - accrued.attNet
  const vatTransport = accrued.transGross - accrued.transNet
  return {
    bank,
    collected,
    collectedPct: bank > 0 ? (collected / bank) * 100 : null,
    pending: g('pending'),
    gap: g('gap'),
    packageAdvance: g('packageAdvance'),
    covered: g('covered'),
    accrued: g('accrued'),
    cash,
    cashOtherMonths,
    cashOwnMonth: cash - cashOtherMonths,
    vat: vatAttendance + vatTransport,
    vatAttendance,
    vatTransport
  }
}

// ── Ingreso por línea ─────────────────────────────────────────────────────────
// Asistencia o transporte del mes, por defecto devengado: la caja no se puede
// partir por línea sin prorratear, el servicio sí (cada línea tiene su importe y su
// tasa). Todos los meses comparados salen de la misma fuente (el panel).
export function lineRevenueV2(series, year, month, line, { withIva = false, basis = 'accrued' } = {}) {
  const idx = findMonthIndex(series, year, month)
  if (idx < 0) return null
  const row = series[idx]
  const of = r => incomeOf(r, { basis, withIva, line })
  const revenue = of(row)
  const total = incomeOf(row, { basis, withIva })
  const clients = line === 'transport' ? row.counts.transportClients : row.counts.attendanceClients
  const base = row.counts.clients
  return {
    line,
    revenue,
    clients,
    base,
    penetrationPct: line === 'transport' && base > 0 ? (clients / base) * 100 : null,
    sharePct: total > 0 ? (revenue / total) * 100 : null,
    perClient: clients > 0 ? revenue / clients : null,
    mom: idx > 0 ? change(revenue, of(series[idx - 1])) : null,
    yoy: idx >= 12 ? change(revenue, of(series[idx - 12])) : null
  }
}

// ── Punto de equilibrio ───────────────────────────────────────────────────────
// Por usuario facturado en el mes. Ingreso: el servicio del mes sin IVA (devengado:
// el banco mete paquetes enteros que son de otros meses). Fijos: todo el personal,
// los fijos mensualizados y los extraordinarios (no escalan con los usuarios).
// Variables: los gastos variables del mes, que incluyen compras puntuales.
export function breakevenV2(row, { fixedBasis = 'monthly' } = {}) {
  if (!row) return null
  const users = row.counts.clients
  const personal = personalOf(row)
  const operating = operatingOf(row, { fixedBasis })
  const fixedCosts = personal.total + operating.fixed + operating.extraordinary
  const variableCosts = operating.variable
  const revenue = incomeOf(row, { basis: 'accrued' })
  const totalCosts = fixedCosts + variableCosts
  const per = v => (users > 0 ? v / users : null)
  const revenuePerUser = per(revenue)
  const variablePerUser = per(variableCosts)
  const contributionPerUser = users > 0 ? revenuePerUser - variablePerUser : null
  const breakevenUsers = contributionPerUser > 0 ? fixedCosts / contributionPerUser : null
  return {
    users,
    revenue,
    fixedCosts,
    variableCosts,
    totalCosts,
    result: revenue - totalCosts,
    costPerUser: per(totalCosts),
    revenuePerUser,
    variablePerUser,
    contributionPerUser,
    marginPerUser: users > 0 ? revenuePerUser - per(totalCosts) : null,
    breakevenUsers,
    breakevenRevenue: breakevenUsers == null ? null : breakevenUsers * revenuePerUser,
    // Cuántos usuarios se pueden perder antes de entrar en pérdida, en % del padrón.
    safetyMarginPct: breakevenUsers == null || users === 0 ? null : ((users - breakevenUsers) / users) * 100
  }
}
