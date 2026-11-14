-- ════════════════════════════════════════════════════════════════════════════
-- 095_discount_reason.sql
-- Motivo (texto libre, opcional) de una promo prepaga y de un descuento suelto.
--
--   · promotions.reason: el motivo de la promo. NO es promotions.notes, que
--     collect_promo pisa con la nota del cobro (COALESCE(p_notes, notes)).
--   · monthly_invoices.discount_reason: el motivo del descuento suelto, por mes,
--     como discount_percent (no hay entidad "acuerdo de descuento").
--
-- apply_plan_discount y create_prepaid_promo suman p_reason TEXT DEFAULT NULL.
-- Cambiar la lista de parámetros crea una sobrecarga nueva en vez de reemplazar
-- la función, así que se borra la firma vieja primero. Como el parámetro tiene
-- default, el front viejo (que llama sin p_reason) sigue andando.
-- Un motivo vacío o de puros espacios se guarda NULL. Quitar un descuento (0%)
-- borra su motivo; una promo nueva borra el motivo del descuento suelto que
-- reemplaza en sus meses.
--
-- Cuerpos copiados de la 091 (iguales a los vivos), sin otros cambios. Los
-- privilegios quedan como los de la función vieja: los default de Supabase (la
-- 093, sin aplicar, los cierra después).
-- month es 0-indexed.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.monthly_invoices ADD COLUMN IF NOT EXISTS discount_reason TEXT;

DROP FUNCTION IF EXISTS public.apply_plan_discount(UUID, INTEGER, INTEGER, INTEGER, INTEGER, NUMERIC);
DROP FUNCTION IF EXISTS public.create_prepaid_promo(UUID, INTEGER, INTEGER, INTEGER, INTEGER, NUMERIC, TEXT);

