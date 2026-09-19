import { parseDateOnly } from '../../utils/date'

// Costo de empleados (modelo laboral uruguayo).
// El input es el sueldo LÍQUIDO mensual + si la empleada aporta IRPF. Todo lo
// demás se deriva: el nominal y el costo a la compañía. asOf se inyecta (sin
// Date.now interno) para que los resultados sean deterministas y testeables.

// Divisor líquido → nominal según aporte a IRPF.
export const IRPF_FACTOR = 0.781
export const NO_IRPF_FACTOR = 0.804

// Aportes patronales mensuales sobre el nominal: jubilatorio + FONASA + FRL.
const APORTES_PATRONALES = 0.075 + 0.05 + 0.001
// Aguinaldo mensualizado: un nominal al año (1/12 por mes) más sus cargas.
const AGUINALDO_CARGAS = 1 + 0.075 + 0.001
// Salario vacacional: 20 días de jornal al año, mensualizado.
const VACACIONAL_DIAS = 20

/**
 * @param {boolean} hasIrpf
 * @returns {number} divisor para pasar de líquido a nominal
 */
export function irpfFactor(hasIrpf) {
  return hasIrpf ? IRPF_FACTOR : NO_IRPF_FACTOR
}

/**
 * Nominal mensual derivado del líquido.
 * @param {number} liquido
 * @param {boolean} hasIrpf
 * @returns {number}
 */
export function nominalFromLiquido(liquido, hasIrpf) {
  return (Number(liquido) || 0) / irpfFactor(hasIrpf)
}

/**
 * Desglose del costo mensual a la compañía, aplanado a lo largo del año: el
 * impacto cash es el mismo todos los meses. Se expone el detalle además del
 * total para poder mostrarlo en la ficha.
 * @param {number} liquido
 * @param {boolean} hasIrpf
 * @returns {{nominal:number, aportes:number, aguinaldo:number, vacacional:number, total:number}}
 */
export function monthlyCostBreakdown(liquido, hasIrpf) {
  const nominal = nominalFromLiquido(liquido, hasIrpf)
  const aportes = nominal * APORTES_PATRONALES
  const aguinaldo = (nominal / 12) * AGUINALDO_CARGAS
  const vacacional = (nominal / 30) * (VACACIONAL_DIAS / 12) * NO_IRPF_FACTOR
  return {
    nominal,
    aportes,
    aguinaldo,
    vacacional,
    total: nominal + aportes + aguinaldo + vacacional
  }
}

/**
 * Costo mensual a la compañía (nominal + patronales + aguinaldo + vacacional).
 * @param {number} liquido
 * @param {boolean} hasIrpf
 * @returns {number}
 */
export function monthlyCostToCompany(liquido, hasIrpf) {
  return monthlyCostBreakdown(liquido, hasIrpf).total
}

/**
 * Sueldo vigente = el ajuste con effectiveDate más alta (desempate por createdAt).
 *
 * Con `asOf` se limita a los ajustes ya vigentes a esa fecha, que es lo que
 * necesita el aporte de directores: el monto de cada mes se congela con el
 * nominal que regía ESE mes, no con el de hoy. Sin `asOf` se comporta como
 * siempre — incluye ajustes con fecha futura, que es lo que la ficha del
 * empleado quiere mostrar.
 *
 * @param {Array<{liquido:number, effectiveDate:string, createdAt?:string}>} adjustments
 * @param {string} [asOf] - 'YYYY-MM-DD'; ignora ajustes posteriores
 * @returns {{liquido:number, effectiveDate:string}|null}
 */
export function currentSalary(adjustments, asOf) {
  if (!adjustments || adjustments.length === 0) return null
  const eligible = asOf ? adjustments.filter(a => a.effectiveDate <= asOf) : adjustments
  if (eligible.length === 0) return null
  const sorted = [...eligible].sort((a, b) => {
    if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? 1 : -1
    const aCA = a.createdAt || '', bCA = b.createdAt || ''
    if (aCA !== bCA) return aCA < bCA ? 1 : -1
    return 0
  })
  const top = sorted[0]
  return { liquido: Number(top.liquido), effectiveDate: top.effectiveDate }
}

