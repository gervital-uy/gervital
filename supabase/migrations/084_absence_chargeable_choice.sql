-- Migration 084: is_chargeable elegido por el usuario + permisos admin/superadmin
--
-- Hasta acá register_absence derivaba is_chargeable de la fecha:
--   is_chargeable := NOT (justificada AND futuro AND mes NO pago)
-- Que una falta justificada se cobre (y genere recupero) o se descuente es una
-- concesión comercial, no una consecuencia de cuándo se cargó. Pasa a ser un
-- parámetro; el default "siempre cobrable" vive en la UI, no acá.
--
-- Además: las RPC de asistencia son SECURITY DEFINER, así que saltean la RLS.
-- Esconder el botón en el front no protege nada — la restricción real es este
-- chequeo de rol adentro de cada función.

-- ── 1. Dropear las firmas viejas ───────────────────────────────────────────
-- Agregar un parámetro crea una SOBRECARGA nueva, no reemplaza. Con las dos
-- vivas, PostgREST falla con "function is not unique".
DROP FUNCTION IF EXISTS public.register_absence(uuid, date, boolean, text, text);
DROP FUNCTION IF EXISTS public.register_absence_range(uuid, date, date, boolean, text, text);

-- ── 2. register_absence con la elección ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_absence(
  p_client_id uuid,
  p_date date,
  p_is_justified boolean DEFAULT false,
  p_is_chargeable boolean DEFAULT true,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_record_id UUID; v_credit_id UUID; v_new_balance INTEGER;
  v_is_chargeable BOOLEAN; v_grants_credit BOOLEAN;
  v_clean_notes TEXT; v_has_consumed BOOLEAN;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para registrar faltas');
  END IF;

  v_clean_notes := NULLIF(TRIM(COALESCE(p_notes, '')), '');

  -- Una falta injustificada se cobra siempre: la elección solo aplica a las justificadas.
  v_is_chargeable := (NOT p_is_justified) OR COALESCE(p_is_chargeable, true);
  v_grants_credit := p_is_justified AND v_is_chargeable;

  INSERT INTO attendance_records (client_id, date, status, is_justified, is_chargeable, notes)
  VALUES (p_client_id, p_date, 'absent', p_is_justified, v_is_chargeable, v_clean_notes)
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = 'absent',
    is_justified = EXCLUDED.is_justified,
    is_chargeable = EXCLUDED.is_chargeable,
    notes = EXCLUDED.notes,
    updated_at = NOW()
  RETURNING id INTO v_record_id;

  -- ¿La falta ya tiene un crédito consumido? Entonces su único recupero ya se usó:
  -- no se otorga otro y no se toca nada de créditos.
  SELECT EXISTS (
    SELECT 1 FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'consumed'
  ) INTO v_has_consumed;

  IF NOT v_has_consumed THEN
    -- Re-marca idempotente: revoca cualquier crédito vivo previo de este registro
    DELETE FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available';
    IF v_grants_credit THEN
      INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, note, grant_attendance_id, created_by_name)
      VALUES (p_client_id, p_date, p_date + 30, 'justified_absence', v_clean_notes, v_record_id, p_created_by)
      RETURNING id INTO v_credit_id;
      v_new_balance := _recovery_balance(p_client_id);
      INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
      VALUES (p_client_id, p_date, 1, 'justified_absence', v_record_id, v_new_balance, p_created_by, v_credit_id);
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'isChargeable', v_is_chargeable, 'creditEarned', v_grants_credit AND NOT v_has_consumed);
END;
$function$;

