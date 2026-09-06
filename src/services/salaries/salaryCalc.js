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
 * @param {Array<{liquido:number, effectiveDate:string, createdAt?:string}>} adjustments
 * @returns {{liquido:number, effectiveDate:string}|null}
 */
export function currentSalary(adjustments) {
  if (!adjustments || adjustments.length === 0) return null
  const sorted = [...adjustments].sort((a, b) => {
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

// Proyección: aplica el % semestral compuesto sobre N semestres.
export function proyectarNominal(nominal, pct, semestres) {
  return (Number(nominal) || 0) * Math.pow(1 + (Number(pct) || 0) / 100, semestres)
}
