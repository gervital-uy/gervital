-- ════════════════════════════════════════════════════════════════════════════
-- 087_promotion_lifecycle_rpcs.sql
-- Ciclo de vida completo de una promo prepaga. Cuatro operaciones, ninguna
-- ambigua, todas atómicas:
--   create_prepaid_promo  pacta (NO cobra) y se adueña del rango
--   collect_promo         cobra el rango entero: ancla paid + resto prepaid
--   uncollect_promo       deshace el cobro, la promo sigue viva
--   cancel_promo          deshace cobro + descuento + etiqueta, y borra la promo
--
-- La causa raíz de las promos huérfanas era que create no validaba el solape y
-- nada limpiaba promo_id al deshacer: ahora el rango pertenece a la promo y
-- pisarlo es un error explícito.
-- month es 0-indexed.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. Dropear la firma vieja (063) ────────────────────────────────────────
-- Agregar/quitar parámetros crea una sobrecarga nueva: con las dos vivas
-- PostgREST falla con "function is not unique".
DROP FUNCTION IF EXISTS public.create_prepaid_promo(UUID, INT, INT, INT, INT, NUMERIC, DATE, TEXT, TEXT);

-- ── 1. create_prepaid_promo ────────────────────────────────────────────────
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
  v_start_ord INTEGER;
  v_end_ord INTEGER;
  v_range_count INTEGER;
  v_eligible_count INTEGER;
  v_taken RECORD;
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
      to_char(make_date(v_taken.year, v_taken.month + 1, 1), 'TMMon YYYY') ||
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

  INSERT INTO promotions (
    client_id, discount_percent, start_year, start_month, end_year, end_month,
    notes, created_by
  ) VALUES (
    p_client_id, p_percent, p_start_year, p_start_month, p_end_year, p_end_month,
    p_notes, auth.uid()
  ) RETURNING id INTO v_promo_id;

  -- Descuento + etiqueta. NO se toca payment_status: pactar no es cobrar.
  UPDATE monthly_invoices
  SET discount_percent = p_percent,
      promo_id = v_promo_id,
      updated_at = now()
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord;

  -- Total pactado: se recalcula EN VIVO con el descuento ya aplicado, porque
  -- monthly_invoices sólo tiene snapshot cuando el mes fue cobrado o facturado.
  SELECT COALESCE(SUM((b->>'totalChargeableGross')::numeric), 0),
         COALESCE(SUM(
           CASE WHEN p_percent > 0 AND p_percent < 100
             THEN (b->>'attendanceChargeableGross')::numeric / (1 - p_percent / 100.0)
                  - (b->>'attendanceChargeableGross')::numeric
             ELSE 0 END
         ), 0)
    INTO v_total, v_discount
  FROM monthly_invoices mi
  CROSS JOIN LATERAL calculate_month_billing(mi.client_id, mi.year, mi.month) AS b
  WHERE mi.client_id = p_client_id
    AND (mi.year * 12 + mi.month) BETWEEN v_start_ord AND v_end_ord
    AND (b->>'error') IS NULL;

  UPDATE promotions
  SET total_amount = ROUND(v_total), discount_amount = ROUND(v_discount)
  WHERE id = v_promo_id;

  RETURN jsonb_build_object('success', true, 'promoId', v_promo_id,
    'monthsUpdated', v_range_count, 'totalAmount', ROUND(v_total), 'discountAmount', ROUND(v_discount));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION create_prepaid_promo(UUID, INT, INT, INT, INT, NUMERIC, TEXT) TO authenticated;

