-- 076: reintegro programado editable.
--
-- Bug: al programar un reintegro a futuro, reactivate_client cierra el período de
-- inactividad (to_date = fecha futura) pero deja deleted_at puesto — el cliente
-- sigue de baja hasta que apply_due_reactivations lo levanta. El board de bajas no
-- mostraba ese estado, así que ofrecía "Reintegrar cliente" de nuevo y el RPC
-- fallaba con "Client not found or not deactivated": mensaje falso, porque el
-- cliente existe y SÍ está de baja; lo que pasa es que ya no hay período abierto.
--
-- Fix: reactivate_client opera sobre el período VIGENTE (el abierto o, si ya hay un
-- reintegro programado, el último), de modo que reprogramar es el mismo camino que
-- reintegrar. Y get_churn_board expone la fecha programada para que la UI la muestre.

-- ── 1. reactivate_client: idempotente sobre el período vigente ────────────────
CREATE OR REPLACE FUNCTION public.reactivate_client(
  p_client_id uuid,
  p_reactivation_date date,
  p_frequency integer DEFAULT NULL::integer,
  p_schedule text DEFAULT NULL::text,
  p_has_transport boolean DEFAULT NULL::boolean,
  p_assigned_days text[] DEFAULT NULL::text[],
  p_distance_range text DEFAULT NULL::text
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
DECLARE
  v_period_id uuid;
  v_from DATE;
  v_deactivated BOOLEAN;
BEGIN
  IF p_reactivation_date IS NULL THEN
    RAISE EXCEPTION 'Reactivation date required';
  END IF;

  SELECT deleted_at IS NOT NULL INTO v_deactivated FROM clients WHERE id = p_client_id;

  IF v_deactivated IS NULL THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  IF NOT v_deactivated THEN
    RAISE EXCEPTION 'Client is already active';
  END IF;

  -- Período vigente: el abierto gana; si no hay (reintegro ya programado), el último.
  SELECT id, from_date INTO v_period_id, v_from
  FROM client_inactivity_periods
  WHERE client_id = p_client_id
  ORDER BY (to_date IS NULL) DESC, from_date DESC
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'Client has no inactivity period to close';
  END IF;

  IF p_reactivation_date <= v_from THEN
    RAISE EXCEPTION 'Reactivation date must be after deactivation date (%)', v_from;
  END IF;

  UPDATE client_inactivity_periods
     SET to_date = p_reactivation_date,
         reactivated_at = NOW()
   WHERE id = v_period_id;

  IF p_reactivation_date <= CURRENT_DATE THEN
    UPDATE clients
       SET deleted_at = NULL,
           deactivation_date = NULL,
           deactivation_reason = NULL,
           deactivation_notes = NULL,
           deactivated_by = NULL,
           updated_at = NOW()
     WHERE id = p_client_id;
  END IF;

  IF p_frequency IS NOT NULL AND p_schedule IS NOT NULL AND p_assigned_days IS NOT NULL THEN
    PERFORM set_client_plan_version(
      p_client_id,
      date_trunc('month', p_reactivation_date)::date,
      p_frequency,
      p_schedule,
      COALESCE(p_has_transport, false),
      p_assigned_days,
      p_distance_range,
      NULL
    );
  END IF;

  RETURN p_client_id;
END;
$function$;

-- ── 2. get_churn_board: exponer la fecha de reintegro programado ─────────────
DROP FUNCTION IF EXISTS public.get_churn_board();

CREATE FUNCTION public.get_churn_board()
RETURNS TABLE(
  client_id uuid, first_name text, last_name text, cognitive_level text,
  frequency integer, schedule text, assigned_days text[],
  stage text, reason text, deactivation_notes text, deactivation_date date,
  mrr_snapshot numeric, assigned_to uuid, assigned_name text,
  days_since integer, note_count integer, is_currently_inactive boolean,
  was_trial boolean, scheduled_reactivation_date date, updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  INSERT INTO churn_followups (client_id, stage, reason, deactivation_date, mrr_snapshot)
  SELECT
    c.id,
    CASE
      WHEN c.deactivation_reason = 'death' THEN 'lost'
      ELSE 'new'
    END,
    c.deactivation_reason,
    c.deactivation_date,
    -- Los no facturables (charity/trial) nunca generaron ingreso: MRR perdido = 0.
    CASE WHEN c.client_type <> 'regular' THEN 0 ELSE
      (SELECT pp.price_gross
         FROM client_plans cp2
         JOIN plan_pricing pp ON pp.frequency = cp2.frequency AND pp.schedule = cp2.schedule
        WHERE cp2.client_id = c.id
          AND cp2.effective_from <= COALESCE(c.deactivation_date, CURRENT_DATE)
        ORDER BY cp2.effective_from DESC
        LIMIT 1)
    END
  FROM clients c
  WHERE c.deleted_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM churn_followups f WHERE f.client_id = c.id)
  ON CONFLICT (client_id) DO NOTHING;

  RETURN QUERY
  SELECT
    f.client_id, c.first_name, c.last_name, c.cognitive_level,
    cp.frequency, cp.schedule, cp.assigned_days,
    f.stage, f.reason, c.deactivation_notes, f.deactivation_date, f.mrr_snapshot,
    f.assigned_to, u.name,
    (CURRENT_DATE - f.deactivation_date)::int,
    (SELECT COUNT(*)::int FROM churn_followup_notes n WHERE n.client_id = f.client_id),
    (c.deleted_at IS NOT NULL),
    -- Espejo exacto de churnedDuringTrial() en commercialStats.js.
    COALESCE(
      c.trial_started_at IS NOT NULL
      AND f.deactivation_date IS NOT NULL
      AND (c.trial_converted_at IS NULL OR c.trial_converted_at > f.deactivation_date)
    , false),
    -- Reintegro ya programado a futuro (mismo criterio que clients_full).
    (SELECT max(p.to_date) FROM client_inactivity_periods p
      WHERE p.client_id = f.client_id AND p.to_date > CURRENT_DATE),
    f.updated_at
  FROM churn_followups f
  JOIN clients c ON c.id = f.client_id
  LEFT JOIN LATERAL (
    SELECT cp.frequency, cp.schedule, cp.assigned_days
    FROM client_plans cp
    WHERE cp.client_id = f.client_id
      AND cp.effective_from <= COALESCE(f.deactivation_date, CURRENT_DATE)
    ORDER BY cp.effective_from DESC
    LIMIT 1
  ) cp ON true
  LEFT JOIN users u ON u.id = f.assigned_to
  WHERE c.deleted_at IS NOT NULL
  ORDER BY f.deactivation_date DESC NULLS LAST;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_churn_board() TO authenticated;