CREATE FUNCTION public.apply_plan_discount(
  p_client_id UUID,
  p_start_year INTEGER,
  p_start_month INTEGER,
  p_end_year INTEGER,
  p_end_month INTEGER,
  p_percent NUMERIC,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_start_ord INTEGER;
  v_end_ord INTEGER;
  v_range_count INTEGER;
  v_eligible_count INTEGER;
  v_updated INTEGER;
BEGIN
  IF p_percent < 0 OR p_percent > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El porcentaje debe estar entre 0 y 100');
  END IF;

  v_start_ord := p_start_year * 12 + p_start_month;
  v_end_ord := p_end_year * 12 + p_end_month;

  IF v_end_ord < v_start_ord THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rango inválido');
  END IF;

  v_range_count := v_end_ord - v_start_ord + 1;

  -- Cuántos meses del rango existen y están sin cobrar ni facturar
  SELECT COUNT(*) INTO v_eligible_count
  FROM monthly_invoices
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord
    AND payment_status = 'pending'
    AND invoice_status = 'pending';

  IF v_eligible_count <> v_range_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'El rango debe ser consecutivo y todos los meses deben estar sin cobrar ni facturar');
  END IF;

  -- Quitar (0%) borra también el motivo.
  UPDATE monthly_invoices
  SET discount_percent = p_percent,
      discount_reason = CASE WHEN p_percent > 0 THEN NULLIF(btrim(p_reason), '') END,
      updated_at = now()
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'monthsUpdated', v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.create_prepaid_promo(
  p_client_id UUID,
  p_start_year INTEGER,
  p_start_month INTEGER,
  p_end_year INTEGER,
  p_end_month INTEGER,
  p_percent NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  -- to_char('TMMon') sigue el locale del servidor: los nombres van literales.
  MONTH_NAMES CONSTANT TEXT[] := ARRAY['Ene','Feb','Mar','Abr','May','Jun',
                                       'Jul','Ago','Set','Oct','Nov','Dic'];
  v_start_ord INTEGER;
  v_end_ord INTEGER;
  v_range_count INTEGER;
  v_eligible_count INTEGER;
  v_taken RECORD;
  v_client RECORD;
  v_promo_id UUID;
  v_total NUMERIC(12,2);
  v_discount NUMERIC(12,2);
BEGIN
  IF NOT is_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autorizado');
  END IF;
  IF p_percent <= 0 OR p_percent > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El porcentaje debe estar entre 1 y 100');
  END IF;

  -- Un cliente de baja o no facturable no tiene qué prepagar.
  SELECT deleted_at, client_type INTO v_client FROM clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cliente no encontrado');
  END IF;
  IF v_client.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'El cliente está dado de baja');
  END IF;
  IF v_client.client_type <> 'regular' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Los clientes de beneficencia o a prueba no facturan');
  END IF;

  v_start_ord := p_start_year * 12 + p_start_month;
  v_end_ord := p_end_year * 12 + p_end_month;

  IF v_end_ord < v_start_ord THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rango inválido');
  END IF;

  v_range_count := v_end_ord - v_start_ord + 1;

  -- El rango no puede pisar otra promo viva.
  SELECT mi.year, mi.month INTO v_taken
  FROM monthly_invoices mi
  WHERE mi.client_id = p_client_id
    AND (mi.year * 12 + mi.month) BETWEEN v_start_ord AND v_end_ord
    AND mi.promo_id IS NOT NULL
  ORDER BY mi.year, mi.month
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      MONTH_NAMES[v_taken.month + 1] || ' ' || v_taken.year ||
      ' ya pertenece a otra promo de este cliente. Cancelala primero.');
  END IF;

  SELECT COUNT(*) INTO v_eligible_count
  FROM monthly_invoices
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord
    AND payment_status = 'pending'
    AND invoice_status = 'pending';

  IF v_eligible_count <> v_range_count THEN
    RETURN jsonb_build_object('success', false, 'error',
      'El rango debe ser consecutivo y todos los meses deben estar sin cobrar ni facturar');
  END IF;

  -- Total pactado: EN VIVO, porque monthly_invoices sólo tiene snapshot cuando
  -- el mes fue cobrado o facturado. Se calcula ANTES de escribir nada: si da 0,
  -- no hay promo que crear.
  -- Misma fórmula que el modal (monthTotals en PrepaidPromoModal.jsx) para que
  -- el total pactado coincida exacto con el que vio el usuario: se des-aplica
  -- el descuento suelto que el mes ya tuviera y se aplica el de la promo. El
  -- descuento va SÓLO sobre asistencia; el transporte nunca se descuenta.
  SELECT COALESCE(SUM(m.att_after + m.trans), 0),
         COALESCE(SUM(m.att_base - m.att_after), 0)
    INTO v_total, v_discount
  FROM (
    SELECT ROUND(base.att_base * (1 - p_percent / 100.0)) AS att_after,
           base.att_base, base.trans
    FROM monthly_invoices mi
    CROSS JOIN LATERAL calculate_month_billing(mi.client_id, mi.year, mi.month) AS b
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN COALESCE((b->>'discountPercent')::numeric, 0) > 0
                AND COALESCE((b->>'discountPercent')::numeric, 0) < 100
               THEN ROUND((b->>'attendanceChargeableGross')::numeric
                          / (1 - (b->>'discountPercent')::numeric / 100.0))
               ELSE (b->>'attendanceChargeableGross')::numeric
             END AS att_base,
             (b->>'transportChargeableGross')::numeric AS trans
    ) base
    WHERE mi.client_id = p_client_id
      AND (mi.year * 12 + mi.month) BETWEEN v_start_ord AND v_end_ord
      AND (b->>'error') IS NULL
  ) m;

  IF v_total <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'El rango no tiene monto a cobrar: revisá el plan y los días del cliente');
  END IF;

  INSERT INTO promotions (
    client_id, discount_percent, start_year, start_month, end_year, end_month,
    total_amount, discount_amount, notes, reason, created_by
  ) VALUES (
    p_client_id, p_percent, p_start_year, p_start_month, p_end_year, p_end_month,
    ROUND(v_total), ROUND(v_discount), p_notes, NULLIF(btrim(p_reason), ''), auth.uid()
  ) RETURNING id INTO v_promo_id;

  -- Descuento + etiqueta. NO se toca payment_status: pactar no es cobrar.
  -- El motivo de un descuento suelto que el mes ya tuviera se va con él: el
  -- motivo de la promo vive en promotions.reason.
  UPDATE monthly_invoices
  SET discount_percent = p_percent,
      discount_reason = NULL,
      promo_id = v_promo_id,
      updated_at = now()
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord;

  RETURN jsonb_build_object('success', true, 'promoId', v_promo_id,
    'monthsUpdated', v_range_count, 'totalAmount', ROUND(v_total), 'discountAmount', ROUND(v_discount));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION create_prepaid_promo(UUID, INT, INT, INT, INT, NUMERIC, TEXT, TEXT) TO authenticated;
