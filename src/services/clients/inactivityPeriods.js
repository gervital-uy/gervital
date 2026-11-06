// Períodos de inactividad de un cliente: [fromDate, toDate). toDate null = abierto.
// Comparación por string 'YYYY-MM-DD' (ordena lexicográficamente = cronológicamente).

const covers = (p, dateStr) => !!p && dateStr >= p.fromDate && (p.toDate == null || dateStr < p.toDate)

export function isInactiveOn(dateStr, periods) {
  if (!dateStr || !Array.isArray(periods)) return false
  return periods.some(p => covers(p, dateStr))
}

export const dayInAnyPeriod = isInactiveOn

const coveringOn = (dateStr, periods) => periods.filter(p => covers(p, dateStr))

// ¿Inactivo todos los días de [fromStr, toStr] (ambos inclusive)? Los períodos pueden
// venir encadenados: uno arranca el día en que termina el otro.
export function isInactiveThroughout(fromStr, toStr, periods) {
  if (!fromStr || !toStr || !Array.isArray(periods)) return false
  let day = fromStr
  while (day <= toStr) {
    const covering = coveringOn(day, periods)
    if (!covering.length) return false
    if (covering.some(p => p.toDate == null)) return true
    // El primer día que ninguno de esos períodos cubre (siempre posterior a `day`).
    day = covering.reduce((max, p) => (p.toDate > max ? p.toDate : max), day)
  }
  return true
}
