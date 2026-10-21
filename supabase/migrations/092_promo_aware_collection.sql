-- ════════════════════════════════════════════════════════════════════════════
-- 092_promo_aware_collection.sql
-- Bug: el cobro masivo del dashboard ("Marcar cobrado") cobraba el mes ancla de
-- una promo prepaga con mark_month_paid y por el valor del mes ($27k en vez del
-- paquete de $81k): dejaba el ancla mal cobrada y los meses 2..N en 'pending'
-- en vez de 'prepaid'. El front ahora cobra el ancla con collect_promo; acá:
--
-- 1. get_month_collection_panel devuelve promo_id (el front lo necesita para
--    llamar a collect_promo). Cambia el RETURNS TABLE → DROP + CREATE. Base: 088.
-- 2. mark_month_paid rechaza los meses que pertenecen a una promo: una promo se
--    cobra entera desde su mes ancla (collect_promo), nunca mes por mes. Así
--    ningún camino (bulk, ficha del cliente, descuento + cobro) puede romperla.
--    Como collect_promo usa mark_month_paid por dentro para snapshotear cada mes,
--    el cuerpo pasa a mark_month_paid_core (interno, sin EXECUTE para clientes)
--    y mark_month_paid queda como capa pública con la guarda. Base: 015.
-- 3. collect_promo llama a mark_month_paid_core. Base: 087, sin otros cambios.
-- 4. Se borra la sobrecarga vieja de 6 argumentos de mark_month_paid (009): nadie
--    la usa y, sin guarda, permitiría saltear (2).
-- month es 0-indexed.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. get_month_collection_panel + promo_id ───────────────────────────────
DROP FUNCTION IF EXISTS public.get_month_collection_panel(integer, integer);

CREATE OR REPLACE FUNCTION public.get_month_collection_panel(p_year integer, p_month integer)
 RETURNS TABLE(
   client_id uuid,
   attendance_net numeric, attendance_gross numeric,
   transport_net numeric, transport_gross numeric,
   payment_status text, invoice_status text, paid_amount numeric, paid_date date,
   invoice_number text, invoiced_at timestamptz, invoice_date date, invoiced_amount numeric,
   cash_collected numeric, promo_index int, promo_total int, promo_percent numeric,
   promo_total_amount numeric, promo_id uuid
 )
 LANGUAGE sql
 STABLE
AS $function$
  SELECT c.id,
    (b->>'attendanceChargeableNet')::numeric, (b->>'attendanceChargeableGross')::numeric,
    (b->>'transportChargeableNet')::numeric, (b->>'transportChargeableGross')::numeric,
    COALESCE(mi.payment_status, 'pending'), COALESCE(mi.invoice_status, 'pending'),
    mi.paid_amount, mi.paid_date, mi.invoice_number, mi.invoiced_at, mi.invoice_date, mi.chargeable_amount,
    COALESCE((
      SELECT SUM(mi2.paid_amount)
      FROM monthly_invoices mi2
      WHERE mi2.client_id = c.id
        AND mi2.payment_status = 'paid'
        AND EXTRACT(YEAR  FROM COALESCE(mi2.paid_date, make_date(mi2.year, mi2.month + 1, 1)))::int     = p_year
        AND EXTRACT(MONTH FROM COALESCE(mi2.paid_date, make_date(mi2.year, mi2.month + 1, 1)))::int - 1 = p_month
    ), 0) AS cash_collected,
    CASE WHEN mi.promo_id IS NOT NULL
      THEN (p_year * 12 + p_month) - (pr.start_year * 12 + pr.start_month) + 1 END AS promo_index,
    CASE WHEN mi.promo_id IS NOT NULL
      THEN (pr.end_year * 12 + pr.end_month) - (pr.start_year * 12 + pr.start_month) + 1 END AS promo_total,
    CASE WHEN mi.promo_id IS NOT NULL THEN mi.discount_percent END AS promo_percent,
    pr.total_amount AS promo_total_amount,
    mi.promo_id
  FROM clients c
  CROSS JOIN LATERAL calculate_month_billing(c.id, p_year, p_month) AS b
  LEFT JOIN monthly_invoices mi ON mi.client_id = c.id AND mi.year = p_year AND mi.month = p_month
  LEFT JOIN promotions pr ON pr.id = mi.promo_id
  WHERE date_trunc('month', c.start_date) <= make_date(p_year, p_month + 1, 1)
    AND c.client_type = 'regular'
    AND (b->>'error') IS NULL
    AND (c.deleted_at IS NULL OR (b->>'totalChargeableGross')::numeric > 0);