-- ── 3. register_absence_range pasa la elección a cada día ──────────────────
CREATE OR REPLACE FUNCTION public.register_absence_range(
  p_client_id uuid,
  p_from_date date,
  p_to_date date,
  p_is_justified boolean DEFAULT false,
  p_is_chargeable boolean DEFAULT true,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_day DATE; v_day_of_week INTEGER; v_day_name TEXT;
  v_assigned_days TEXT[]; v_count INTEGER := 0;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para registrar faltas');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM client_plans WHERE client_id = p_client_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan no encontrado');
  END IF;
  v_day := p_from_date;
  WHILE v_day <= p_to_date LOOP
    SELECT assigned_days INTO v_assigned_days
    FROM client_plans
    WHERE client_id = p_client_id AND effective_from <= date_trunc('month', v_day)::date
    ORDER BY effective_from DESC LIMIT 1;

    v_day_of_week := EXTRACT(DOW FROM v_day)::INTEGER;
    v_day_name := CASE v_day_of_week
      WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
      WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' ELSE NULL END;
    IF v_day_name IS NOT NULL AND v_assigned_days IS NOT NULL AND v_day_name = ANY(v_assigned_days) THEN
      PERFORM register_absence(p_client_id, v_day, p_is_justified, p_is_chargeable, p_notes, p_created_by);
      v_count := v_count + 1;
    END IF;
    v_day := v_day + INTERVAL '1 day';
  END LOOP;
  RETURN jsonb_build_object('success', true, 'daysMarked', v_count);
END;
$function$;

-- ── 4. Guarda de rol en unregister_absence ──────────────────────────────────
-- Cuerpo real de la migración 068 (sección 7), sin modificar salvo el prólogo
-- de permisos que se agrega al principio del BEGIN.
CREATE OR REPLACE FUNCTION public.unregister_absence(
  p_client_id uuid,
  p_date date,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_record_id UUID; v_had_credit BOOLEAN := false; v_new_balance INTEGER;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para deshacer faltas');
  END IF;

  SELECT id INTO v_record_id FROM attendance_records
  WHERE client_id = p_client_id AND date = p_date AND status = 'absent';
  IF v_record_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No existe falta para este día');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available'
  ) INTO v_had_credit;

  IF v_had_credit THEN
    DELETE FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available';
  END IF;

  -- Hoy/pasado → 'attended'; futuro estricto → 'scheduled' (alineado con 067)
  UPDATE attendance_records SET
    status = CASE WHEN p_date > CURRENT_DATE THEN 'scheduled' ELSE 'attended' END,
    is_justified = NULL,
    is_chargeable = true,
    notes = NULL,
    updated_at = NOW()
  WHERE id = v_record_id;

  IF v_had_credit THEN
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, -1, 'reverted_justified_absence', v_record_id, v_new_balance, p_created_by);
  END IF;

  RETURN jsonb_build_object('success', true, 'creditRevoked', v_had_credit);
END;
$function$;

