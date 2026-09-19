import { deriveAbsence, dayStyle, dayTooltip, outcomePreview } from './absenceModel'

describe('deriveAbsence', () => {
  test('injustificada: siempre cobrable, nunca crédito', () => {
    expect(deriveAbsence({ isJustified: false, isChargeable: true }))
      .toEqual({ status: 'absent', isJustified: false, isChargeable: true, generatesCredit: false })
  })

  test('injustificada ignora isChargeable=false: el día se cobra igual', () => {
    expect(deriveAbsence({ isJustified: false, isChargeable: false }))
      .toEqual({ status: 'absent', isJustified: false, isChargeable: true, generatesCredit: false })
  })

  test('justificada cobrable: +1 crédito', () => {
    expect(deriveAbsence({ isJustified: true, isChargeable: true }))
      .toEqual({ status: 'absent', isJustified: true, isChargeable: true, generatesCredit: true })
  })

  test('justificada no cobrable: sin crédito', () => {
    expect(deriveAbsence({ isJustified: true, isChargeable: false }))
      .toEqual({ status: 'absent', isJustified: true, isChargeable: false, generatesCredit: false })
  })

  test('el crédito sale sii justificada y cobrable', () => {
    const credito = (j, c) => deriveAbsence({ isJustified: j, isChargeable: c }).generatesCredit
    expect([credito(true, true), credito(true, false), credito(false, true), credito(false, false)])
      .toEqual([true, false, false, false])
  })
})

describe('dayStyle', () => {
  test('injustificada = rojo fuerte', () => {
    expect(dayStyle('absent', false, true)).toBe('bg-red-500 text-white')
  })
  test('justificada cobrable = rojo claro', () => {
    expect(dayStyle('absent', true, true)).toBe('bg-red-300 text-white')
  })
  test('justificada no cobrable = naranja', () => {
    expect(dayStyle('absent', true, false)).toBe('bg-orange-400 text-white')
  })
  test('attended/recovery/scheduled sin cambios', () => {
    expect(dayStyle('attended', false, true)).toBe('bg-green-500 text-white')
    expect(dayStyle('recovery', false, true)).toBe('bg-blue-500 text-white')
    expect(dayStyle('scheduled', false, true)).toBe('bg-gray-200 text-gray-600')
  })
})

describe('dayTooltip', () => {
  test('justificada cobrable → +1 recupero, con motivo', () => {
    expect(dayTooltip('absent', true, true, 'Enfermo/a'))
      .toEqual({ title: 'Falta justificada (+1 recupero)', reason: 'Enfermo/a' })
  })
  test('justificada no cobrable → no cobrable', () => {
    expect(dayTooltip('absent', true, false, null))
      .toEqual({ title: 'Falta justificada (no cobrable)', reason: null })
  })
  test('injustificada', () => {
    expect(dayTooltip('absent', false, true, null))
      .toEqual({ title: 'Falta no justificada', reason: null })
  })
})

describe('outcomePreview', () => {
  test('injustificada', () => {
    expect(outcomePreview({ isJustified: false, isChargeable: true }))
      .toBe('Se cobra el día igual. Sin crédito de recupero.')
  })

  test('justificada cobrable', () => {
    expect(outcomePreview({ isJustified: true, isChargeable: true }))
      .toBe('Se cobra el día y se acredita 1 día de recupero.')
  })

  test('justificada no cobrable', () => {
    expect(outcomePreview({ isJustified: true, isChargeable: false }))
      .toBe('No se cobra el día (sin recupero).')
  })
})
