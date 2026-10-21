-- ════════════════════════════════════════════════════════════════════════════
-- 091_single_month_promos_discounts.sql
-- Descuentos y promos prepagas se pueden aplicar a UN solo mes: se saca la guarda
-- "El rango debe tener al menos 2 meses" de apply_plan_discount y de
-- create_prepaid_promo. Una promo de 1 mes es su propio mes ancla: cobra el
-- paquete (= el mes con descuento) y no deja meses prepaid; collect/uncollect/
-- cancel_promo ya manejan ese caso sin cambios (sus rangos 2..N quedan vacíos).
--
-- Cuerpos copiados de las migraciones más recientes de cada función, sin otros
-- cambios: apply_plan_discount ← 029, create_prepaid_promo ← 090.
-- En apply_plan_discount se va también v_is_removal, que sólo usaba esa guarda.
-- month es 0-indexed.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_plan_discount(
  p_client_id UUID,
  p_start_year INTEGER,
  p_start_month INTEGER,
  p_end_year INTEGER,
  p_end_month INTEGER,
  p_percent NUMERIC
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

  UPDATE monthly_invoices
  SET discount_percent = p_percent,
      updated_at = now()
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'monthsUpdated', v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.create_prepaid_promo(
  p_client_id UUID,
  p_start_year INTEGER,
  p_start_month INTEGER,
  p_end_year INTEGER,
  p_end_month INTEGER,
  p_percent NUMERIC,
  p_notes TEXT DEFAULT NULL
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
    total_amount, discount_amount, notes, created_by
  ) VALUES (
    p_client_id, p_percent, p_start_year, p_start_month, p_end_year, p_end_month,
    ROUND(v_total), ROUND(v_discount), p_notes, auth.uid()
  ) RETURNING id INTO v_promo_id;

  -- Descuento + etiqueta. NO se toca payment_status: pactar no es cobrar.
  UPDATE monthly_invoices
  SET discount_percent = p_percent,
      promo_id = v_promo_id,
      updated_at = now()
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord;

  RETURN jsonb_build_object('success', true, 'promoId', v_promo_id,
    'monthsUpdated', v_range_count, 'totalAmount', ROUND(v_total), 'discountAmount', ROUND(v_discount));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION create_prepaid_promo(UUID, INT, INT, INT, INT, NUMERIC, TEXT) TO authenticated;
