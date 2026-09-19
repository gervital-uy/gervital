-- Migration 085: corregir el monto cobrado de un mes ya pago
--
-- Marcar un día como no cobrable (o deshacer esa falta) cambia lo que el mes
-- debería haber costado. Si ya está pago, el monto cobrado queda mal y hasta
-- ahora no había forma de arreglarlo desde la UI.
--
-- La corrección REESCRIBE paid_amount con lo que correspondía cobrar: el
-- sistema pasa a afirmar que el cliente pagó $Y cuando transfirió $X. La
-- diferencia se devuelve por fuera del sistema; el rastro de lo realmente
-- recibido queda en payment_notes.
--
-- Corregir re-snapshotea el mes ENTERO (mismas columnas que mark_month_paid),
-- no sólo el total: el dashboard suma los desgloses net/gross, no paid_amount.

-- ── 1. Marca de "este mes quedó descuadrado" ───────────────────────────────
-- No se deriva comparando contra el recálculo: el recálculo usa los precios
-- VIGENTES HOY, así que un aumento posterior haría aparecer descuadrados todos
-- los meses pagos. Esto registra un hecho puntual, no una comparación que
-- envejece.
ALTER TABLE monthly_invoices
  ADD COLUMN IF NOT EXISTS correction_pending BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Aplicar la corrección ───────────────────────────────────────────────
-- El monto lo recalcula esta función, no lo recibe: si viajara desde el
-- browser, un bug de redondeo en la UI se escribiría como monto cobrado.
CREATE OR REPLACE FUNCTION public.apply_month_billing_correction(
  p_client_id uuid,
  p_year integer,
  p_month integer,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_billing JSONB; v_new NUMERIC(12,2); v_previous NUMERIC(12,2);
  v_note TEXT;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para corregir cobros');
  END IF;

  SELECT paid_amount INTO v_previous FROM monthly_invoices
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;
  IF v_previous IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'El mes no tiene un monto cobrado');
  END IF;

  v_billing := calculate_month_billing(p_client_id, p_year, p_month);
  IF v_billing ? 'error' THEN
    RETURN jsonb_build_object('success', false, 'error', v_billing->>'error');
  END IF;
  v_new := ROUND((v_billing->>'totalChargeableGross')::NUMERIC);

  v_note := format('[%s] Corrección de cobro: %s → %s%s',
    to_char(CURRENT_DATE, 'DD/MM/YYYY'), v_previous, v_new,
    COALESCE(' · ' || p_created_by, ''));

  -- Snapshot COMPLETO del mes, no sólo el total. get_dashboard_finance_series
  -- (052) arma el cobrado sumando attendance_chargeable_* + transport_chargeable_*,
  -- no paid_amount: si acá sólo escribiéramos chargeable_amount, la corrección
  -- nunca llegaría al gráfico y la fila quedaría internamente inconsistente
  -- (chargeable_amount ≠ att_gross + trans_gross). Mismas columnas que escriben
  -- mark_month_paid (015) y mark_month_invoiced (056).
  UPDATE monthly_invoices
  SET planned_days = (v_billing->>'plannedDays')::INTEGER,
      chargeable_days = (v_billing->>'chargeableDays')::INTEGER,
      attendance_monthly_rate_net   = (v_billing->>'attendanceMonthlyRateNet')::NUMERIC,
      attendance_monthly_rate_gross = (v_billing->>'attendanceMonthlyRateGross')::NUMERIC,
      attendance_chargeable_net     = (v_billing->>'attendanceChargeableNet')::NUMERIC,
      attendance_chargeable_gross   = (v_billing->>'attendanceChargeableGross')::NUMERIC,
      transport_monthly_rate_net    = (v_billing->>'transportMonthlyRateNet')::NUMERIC,
      transport_monthly_rate_gross  = (v_billing->>'transportMonthlyRateGross')::NUMERIC,
      transport_chargeable_net      = (v_billing->>'transportChargeableNet')::NUMERIC,
      transport_chargeable_gross    = (v_billing->>'transportChargeableGross')::NUMERIC,
      chargeable_amount = v_new,
      monthly_rate = (v_billing->>'attendanceMonthlyRateGross')::NUMERIC,
      paid_amount = v_new,
      -- Después de corregir, lo cobrado ES lo calculado: ya no hay monto negociado
      -- que preservar. Dejar el flag prendido afirmaría un override que no existe.
      is_amount_overridden = false,
      original_chargeable_amount = NULL,
      payment_notes = TRIM(BOTH E'\n' FROM COALESCE(payment_notes || E'\n', '') || v_note),
      correction_pending = false,
      updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;

  RETURN jsonb_build_object('success', true, 'previousAmount', v_previous, 'newAmount', v_new);
END;
$function$;

-- ── 3. Marcar pendiente (el usuario canceló el modal) ──────────────────────
CREATE OR REPLACE FUNCTION public.flag_month_correction_pending(
  p_client_id uuid,
  p_year integer,
  p_month integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos');
  END IF;

  UPDATE monthly_invoices SET correction_pending = true, updated_at = NOW()
  WHERE client_id = p_client_id AND year = p_year AND month = p_month;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── 4. invoices_view: exponer correctionPending ────────────────────────────
-- Definición vigente verificada contra TODAS las apariciones de invoices_view
-- en supabase/migrations/*.sql (ver reporte de la task): 029_plan_discount.sql
-- es la última migración que crea la vista; nada posterior la toca. Se copia
-- esa definición completa y se le agrega la columna nueva.
DROP VIEW IF EXISTS invoices_view;
CREATE VIEW invoices_view AS
SELECT mi.id, mi.client_id AS "clientId", mi.year, mi.month,
  mi.planned_days AS "plannedDays", mi.chargeable_days AS "chargeableDays",
  mi.chargeable_amount AS "chargeableAmount", mi.monthly_rate AS "monthlyRate",
  mi.attendance_monthly_rate_net AS "attendanceMonthlyRateNet", mi.attendance_monthly_rate_gross AS "attendanceMonthlyRateGross",
  mi.attendance_chargeable_net AS "attendanceChargeableNet", mi.attendance_chargeable_gross AS "attendanceChargeableGross",
  mi.transport_monthly_rate_net AS "transportMonthlyRateNet", mi.transport_monthly_rate_gross AS "transportMonthlyRateGross",
  mi.transport_chargeable_net AS "transportChargeableNet", mi.transport_chargeable_gross AS "transportChargeableGross",
  mi.is_amount_overridden AS "isAmountOverridden", mi.original_chargeable_amount AS "originalChargeableAmount",
  mi.discount_percent AS "discountPercent",
  mi.invoice_status AS "invoiceStatus", mi.invoiced_at AS "invoicedAt",
  mi.invoice_number AS "invoiceNumber", mi.invoice_url AS "invoiceUrl",
  mi.biller_id AS "billerId", mi.biller_serie AS "billerSerie", mi.biller_numero AS "billerNumero",
  mi.biller_hash AS "billerHash", mi.dgi_status AS "dgiStatus", mi.dgi_checked_at AS "dgiCheckedAt",
  mi.emit_error AS "emitError",
  mi.payment_status AS "paymentStatus", mi.paid_at AS "paidAt", mi.paid_date AS "paidDate",
  mi.paid_amount AS "paidAmount", mi.payment_method AS "paymentMethod", mi.payment_notes AS "paymentNotes",
  mi.correction_pending AS "correctionPending",
  mi.created_at AS "createdAt", mi.updated_at AS "updatedAt"
FROM monthly_invoices mi;
ALTER VIEW invoices_view SET (security_invoker = on);
