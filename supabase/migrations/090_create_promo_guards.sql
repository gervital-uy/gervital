-- ════════════════════════════════════════════════════════════════════════════
-- 090_create_promo_guards.sql
-- Tres agujeros que quedaron a la vista al probar el ciclo completo (mig 087):
--   1. Se podía pactar una promo a un cliente DADO DE BAJA o no facturable
--      (beneficencia / a prueba): sus meses valen $0, así que quedaba un
--      paquete de $0 que después se "cobraba" por $0.
--   2. Aunque el cliente esté activo, si el rango entero suma $0 no hay paquete
--      que cobrar: mejor fallar con un mensaje claro que crear una promo vacía.
--   3. El mes del mensaje de rango ocupado salía en inglés ("Aug 2026"): la
--      máscara TM de to_char depende del lc_time del servidor, no de la app.
--      Se arma con un array literal en español.
--
-- Para poder abortar por (2) sin dejar basura, el total pactado pasa a
-- calcularse ANTES de escribir nada (antes se calculaba después de etiquetar
-- los meses, apoyándose en que el descuento ya estaba aplicado). Como ahora el
-- mes todavía puede traer un descuento suelto viejo, se des-aplica y se aplica
-- el de la promo — misma fórmula que `monthTotals` en PrepaidPromoModal.jsx,
-- así el total pactado coincide exacto con el que vio el usuario en el modal.
-- Base: migración 087.
-- month es 0-indexed.
-- ════════════════════════════════════════════════════════════════════════════

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
  IF v_end_ord = v_start_ord THEN
    RETURN jsonb_build_object('success', false, 'error', 'El rango debe tener al menos 2 meses');
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
