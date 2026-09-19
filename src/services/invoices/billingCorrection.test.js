import { shouldPromptCorrection, correctionDelta } from './billingCorrection'

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