/**
 * Suma de extraordinarios del empleado en los últimos 12 meses respecto a asOf.
 * Se mantiene para la ficha; el costo mensual ya no los amortiza (ver
 * employeeCostForMonth en financeSeries: pegan como cash en su mes).
 * @param {Array<{amount:number, date:string}>} extraCosts
 * @param {string} [asOf]
 * @returns {number}
 */
export function extraordinarios12m(extraCosts, asOf) {
  if (!extraCosts || extraCosts.length === 0) return 0
  const ref = asOf ? parseDateOnly(asOf) : new Date()
  const cutoff = new Date(ref)
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  return extraCosts
    .filter(x => {
      const d = parseDateOnly(x.date)
      return d && d > cutoff && d <= ref
    })
    .reduce((sum, x) => sum + (Number(x.amount) || 0), 0)
}

// Aporte jubilatorio de directores (en la factura de BPS): se calcula sobre el
// sueldo nominal más alto de la empresa. No sale de APORTES_PATRONALES: es otra
// mezcla de tasas, propia del aporte de directores.
export const DIRECTOR_CONTRIBUTION_RATE = 0.15 + 0.001 + 0.075

// Cada director aporta por su cuenta sobre la misma base. Constante y no
// setting: cambia sólo si cambia la composición de la sociedad, y en ese caso
// se toca acá en una línea.
export const DIRECTORS_COUNT = 2

/**
 * Nominal más alto vigente al cierre de un mes, entre los empleados activos.
 *
 * El sueldo se resuelve as-of el mes (currentSalary con asOf), así que un
 * ajuste con vigencia posterior no infla un mes anterior. La actividad, en
 * cambio, se lee de `active`: la tabla no guarda fecha de baja, así que para un
 * mes pasado se asume la actividad de hoy.
 *
 * @param {Array<{active:boolean, hasIrpf:boolean, adjustments:Array}>} employees
 * @param {string} monthEnd - 'YYYY-MM-DD', último día del mes
 * @returns {number} 0 si no hay ningún empleado activo con sueldo vigente
 */
export function highestNominalAsOf(employees, monthEnd) {
  if (!employees || employees.length === 0) return 0
  return employees.reduce((max, e) => {
    if (!e.active) return max
    const salary = currentSalary(e.adjustments, monthEnd)
    if (!salary) return max
    return Math.max(max, nominalFromLiquido(salary.liquido, e.hasIrpf))
  }, 0)
}

/**
 * Aporte de UN director en un mes: nominal más alto de ese mes por la tasa,
 * redondeado a peso.
 * @param {Array} employees
 * @param {string} monthEnd - 'YYYY-MM-DD', último día del mes
 * @returns {number}
 */
export function directorContributionPerDirector(employees, monthEnd) {
  return Math.round(highestNominalAsOf(employees, monthEnd) * DIRECTOR_CONTRIBUTION_RATE)
}

/**
 * Aporte jubilatorio de directores de un mes: el aporte de un director por la
 * cantidad de directores. Se redondea por director y después se multiplica —
 * cada uno aporta su propia línea en la factura de BPS — y no al revés, que
 * daría un peso de diferencia.
 * @param {Array} employees
 * @param {string} monthEnd - 'YYYY-MM-DD', último día del mes
 * @returns {number}
 */
export function directorContributionAsOf(employees, monthEnd) {
  return directorContributionPerDirector(employees, monthEnd) * DIRECTORS_COUNT
}

// Proyección: aplica el % semestral compuesto sobre N semestres.
export function proyectarNominal(nominal, pct, semestres) {
  return (Number(nominal) || 0) * Math.pow(1 + (Number(pct) || 0) / 100, semestres)
}