$function$;

GRANT EXECUTE ON FUNCTION get_month_collection_panel(INT, INT) TO authenticated;

-- ── 2. mark_month_paid_core: el cuerpo de siempre, sólo para uso interno ───
CREATE OR REPLACE FUNCTION public.mark_month_paid_core(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER,
  p_amount NUMERIC(12,2),
  p_method TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_paid_date DATE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_billing JSONB;
  v_total_gross NUMERIC(12,2);
  v_is_overridden BOOLEAN;
BEGIN
  v_billing := calculate_month_billing(p_client_id, p_year, p_month);
  IF v_billing ? 'error' THEN
    RETURN jsonb_build_object('success', false, 'error', v_billing->>'error');
  END IF;

  v_total_gross := (v_billing->>'totalChargeableGross')::NUMERIC;
  v_is_overridden := p_amount IS DISTINCT FROM v_total_gross AND p_amount IS NOT NULL;

  UPDATE monthly_invoices SET
    payment_status = 'paid',
    paid_at = NOW(),
    paid_date = COALESCE(p_paid_date, CURRENT_DATE),
    paid_amount = COALESCE(p_amount, v_total_gross),
    payment_method = p_method,
    payment_notes = p_notes,
    planned_days = (v_billing->>'plannedDays')::INTEGER,
    chargeable_days = (v_billing->>'chargeableDays')::INTEGER,
    attendance_monthly_rate_net   = (v_billing->>'attendanceMonthlyRateNet')::NUMERIC,
    attendance_monthly_rate_gross = (v_billing->>'attendanceMonthlyRateGross')::NUMERIC,
    attendance_chargeable_net     = (v_billing->>'attendanceChargeableNet')::NUMERIC,
    attendance_chargeable_gross   = (v_billing->>'attendanceChargeableGross')::NUMERIC,
    transport_monthly_rate_net    = (v_billing->>'transportMonthlyRateNet')::NUMERIC,
    transport_monthly_rate_gross  = (v_billing->>'transportMonthlyRateGross')::NUMERIC,
    transport_chargeable_net      = (v_billing->>'transportChargeableNet')::NUMERIC,
    transport_chargeable_gross    = (v_billing->>'transportChargeableGross')::NUMERIC,
    chargeable_amount = v_total_gross,
    monthly_rate = (v_billing->>'attendanceMonthlyRateGross')::NUMERIC,
    is_amount_overridden = v_is_overridden,
    original_chargeable_amount = CASE WHEN v_is_overridden THEN v_total_gross ELSE NULL END,
    updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Factura no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true, 'billing', v_billing);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.mark_month_paid_core(UUID, INTEGER, INTEGER, NUMERIC, TEXT, TEXT, DATE) FROM PUBLIC, anon, authenticated;

-- ── 2b. mark_month_paid: capa pública con la guarda de promo ───────────────
CREATE OR REPLACE FUNCTION public.mark_month_paid(
  p_client_id UUID,
  p_year INTEGER,
  p_month INTEGER,
  p_amount NUMERIC(12,2),
  p_method TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_paid_date DATE DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM monthly_invoices
    WHERE client_id = p_client_id AND year = p_year AND month = p_month
      AND promo_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Este mes es parte de una promo prepaga: la promo se cobra entera desde su mes ancla');
  END IF;

  RETURN public.mark_month_paid_core(p_client_id, p_year, p_month, p_amount, p_method, p_notes, p_paid_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. collect_promo → mark_month_paid_core ────────────────────────────────
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
  PERFORM mark_month_paid_core(pr.client_id, pr.start_year, pr.start_month,
                               v_amount, p_method, p_notes, p_paid_date);

  -- Meses 2..N: mark_month_paid_core primero para dejar snapshotadas las columnas
  -- attendance_*/transport_* (las consume get_dashboard_finance_series), y
  -- después se marcan prepaid en $0.
  FOR m IN
    SELECT year, month FROM monthly_invoices
    WHERE client_id = pr.client_id
      AND (year * 12 + month) BETWEEN v_start_ord + 1 AND v_end_ord
    ORDER BY year, month
  LOOP
    PERFORM mark_month_paid_core(pr.client_id, m.year, m.month, 0, p_method, p_notes, p_paid_date);
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

-- ── 4. Sobrecarga vieja sin guarda ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.mark_month_paid(UUID, INTEGER, INTEGER, NUMERIC, TEXT, TEXT);
