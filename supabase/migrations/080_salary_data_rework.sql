-- 080: Aplana los sueldos a un único líquido vigente desde junio 2026
--
-- Decisión del usuario: un solo líquido por empleada desde el arranque de la
-- data (junio), con los valores de la planilla. Se descartan los ajustes viejos
-- (los de junio eran más bajos) y se corrigen dos nombres.
--
-- ESTADO PREVIO (por si hay que revertir) — employee_salary_adjustments,
-- (nombre, nominal, liquido, effective_date):
--   Abigail Bermudez    48824  39255  2026-06-01
--   Abigail Bermudez    49751  40000  2026-08-05
--   Belen Rodriguez     50995  41000  2026-06-01
--   Belen Rodriguez     51964  41779  2026-08-05
--   Camila Larrosa      47264  38000  2026-07-20
--   Carolina Solorzano  41484  33354  2026-06-01
--   Carolina Solorzano  42272  33987  2026-08-05
--   Maria Dall Orso     74450  58300  2026-06-01
--   Maria Dall Orso     75864  59251  2026-08-05
--   Martina Morales     44776  36672  2026-06-01
--   Martina Morales     45626  36684  2026-08-05
-- (la columna nominal ya no existe; era liquido / factor de IRPF)
--
-- Quién aporta IRPF se dedujo de los nominales que ya estaban cargados: sólo
-- María Dall Orso daba 59251/0.781; las otras cinco daban exacto con /0.804.

-- ── Nombres corregidos según la planilla ────────────────────────────────────
UPDATE employees SET name = 'Carolina Del Valle' WHERE name = 'Carolina Solorzano';
UPDATE employees SET name = 'Eugenia Rodríguez'  WHERE name = 'Belen Rodriguez';

-- ── IRPF ────────────────────────────────────────────────────────────────────
UPDATE employees SET has_irpf = TRUE  WHERE name = 'María Dall Orso' OR name = 'Maria Dall Orso';
UPDATE employees SET has_irpf = FALSE WHERE name NOT IN ('María Dall Orso', 'Maria Dall Orso');

-- ── Un único ajuste por empleada, vigente desde junio 2026 ──────────────────
DELETE FROM employee_salary_adjustments;

INSERT INTO employee_salary_adjustments (employee_id, liquido, effective_date, notes)
SELECT e.id, v.liquido, DATE '2026-06-01', 'Migración 080: líquido unificado desde junio'
FROM employees e
JOIN (VALUES
  ('Carolina Del Valle', 33987::NUMERIC),
  ('Maria Dall Orso',    59251),
  ('Abigail Bermudez',   40000),
  ('Eugenia Rodríguez',  41779),
  ('Martina Morales',    36684),
  ('Camila Larrosa',     38000)
) AS v(name, liquido) ON v.name = e.name;
