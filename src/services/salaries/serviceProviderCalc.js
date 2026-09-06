// Costo de prestadores de servicios. Deliberadamente trivial: el monto mensual
// es el monto mensual — no hay aguinaldo, ni salario vacacional, ni un anual
// que mensualizar (eso es de empleados, ver salaryCalc).

/**
 * Costo mensual de los prestadores activos. Dar de baja deja de sumar.
 * @param {Array<{monthlyAmount: number, active: boolean}>} providers
 * @returns {number}
 */
export function providerCostForMonth(providers) {
  if (!providers || providers.length === 0) return 0
  return providers
    .filter(p => p.active)
    .reduce((sum, p) => sum + (Number(p.monthlyAmount) || 0), 0)
}
