-- 075: embudo de período de prueba.
-- Un cliente 'trial' que se da de baja NO vuelve a 'regular' (eso lo haría contar
-- como baja normal con MRR perdido que nunca se facturó). En su lugar se registra
-- cuándo entró a prueba y cuándo se convirtió, y de ahí se deriva "no se quedó
-- tras la prueba" = estuvo a prueba y nunca se convirtió (o se convirtió después
-- de la baja).
-- Spec: docs/superpowers/specs/2026-08-01-trial-churn-tracking-design.md

-- ── 1. Columnas del embudo ────────────────────────────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS trial_started_at   date;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS trial_converted_at date;

COMMENT ON COLUMN clients.trial_started_at IS
  'Fecha en que el cliente pasó a client_type = trial. NULL si nunca estuvo a prueba.';
COMMENT ON COLUMN clients.trial_converted_at IS
  'Fecha en que dejó de estar a prueba pasando a otro tipo. NULL si sigue a prueba o nunca lo estuvo.';

-- ── 2. Trigger: mantiene el embudo venga el cambio de donde venga ─────────────
-- Va en un trigger y no en los RPCs a propósito: create_client_full,
-- update_client_full y cualquier UPDATE directo comparten la misma regla.
CREATE OR REPLACE FUNCTION public.sync_trial_funnel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.client_type = 'trial' AND NEW.trial_started_at IS NULL THEN
      NEW.trial_started_at := COALESCE(NEW.start_date, CURRENT_DATE);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.client_type IS DISTINCT FROM OLD.client_type THEN
    IF NEW.client_type = 'trial' THEN
      -- Entra (o vuelve a entrar) a prueba: reinicia el embudo.
      NEW.trial_started_at  := CURRENT_DATE;
      NEW.trial_converted_at := NULL;
    ELSIF OLD.client_type = 'trial' THEN
      -- Sale de prueba hacia otro tipo: se quedó.
      NEW.trial_converted_at := CURRENT_DATE;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_trial_funnel ON clients;
CREATE TRIGGER trg_sync_trial_funnel
  BEFORE INSERT OR UPDATE OF client_type ON clients
  FOR EACH ROW EXECUTE FUNCTION public.sync_trial_funnel();

-- ── 3. Backfill de los trial existentes ──────────────────────────────────────
UPDATE clients
   SET trial_started_at = COALESCE(start_date, created_at::date)
 WHERE client_type = 'trial'
   AND trial_started_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_trial_started
  ON clients(trial_started_at) WHERE trial_started_at IS NOT NULL;

