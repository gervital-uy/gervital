import { shouldPromptCorrection, correctionDelta, monthsInRange, keepCorrectionNotes } from './billingCorrection'

describe('shouldPromptCorrection', () => {
  test('mes pago con monto distinto: corresponde corregir', () => {
    expect(shouldPromptCorrection({ isPaid: true, paidAmount: 12400, recalculatedAmount: 11600 })).toBe(true)
  })

  test('mes pago con el mismo monto: no molesta', () => {
    expect(shouldPromptCorrection({ isPaid: true, paidAmount: 12400, recalculatedAmount: 12400 })).toBe(false)
  })

  test('mes no pago: nunca corrige, no hay monto cobrado', () => {
    expect(shouldPromptCorrection({ isPaid: false, paidAmount: null, recalculatedAmount: 11600 })).toBe(false)
  })

  test('mes pago sin paidAmount registrado: no corrige', () => {
    // Dato viejo sin monto: no hay contra qué comparar, no se inventa una diferencia.
    expect(shouldPromptCorrection({ isPaid: true, paidAmount: null, recalculatedAmount: 11600 })).toBe(false)
  })

  test('compara redondeado a peso, no en flotante', () => {
    expect(shouldPromptCorrection({ isPaid: true, paidAmount: 11600.4, recalculatedAmount: 11600 })).toBe(false)
    expect(shouldPromptCorrection({ isPaid: true, paidAmount: 11601, recalculatedAmount: 11600 })).toBe(true)
  })
})

describe('correctionDelta', () => {
  test('pagó de más: a favor del cliente', () => {
    expect(correctionDelta({ paidAmount: 12400, recalculatedAmount: 11600 }))
      .toEqual({ amount: 800, direction: 'refund' })
  })

  test('pagó de menos: el cliente debe', () => {
    expect(correctionDelta({ paidAmount: 11600, recalculatedAmount: 12400 }))
      .toEqual({ amount: 800, direction: 'debt' })
  })

  test('el monto siempre es positivo', () => {
    expect(correctionDelta({ paidAmount: 100, recalculatedAmount: 900 }).amount).toBe(800)
    expect(correctionDelta({ paidAmount: 900, recalculatedAmount: 100 }).amount).toBe(800)
  })

  test('sin diferencia da 0 y dirección refund', () => {
    expect(correctionDelta({ paidAmount: 500, recalculatedAmount: 500 }))
      .toEqual({ amount: 0, direction: 'refund' })
  })
})

describe('monthsInRange', () => {
  test('un solo mes', () => {
    expect(monthsInRange('2026-09-03', '2026-09-20')).toEqual([{ year: 2026, month: 8 }])
  })

  test('dos meses consecutivos', () => {
    expect(monthsInRange('2026-09-28', '2026-10-05'))
      .toEqual([{ year: 2026, month: 8 }, { year: 2026, month: 9 }])
  })

  test('cruza el fin de año', () => {
    expect(monthsInRange('2026-12-28', '2027-01-04'))
      .toEqual([{ year: 2026, month: 11 }, { year: 2027, month: 0 }])
  })

  test('rango invertido da vacío', () => {
    expect(monthsInRange('2026-10-05', '2026-09-28')).toEqual([])
  })
})

describe('keepCorrectionNotes', () => {
  test('conserva sólo las líneas de corrección', () => {
    const notes = 'Transferencia BROU\n[10/09/2026] Corrección de cobro: 12400 → 11600 · Ana\npendiente de recibo'
    expect(keepCorrectionNotes(notes)).toBe('[10/09/2026] Corrección de cobro: 12400 → 11600 · Ana')
  })

  test('varias correcciones se conservan todas, en orden', () => {
    const notes = '[01/09/2026] Corrección de cobro: 100 → 90\nnota suelta\n[02/09/2026] Corrección de cobro: 90 → 80'
    expect(keepCorrectionNotes(notes))
      .toBe('[01/09/2026] Corrección de cobro: 100 → 90\n[02/09/2026] Corrección de cobro: 90 → 80')
  })

  test('sin correcciones queda en null', () => {
    expect(keepCorrectionNotes('Transferencia BROU')).toBeNull()
  })

  test('notas vacías o ausentes dan null', () => {
    expect(keepCorrectionNotes(null)).toBeNull()
    expect(keepCorrectionNotes(undefined)).toBeNull()
    expect(keepCorrectionNotes('')).toBeNull()
  })
})
