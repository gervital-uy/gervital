-- Migration 083: aporte jubilatorio de directores generado por el sistema
--
-- Es un gasto extraordinario sin empleado (employee_extra_costs con
-- employee_id NULL) que se materializa una vez por mes, con monto = sueldo
-- nominal más alto vigente ESE mes × (0.15 + 0.001 + 0.075).
--
-- El cálculo no vive acá a propósito: la conversión líquido → nominal está en
-- salaryCalc.js y las migraciones 079/080 justamente eliminaron la segunda
-- fuente de verdad del nominal. Replicar 0.781/0.804 en SQL la reintroduciría.
-- La generación la hace el front (self-heal al abrir Costos, que es superadmin
-- igual que la RLS de esta tabla); esta migración aporta la identidad de la
-- fila, la garantía de unicidad y el mes ancla.

-- ── 1. Identidad y estado de la fila automática ────────────────────────────
-- system_key: qué concepto automático es. NULL = fila cargada a mano.
-- overridden_at: cuándo se pisó el monto a mano. Solo cambia el cartel en la
--   UI (de "creado por sistema" a "editado a mano"); no apaga ningún recálculo,
--   porque una fila ya creada no se recalcula nunca.
ALTER TABLE employee_extra_costs
  ADD COLUMN IF NOT EXISTS system_key TEXT,
  ADD COLUMN IF NOT EXISTS overridden_at TIMESTAMPTZ;

-- Un concepto automático, una fila por mes. Es lo que hace idempotente al
-- self-heal: si dos pestañas abren Costos a la vez, la segunda choca acá en
-- vez de duplicar el gasto. El índice es sobre el mes, no sobre la fecha
-- exacta, porque el día puede cambiar (último día hábil) sin que el mes cambie.
-- El cast a timestamp es explícito: date_trunc sobre timestamptz es STABLE y no
-- entra en un índice; sobre timestamp es IMMUTABLE.
CREATE UNIQUE INDEX IF NOT EXISTS idx_extra_costs_system_month
  ON employee_extra_costs (system_key, date_trunc('month', date::timestamp))
  WHERE system_key IS NOT NULL;

-- ── 2. Mes ancla ───────────────────────────────────────────────────────────
-- Desde qué mes existe el aporte. Se siembra con el mes en que se aplica la
-- migración: "solo de ahora en adelante", sin tocar el histórico ni mover
-- totales del dashboard hacia atrás. CURRENT_DATE es el día uruguayo desde la
-- migración 081.
INSERT INTO app_settings (key, value)
VALUES ('director_contribution_start', to_char(CURRENT_DATE, 'YYYY-MM'))
ON CONFLICT (key) DO NOTHING;
