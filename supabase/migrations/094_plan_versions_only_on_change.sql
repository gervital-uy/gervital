-- ════════════════════════════════════════════════════════════════════════════
-- 094_plan_versions_only_on_change.sql
-- Bug: el "Historial de plan" de la ficha mostraba cambios de plan que no eran
-- cambios. Guardar la ficha (aunque sólo se tocara el teléfono) llama a
-- set_client_plan_version, que creaba una versión para el mes "Vigente desde"
-- aunque el plan fuera el mismo que regía. 104 de 184 filas de client_plans
-- repetían la versión anterior y el historial se leía como un registro mensual
-- "trancado" en el último mes en que se guardó la ficha.
--
-- Una versión es redundante si repite a la anterior del mismo cliente en
-- frecuencia, horario, transporte, días asignados (como conjunto: el orden no
-- importa) y distancia, ésta sólo con transporte (sin transporte nadie la lee: la
-- facturación toma la de la dirección y la ficha no la muestra). Borrarla no
-- cambia el plan de ningún mes: todos los lectores toman la última versión con
-- effective_from <= mes. La primera versión del cliente nunca es redundante.
--
-- 1. set_client_plan_version, después de escribir, borra las versiones
--    redundantes del cliente. Cubre guardar sin cambiar el plan (la fila del mes
--    repite la anterior), volver al plan previo y que la versión siguiente quede
--    igual a la nueva. Lo usan la edición de la ficha y reactivate_client. Misma
--    firma: CREATE OR REPLACE conserva los GRANT/REVOKE (ver 093). Devuelve la
--    versión que rige desde ese mes (los dos llamadores lo ignoran). Base: 021.
-- 2. Reparación: borra las versiones redundantes ya guardadas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. set_client_plan_version: sin cambio de plan no hay versión ───────────
CREATE OR REPLACE FUNCTION public.set_client_plan_version(
  p_client_id uuid,
  p_effective_from date,
  p_frequency integer,
  p_schedule text,
  p_has_transport boolean,
  p_assigned_days text[],
  p_distance_range text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_month date := date_trunc('month', p_effective_from)::date;
  v_id uuid;
BEGIN
  INSERT INTO client_plans (
    client_id, effective_from, frequency, schedule,
    has_transport, assigned_days, distance_range, created_by
  ) VALUES (
    p_client_id, v_month, p_frequency, p_schedule,
    COALESCE(p_has_transport, FALSE), COALESCE(p_assigned_days, '{}'), p_distance_range, p_created_by
  )
  ON CONFLICT (client_id, effective_from) DO UPDATE SET
    frequency     = EXCLUDED.frequency,
    schedule      = EXCLUDED.schedule,
    has_transport = EXCLUDED.has_transport,
    assigned_days = EXCLUDED.assigned_days,
    distance_range = EXCLUDED.distance_range,
    updated_at    = NOW();

  DELETE FROM client_plans cp
  USING (
    SELECT id, row_number() OVER w AS rn, plan_key, lag(plan_key) OVER w AS prev_key
    FROM (
      SELECT id, effective_from,
             jsonb_build_array(frequency, schedule, has_transport,
               CASE WHEN has_transport THEN distance_range END,
               (SELECT jsonb_agg(DISTINCT d ORDER BY d) FROM unnest(assigned_days) d)) AS plan_key
      FROM client_plans
      WHERE client_id = p_client_id
    ) k
    WINDOW w AS (ORDER BY effective_from)
  ) r
  WHERE cp.id = r.id AND r.rn > 1 AND r.plan_key IS NOT DISTINCT FROM r.prev_key;

  SELECT id INTO v_id
  FROM client_plans
  WHERE client_id = p_client_id AND effective_from <= v_month
  ORDER BY effective_from DESC
  LIMIT 1;
  RETURN v_id;
END;
$function$;

-- ── 2. Reparación: mismo criterio, todos los clientes ───────────────────────
DELETE FROM client_plans cp
USING (
  SELECT id, row_number() OVER w AS rn, plan_key, lag(plan_key) OVER w AS prev_key
  FROM (
    SELECT id, client_id, effective_from,
           jsonb_build_array(frequency, schedule, has_transport,
             CASE WHEN has_transport THEN distance_range END,
             (SELECT jsonb_agg(DISTINCT d ORDER BY d) FROM unnest(assigned_days) d)) AS plan_key
    FROM client_plans
  ) k
  WINDOW w AS (PARTITION BY client_id ORDER BY effective_from)
) r
WHERE cp.id = r.id AND r.rn > 1 AND r.plan_key IS NOT DISTINCT FROM r.prev_key;
