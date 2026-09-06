-- 079: Sueldos a partir del líquido + IRPF
--
-- Cambia el input: se carga el sueldo LÍQUIDO mensual y si la empleada aporta
-- IRPF. El nominal deja de cargarse a mano y pasa a derivarse:
--
--     nominal = liquido / (hasIRPF ? 0.781 : 0.804)
--
-- y el costo mensual a la compañía (aplanado a lo largo del año) es:
--
--     nominal
--   + nominal * (0.075 + 0.05 + 0.001)          -- aportes patronales
--   + (nominal / 12) * (1 + 0.075 + 0.001)      -- aguinaldo + sus cargas
--   + (nominal / 30) * (20 / 12) * 0.804        -- salario vacacional
--
-- Por eso se elimina `nominal` de employee_salary_adjustments: tener el líquido
-- y el nominal guardados por separado es tener dos fuentes de verdad para el
-- mismo número, y se desincronizan en cuanto cambia el factor de IRPF.
-- Es reconstruible: nominal = liquido / factor.

-- ── 1. IRPF por empleada ────────────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_irpf BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN employees.has_irpf IS
  'Aporta IRPF: cambia el divisor líquido→nominal (0.781 con IRPF, 0.804 sin).';

-- ── 2. El nominal pasa a ser derivado ───────────────────────────────────────
ALTER TABLE employee_salary_adjustments DROP COLUMN IF EXISTS nominal;

COMMENT ON TABLE employee_salary_adjustments IS
  'Historial de sueldo líquido por fecha de vigencia. El nominal y el costo a la '
  'compañía se derivan del líquido y de employees.has_irpf (ver salaryCalc.js).';

-- ── 3. employees_full expone has_irpf ───────────────────────────────────────
-- has_irpf va al final a propósito: CREATE OR REPLACE VIEW sólo deja AGREGAR
-- columnas al final, no insertarlas en el medio (si no, habría que DROP + CREATE).
-- OJO: CREATE OR REPLACE VIEW pierde security_invoker, hay que re-afirmarlo.
CREATE OR REPLACE VIEW employees_full AS
SELECT id,
       name,
       role,
       semester_adjustment_pct,
       active,
       created_at,
       updated_at,
       COALESCE((SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.effective_date DESC, a.created_at DESC)
                 FROM employee_salary_adjustments a WHERE a.employee_id = e.id), '[]'::jsonb) AS adjustments,
       COALESCE((SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.date DESC)
                 FROM employee_extra_costs x WHERE x.employee_id = e.id), '[]'::jsonb) AS extra_costs,
       has_irpf
FROM employees e;

ALTER VIEW employees_full SET (security_invoker = on);

-- ── 4. RPC de alta: sin p_nominal, con p_has_irpf ───────────────────────────
-- Se dropea la firma vieja: agregar/quitar parámetros crea una sobrecarga nueva,
-- no la reemplaza, y después "function is not unique".
DROP FUNCTION IF EXISTS create_employee_with_salary(text, text, numeric, numeric, numeric, date, text);

CREATE OR REPLACE FUNCTION create_employee_with_salary(
  p_name TEXT,
  p_role TEXT,
  p_semester_adjustment_pct NUMERIC,
  p_liquido NUMERIC,
  p_has_irpf BOOLEAN,
  p_effective_date DATE,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO employees (name, role, semester_adjustment_pct, has_irpf)
  VALUES (p_name, p_role, COALESCE(p_semester_adjustment_pct, 3.5), COALESCE(p_has_irpf, FALSE))
  RETURNING id INTO v_id;

  INSERT INTO employee_salary_adjustments (employee_id, liquido, effective_date, notes)
  VALUES (v_id, p_liquido, p_effective_date, p_notes);

  RETURN v_id;
END;
$$;
