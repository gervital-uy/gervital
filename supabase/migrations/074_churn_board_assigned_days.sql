-- 074: get_churn_board devuelve también los días asignados del plan vigente a
-- la fecha de baja, para mostrar el plan completo (días + turno) en el modal
-- de seguimiento de bajas.
-- Cambia el tipo de retorno → hay que DROP antes del CREATE.

DROP FUNCTION IF EXISTS public.get_churn_board();

CREATE FUNCTION public.get_churn_board()
RETURNS TABLE(
  client_id uuid, first_name text, last_name text, cognitive_level text,
  frequency integer, schedule text, assigned_days text[],
  stage text, reason text, deactivation_notes text, deactivation_date date,
  mrr_snapshot numeric, assigned_to uuid, assigned_name text,
  days_since integer, note_count integer, is_currently_inactive boolean,
  updated_at timestamptz
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
    (SELECT pp.price_gross
       FROM client_plans cp2
       JOIN plan_pricing pp ON pp.frequency = cp2.frequency AND pp.schedule = cp2.schedule
      WHERE cp2.client_id = c.id
        AND cp2.effective_from <= COALESCE(c.deactivation_date, CURRENT_DATE)
      ORDER BY cp2.effective_from DESC
      LIMIT 1)
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
