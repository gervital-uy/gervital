/**
 * Lógica pura del modelo unificado de faltas. Toda falta es status 'absent',
 * descrita por is_justified + is_chargeable.
 *
 * `is_chargeable` lo ELIGE el usuario en el modal, ya no se deriva de la fecha:
 * que una falta justificada se cobre o se descuente es una concesión comercial,
 * no una consecuencia de cuándo se cargó. El default de la UI es siempre
 * cobrable. Espejo exacto de la RPC register_absence.
 */

/**
 * @param {{ isJustified: boolean, isChargeable: boolean }} p
 * @returns {{ status: 'absent', isJustified: boolean, isChargeable: boolean, generatesCredit: boolean }}
 */
export function deriveAbsence({ isJustified, isChargeable }) {
  // Una falta injustificada se cobra siempre: la elección solo aplica a las justificadas.
  const chargeable = !isJustified || !!isChargeable
  return {
    status: 'absent',
    isJustified: !!isJustified,
    isChargeable: chargeable,
    generatesCredit: !!isJustified && chargeable
  }
}

/** Clases Tailwind de la celda del calendario por status + atributos de falta. */
export function dayStyle(status, isJustified, isChargeable) {
  if (status === 'attended') return 'bg-green-500 text-white'
  if (status === 'absent') {
    if (!isJustified) return 'bg-red-500 text-white'
    return isChargeable ? 'bg-red-300 text-white' : 'bg-orange-400 text-white'
  }
  if (status === 'recovery') return 'bg-blue-500 text-white'
  if (status === 'scheduled') return 'bg-gray-200 text-gray-600'
  return ''
}

/** { title, reason } — reason es el motivo libre (notes) cuando la falta lo tiene. */
export function dayTooltip(status, isJustified, isChargeable, notes) {
  let title = ''
  if (status === 'attended') title = 'Asistió'
  else if (status === 'absent') {
    if (!isJustified) title = 'Falta no justificada'
    else title = isChargeable ? 'Falta justificada (+1 recupero)' : 'Falta justificada (no cobrable)'
  }
  else if (status === 'recovery') title = 'Día recuperado'
  else if (status === 'scheduled') title = 'Programado'
  const reason = status === 'absent' && notes ? notes : null
  return { title, reason }
}

/** Texto predecible del resultado, para el modal de registro de falta. */
export function outcomePreview({ isJustified, isChargeable }) {
  if (!isJustified) return 'Se cobra el día igual. Sin crédito de recupero.'
  return isChargeable
    ? 'Se cobra el día y se acredita 1 día de recupero.'
    : 'No se cobra el día (sin recupero).'
}
