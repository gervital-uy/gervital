-- 073: agregar 'parkinson' a los tipos de diagnóstico permitidos.
-- El frontend (DIAGNOSIS_TYPE_OPTIONS en medicalConstants.js) ofrece la opción
-- desde el commit 3f925f6 pero el CHECK de la tabla nunca se extendió, así que
-- guardar un cliente con ese diagnóstico fallaba con
-- "client_diagnoses_diagnosis_type_check".

ALTER TABLE client_diagnoses DROP CONSTRAINT IF EXISTS client_diagnoses_diagnosis_type_check;

ALTER TABLE client_diagnoses ADD CONSTRAINT client_diagnoses_diagnosis_type_check
  CHECK (diagnosis_type IS NULL OR diagnosis_type IN (
    'sin', 'declive_cognitivo', 'deterioro_cognitivo', 'demencia', 'parkinson'
  ));