-- ── 2. collect_promo ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.collect_promo(
  p_promo_id UUID,
  p_paid_date DATE,
  p_amount NUMERIC DEFAULT NULL,
  p_method TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  pr RECORD;
  v_start_ord INTEGER;
  v_end_ord INTEGER;
  v_amount NUMERIC(12,2);
  v_busy INTEGER;
  m RECORD;
BEGIN
  IF NOT is_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autorizado');
  END IF;

  SELECT * INTO pr FROM promotions WHERE id = p_promo_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Promo no encontrada');
  END IF;
  IF pr.paid_date IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'La promo ya está cobrada');
  END IF;
  IF p_paid_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Falta la fecha de pago');
  END IF;

  v_start_ord := pr.start_year * 12 + pr.start_month;
  v_end_ord := pr.end_year * 12 + pr.end_month;
  v_amount := COALESCE(p_amount, pr.total_amount);

  SELECT COUNT(*) INTO v_busy
  FROM monthly_invoices
  WHERE promo_id = p_promo_id AND payment_status <> 'pending';

  IF v_busy > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Hay meses de la promo ya cobrados');
  END IF;

  -- Mes ancla: cobra el paquete entero.
  PERFORM mark_month_paid(pr.client_id, pr.start_year, pr.start_month,
                          v_amount, p_method, p_notes, p_paid_date);

  -- Meses 2..N: mark_month_paid primero para dejar snapshotadas las columnas
  -- attendance_*/transport_* (las consume get_dashboard_finance_series), y
  -- después se marcan prepaid en $0.
  FOR m IN
    SELECT year, month FROM monthly_invoices
    WHERE client_id = pr.client_id
      AND (year * 12 + month) BETWEEN v_start_ord + 1 AND v_end_ord
    ORDER BY year, month
  LOOP
    PERFORM mark_month_paid(pr.client_id, m.year, m.month, 0, p_method, p_notes, p_paid_date);
    UPDATE monthly_invoices
    SET payment_status = 'prepaid',
        paid_amount = 0,
        paid_date = NULL,
        is_amount_overridden = false,
        original_chargeable_amount = NULL,
        updated_at = now()
    WHERE client_id = pr.client_id AND year = m.year AND month = m.month;
  END LOOP;

  UPDATE promotions
  SET paid_date = p_paid_date,
      paid_amount = v_amount,
      payment_method = p_method,
      notes = COALESCE(p_notes, notes),
      collected_by = auth.uid()
  WHERE id = p_promo_id;

  RETURN jsonb_build_object('success', true, 'paidAmount', v_amount,
    'monthsCollected', v_end_ord - v_start_ord + 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION collect_promo(UUID, DATE, NUMERIC, TEXT, TEXT) TO authenticated;

-- ── 3. uncollect_promo ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.uncollect_promo(p_promo_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_invoiced INTEGER;
BEGIN
  IF NOT is_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autorizado');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM promotions WHERE id = p_promo_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Promo no encontrada');
  END IF;

  SELECT COUNT(*) INTO v_invoiced
  FROM monthly_invoices WHERE promo_id = p_promo_id AND invoice_status = 'invoiced';
  IF v_invoiced > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Hay meses ya facturados a DGI: anulá la factura antes de deshacer el cobro');
  END IF;

  UPDATE monthly_invoices
  SET payment_status = 'pending',
      paid_at = NULL,
      paid_date = NULL,
      paid_amount = NULL,
      payment_method = NULL,
      is_amount_overridden = false,
      original_chargeable_amount = NULL,
      updated_at = now()
  WHERE promo_id = p_promo_id;

  UPDATE promotions
  SET paid_date = NULL, paid_amount = NULL, payment_method = NULL, collected_by = NULL
  WHERE id = p_promo_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION uncollect_promo(UUID) TO authenticated;

-- ── 4. cancel_promo ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_promo(p_promo_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_invoiced INTEGER;
  v_months INTEGER;
BEGIN
  IF NOT is_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autorizado');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM promotions WHERE id = p_promo_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Promo no encontrada');
  END IF;

  SELECT COUNT(*) INTO v_invoiced
  FROM monthly_invoices WHERE promo_id = p_promo_id AND invoice_status = 'invoiced';
  IF v_invoiced > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'No se puede cancelar: hay meses ya facturados a DGI');
  END IF;

  UPDATE monthly_invoices
  SET payment_status = 'pending',
      paid_at = NULL,
      paid_date = NULL,
      paid_amount = NULL,
      payment_method = NULL,
      is_amount_overridden = false,
      original_chargeable_amount = NULL,
      discount_percent = 0,
      promo_id = NULL,
      updated_at = now()
  WHERE promo_id = p_promo_id;
  GET DIAGNOSTICS v_months = ROW_COUNT;

  DELETE FROM promotions WHERE id = p_promo_id;

  RETURN jsonb_build_object('success', true, 'monthsCleared', v_months);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION cancel_promo(UUID) TO authenticated;
