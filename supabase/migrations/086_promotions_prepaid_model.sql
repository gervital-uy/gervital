-- ════════════════════════════════════════════════════════════════════════════
-- 086_promotions_prepaid_model.sql
-- Separa pactar una promo prepaga de cobrarla.
--   1. payment_status gana 'prepaid': mes cubierto por el pago de OTRO mes.
--      Invariantes: pending = debe plata; paid = entró plata (paid_amount = lo
--      que entró); prepaid = no debe nada, paid_amount = 0, paid_date = NULL.
--      Sólo lo escribe collect_promo (mig 087).
--   2. promotions.total_amount: precio pactado del paquete (con descuento). Es
--      lo que se cobra en el mes ancla. paid_date/paid_amount pasan a nullable:
--      NULL = promo pactada sin cobrar.
--   3. RLS: SELECT de promotions pasa a admin+superadmin. Quien cobra necesita
--      ver a qué promo pertenece el mes; crear/cancelar sigue siendo superadmin
--      (guarda dentro de las RPC, mig 087).
--   4. invoices_view expone promoId para que el calendario del cliente sepa si
--      el mes pertenece a una promo.
-- month es 0-indexed.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. payment_status: + 'prepaid' ─────────────────────────────────────────
ALTER TABLE monthly_invoices DROP CONSTRAINT IF EXISTS monthly_invoices_payment_status_check;
ALTER TABLE monthly_invoices ADD CONSTRAINT monthly_invoices_payment_status_check
  CHECK (payment_status IN ('pending', 'paid', 'prepaid'));

-- ── 2. promotions: pactado vs cobrado ──────────────────────────────────────
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS total_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collected_by uuid;

-- Las filas existentes ya están cobradas: su paid_amount ERA la suma del rango.
UPDATE public.promotions SET total_amount = paid_amount WHERE total_amount = 0;

ALTER TABLE public.promotions ALTER COLUMN paid_date DROP NOT NULL;
ALTER TABLE public.promotions ALTER COLUMN paid_amount DROP NOT NULL;
ALTER TABLE public.promotions ALTER COLUMN paid_amount DROP DEFAULT;

COMMENT ON COLUMN public.promotions.total_amount IS 'Precio pactado del paquete con descuento; se cobra en el mes ancla';
COMMENT ON COLUMN public.promotions.paid_date IS 'NULL = promo pactada sin cobrar';

-- ── 3. RLS: leer promos = admin+superadmin ─────────────────────────────────
DROP POLICY IF EXISTS "promotions_select_superadmin" ON public.promotions;
DROP POLICY IF EXISTS "promotions_select_admin" ON public.promotions;
CREATE POLICY "promotions_select_admin"
  ON public.promotions FOR SELECT
  USING (is_admin_or_superadmin());

-- ── 4. invoices_view + promoId ─────────────────────────────────────────────
-- Definición copiada de la migración 085 (la aparición de número más alto),
-- agregando sólo mi.promo_id. CREATE OR REPLACE VIEW pierde security_invoker,
-- por eso se re-asierta al final.
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
  mi.promo_id AS "promoId",
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