-- ── 4. clients_full: exponer las dos fechas ──────────────────────────────────
-- OJO: CREATE OR REPLACE VIEW pierde security_invoker → se re-asierta al final.
CREATE OR REPLACE VIEW clients_full AS
 SELECT c.id,
    c.first_name AS "firstName", c.last_name AS "lastName", c.email, c.phone,
    c.birth_date AS "birthDate", c.cognitive_level AS "cognitiveLevel", c.start_date AS "startDate",
    c.document_type AS "documentType", c.document_number AS "documentNumber",
    c.marital_status AS "maritalStatus", c.residence_type AS "residenceType", c.lives_with AS "livesWith",
    c.biller_client_id AS "billerClientId", c.biller_branch_id AS "billerBranchId",
    c.biller_synced_at AS "billerSyncedAt", c.biller_sync_error AS "billerSyncError",
    ( SELECT count(*)::integer FROM recovery_credits rc
       WHERE rc.client_id = c.id AND rc.status = 'available'::text AND rc.expires_at >= CURRENT_DATE) AS "recoveryDaysAvailable",
    c.avatar_url AS "avatarUrl", c.deleted_at AS "deletedAt",
    c.deactivation_reason AS "deactivationReason", c.deactivation_notes AS "deactivationNotes",
    c.created_at AS "createdAt",
    CASE WHEN cp.id IS NOT NULL THEN jsonb_build_object('frequency', cp.frequency, 'schedule', cp.schedule, 'hasTransport', cp.has_transport, 'assignedDays', cp.assigned_days) ELSE NULL::jsonb END AS plan,
    CASE WHEN ec.id IS NOT NULL THEN jsonb_build_object('name', ec.name, 'relationship', ec.relationship, 'phone', ec.phone) ELSE NULL::jsonb END AS "emergencyContact",
    CASE WHEN ca.id IS NOT NULL THEN jsonb_build_object('street', ca.street, 'accessNotes', ca.access_notes, 'doorbell', ca.doorbell, 'concierge', ca.concierge, 'latitude', ca.latitude, 'longitude', ca.longitude, 'distanceRange', ca.distance_range) ELSE NULL::jsonb END AS address,
    CASE WHEN mi.id IS NOT NULL THEN jsonb_build_object('healthEmergencyService', mi.health_emergency_service, 'healthProvider', mi.health_provider, 'healthNotes', mi.health_notes, 'medicationNotes', mi.medication_notes, 'historyNotes', mi.history_notes, 'educationLevel', mi.education_level, 'occupation', mi.occupation, 'significantInterests', mi.significant_interests, 'significantBonds', mi.significant_bonds, 'musicTaste', mi.music_taste, 'favoriteFoods', mi.favorite_foods, 'character', mi.personality_type, 'personalResources', mi.personal_resources, 'vulnerabilities', mi.vulnerabilities) ELSE NULL::jsonb END AS "medicalInfo",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('name', m.name, 'schedule', m.schedule, 'dose', m.dose, 'indicatedFor', m.indicated_for) ORDER BY m."position", m.created_at) FROM client_medications m WHERE m.client_id = c.id), '[]'::jsonb) AS medications,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('diagnosisType', d.diagnosis_type, 'behaviorDisorder', d.behavior_disorder) ORDER BY d."position", d.created_at) FROM client_diagnoses d WHERE d.client_id = c.id), '[]'::jsonb) AS diagnoses,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('condition', h.condition, 'comment', h.comment) ORDER BY h.created_at) FROM client_medical_history h WHERE h.client_id = c.id), '[]'::jsonb) AS "medicalHistory",
    c.transfer_responsible AS "transferResponsible",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('name', ec2.name, 'relationship', ec2.relationship, 'phone', ec2.phone) ORDER BY ec2."position", ec2.created_at) FROM emergency_contacts ec2 WHERE ec2.client_id = c.id), '[]'::jsonb) AS "emergencyContacts",
    c.deactivation_date AS "deactivationDate",
    c.client_type AS "clientType",
    EXISTS ( SELECT 1 FROM monthly_invoices minv WHERE minv.client_id = c.id AND minv.discount_percent > 0 AND minv.year = EXTRACT(YEAR FROM CURRENT_DATE)::int AND minv.month = (EXTRACT(MONTH FROM CURRENT_DATE)::int - 1)) AS "hasActiveDiscount",
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('fromDate', p.from_date, 'toDate', p.to_date) ORDER BY p.from_date) FROM client_inactivity_periods p WHERE p.client_id = c.id), '[]'::jsonb) AS "inactivityPeriods",
    ( SELECT max(p.to_date) FROM client_inactivity_periods p WHERE p.client_id = c.id AND p.to_date > CURRENT_DATE) AS "scheduledReactivationDate",
    -- NEW: embudo de prueba (van al final: CREATE OR REPLACE VIEW sólo permite APPEND)
    c.trial_started_at AS "trialStartedAt",
    c.trial_converted_at AS "trialConvertedAt"
   FROM clients c
     LEFT JOIN LATERAL ( SELECT cp2.id, cp2.frequency, cp2.schedule, cp2.has_transport, cp2.assigned_days
           FROM client_plans cp2 WHERE cp2.client_id = c.id AND cp2.effective_from <= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date
          ORDER BY cp2.effective_from DESC LIMIT 1) cp ON true
     LEFT JOIN LATERAL ( SELECT ec1.id, ec1.name, ec1.relationship, ec1.phone
           FROM emergency_contacts ec1 WHERE ec1.client_id = c.id ORDER BY ec1."position", ec1.created_at LIMIT 1) ec ON true
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;

ALTER VIEW clients_full SET (security_invoker = on);

-- ── 5. mrr_snapshot: 0 para no facturables (charity/trial) ───────────────────
-- Bug preexistente: el snapshot tomaba precio de lista sin mirar client_type, así
-- que las bajas de clientes que nunca facturaron mostraban "MRR perdido".
UPDATE churn_followups f
   SET mrr_snapshot = 0
  FROM clients c
 WHERE c.id = f.client_id
   AND c.client_type <> 'regular'
   AND COALESCE(f.mrr_snapshot, 0) <> 0;

-- ── 6. get_churn_board: was_trial + mrr_snapshot correcto en filas nuevas ────
DROP FUNCTION IF EXISTS public.get_churn_board();

CREATE FUNCTION public.get_churn_board()
RETURNS TABLE(
  client_id uuid, first_name text, last_name text, cognitive_level text,
  frequency integer, schedule text, assigned_days text[],
  stage text, reason text, deactivation_notes text, deactivation_date date,
  mrr_snapshot numeric, assigned_to uuid, assigned_name text,
  days_since integer, note_count integer, is_currently_inactive boolean,
  was_trial boolean, updated_at timestamptz
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
    -- "No se quedó tras la prueba": estuvo a prueba y nunca se convirtió, o se
    -- convirtió después de la baja (p. ej. reintegro posterior).
    -- Espejo exacto de churnedDuringTrial() en commercialStats.js — si cambia una,
    -- cambia la otra.
    COALESCE(
      c.trial_started_at IS NOT NULL
      AND f.deactivation_date IS NOT NULL
      AND (c.trial_converted_at IS NULL OR c.trial_converted_at > f.deactivation_date)
    , false),
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