-- ── 5. Guarda de rol en mark_day_recovery_attended ──────────────────────────
-- Cuerpo real de la migración 017 (línea 294), sin modificar salvo el prólogo
-- de permisos que se agrega al principio del BEGIN.
CREATE OR REPLACE FUNCTION public.mark_day_recovery_attended(p_client_id uuid, p_date date, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_credit_id UUID; v_record_id UUID; v_new_balance INTEGER;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para marcar recuperos');
  END IF;

  SELECT id INTO v_credit_id FROM recovery_credits
  WHERE client_id=p_client_id AND status='available' AND expires_at >= CURRENT_DATE
  ORDER BY expires_at ASC, granted_at ASC
  LIMIT 1 FOR UPDATE;
  IF v_credit_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Sin días de recupero disponibles'); END IF;
  INSERT INTO attendance_records (client_id, date, status) VALUES (p_client_id, p_date, 'recovery')
  ON CONFLICT (client_id, date) DO UPDATE SET status='recovery', updated_at=NOW()
  RETURNING id INTO v_record_id;
  UPDATE recovery_credits SET status='consumed', consumed_at=p_date, consumed_attendance_id=v_record_id, updated_at=NOW()
  WHERE id=v_credit_id;
  v_new_balance := _recovery_balance(p_client_id);
  INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
  VALUES (p_client_id, p_date, -1, 'recovery_attendance', v_record_id, v_new_balance, p_created_by, v_credit_id);
  RETURN jsonb_build_object('success', true, 'recoveryDaysAvailable', v_new_balance);
END;
$function$;

-- ── 6. Guarda de rol en unmark_day_recovery_attended ───────────────────────
-- Cuerpo real de la migración 017 (línea 315), sin modificar salvo el prólogo
-- de permisos que se agrega al principio del BEGIN. La UI ya la esconde, pero
-- la RPC es SECURITY DEFINER: sin esto un operador revierte un recupero.
CREATE OR REPLACE FUNCTION public.unmark_day_recovery_attended(p_client_id uuid, p_date date, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_record_id UUID; v_credit_id UUID; v_new_balance INTEGER;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para deshacer recuperos');
  END IF;

  SELECT id INTO v_record_id FROM attendance_records
  WHERE client_id=p_client_id AND date=p_date AND status='recovery';
  IF v_record_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'No existe recupero para este día'); END IF;
  SELECT id INTO v_credit_id FROM recovery_credits WHERE consumed_attendance_id=v_record_id;
  IF v_credit_id IS NOT NULL THEN
    UPDATE recovery_credits SET status='available', consumed_at=NULL, consumed_attendance_id=NULL, updated_at=NOW()
    WHERE id=v_credit_id;
  ELSE
    INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, created_by_name)
    VALUES (p_client_id, CURRENT_DATE, CURRENT_DATE + 30, 'manual', p_created_by)
    RETURNING id INTO v_credit_id;
  END IF;
  DELETE FROM attendance_records WHERE id=v_record_id;
  v_new_balance := _recovery_balance(p_client_id);
  INSERT INTO recovery_credit_ledger (client_id, date, change, reason, balance_after, created_by_name, credit_id)
  VALUES (p_client_id, p_date, 1, 'reverted_recovery_attendance', v_new_balance, p_created_by, v_credit_id);
  RETURN jsonb_build_object('success', true, 'recoveryDaysAvailable', v_new_balance);
END;
$function$;

-- ── 7. Guarda de rol en add_recovery_credit ────────────────────────────────
-- Cuerpo real de la migración 017 (línea 340). La llama RecoveryCreditsModal,
-- que hasta ahora se abría para cualquier rol.
CREATE OR REPLACE FUNCTION public.add_recovery_credit(p_client_id uuid, p_note text DEFAULT NULL, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_credit_id UUID; v_new_balance INTEGER;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para agregar días de recupero');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clients WHERE id=p_client_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cliente no encontrado');
  END IF;
  INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, note, created_by_name)
  VALUES (p_client_id, CURRENT_DATE, CURRENT_DATE + 30, 'manual', NULLIF(TRIM(p_note), ''), p_created_by)
  RETURNING id INTO v_credit_id;
  v_new_balance := _recovery_balance(p_client_id);
  INSERT INTO recovery_credit_ledger (client_id, date, change, reason, balance_after, created_by_name, credit_id)
  VALUES (p_client_id, CURRENT_DATE, 1, 'manual_add', v_new_balance, p_created_by, v_credit_id);
  RETURN jsonb_build_object('success', true, 'recoveryDaysAvailable', v_new_balance, 'creditId', v_credit_id);
END;
$function$;

-- ── 8. Guarda de rol en revoke_recovery_credit ─────────────────────────────
-- Cuerpo real de la migración 017 (línea 358).
CREATE OR REPLACE FUNCTION public.revoke_recovery_credit(p_credit_id uuid, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_client_id UUID; v_new_balance INTEGER;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para revocar días de recupero');
  END IF;

  UPDATE recovery_credits SET status='revoked', revoked_at=NOW(), updated_at=NOW()
  WHERE id=p_credit_id AND status='available'
  RETURNING client_id INTO v_client_id;
  IF v_client_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Crédito no disponible'); END IF;
  v_new_balance := _recovery_balance(v_client_id);
  INSERT INTO recovery_credit_ledger (client_id, date, change, reason, balance_after, created_by_name, credit_id)
  VALUES (v_client_id, CURRENT_DATE, -1, 'manual_revoke', v_new_balance, p_created_by, p_credit_id);
  RETURN jsonb_build_object('success', true, 'recoveryDaysAvailable', v_new_balance);
END;
$function$;
