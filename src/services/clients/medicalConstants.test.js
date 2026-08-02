import { MARITAL_STATUS_OPTIONS, RESIDENCE_TYPE_OPTIONS, CHARACTER_OPTIONS, DIAGNOSIS_TYPE_OPTIONS, MEDICAL_HISTORY_CONDITIONS } from './medicalConstants'

test('every option has value and label', () => {
  const all = [...MARITAL_STATUS_OPTIONS, ...RESIDENCE_TYPE_OPTIONS, ...CHARACTER_OPTIONS, ...DIAGNOSIS_TYPE_OPTIONS, ...MEDICAL_HISTORY_CONDITIONS]
  all.forEach(o => {
    expect(typeof o.value).toBe('string')
    expect(o.value.length).toBeGreaterThan(0)
    expect(typeof o.label).toBe('string')
    expect(o.label.length).toBeGreaterThan(0)
  })
})

// Debe coincidir con el CHECK client_diagnoses_diagnosis_type_check (migración 073)
test('diagnosis types match the DB check constraint', () => {
  expect(DIAGNOSIS_TYPE_OPTIONS.map(o => o.value)).toEqual([
    'sin', 'declive_cognitivo', 'deterioro_cognitivo', 'demencia', 'parkinson'
  ])
})

test('medical history has the 17 canonical conditions', () => {
  expect(MEDICAL_HISTORY_CONDITIONS.map(c => c.value)).toEqual([
    'diabetes','celiaquia','hipertension','intolerancia_lactosa','dislipidemia',
    'cardiovascular','acv','demencia','cancer','caidas','fracturas','cirugia',
    'hospitalizacion','tuberculosis','hepatitis','alergias','restriccion_alimenticia'
  ])
})
