# Promociones prepagas — rework · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar *pactar* una promo prepaga de *cobrarla*, hacer que la promo sea dueña de su rango de meses, y atribuir el cash al mes en que entró.

**Architecture:** `monthly_invoices.payment_status` gana el valor `prepaid`. Crear una promo ya no cobra: etiqueta N meses y fija que el mes ancla debe el total del paquete y los demás $0. Cuatro RPC (`create` / `collect` / `uncollect` / `cancel`) son la única forma de tocar una promo. La serie financiera pasa a bucketear el "cobrado" por fecha de caja.

**Tech Stack:** Supabase/PostgreSQL (migraciones SQL + RPC plpgsql `SECURITY DEFINER`), React 19, CRA + CRACO, Jest (`npx craco test`), Tailwind compilado a mano.

**Spec:** `docs/superpowers/specs/2026-09-20-promociones-prepagas-rework-design.md`

## Global Constraints

- `month` es **0-indexed** en toda la DB y el frontend (0 = enero). Dentro de strings `'YYYY-MM-DD'` el mes es 1-indexed.
- Variables y código en **inglés**, textos de UI en **español**. Sin `;` al final de línea en JS/JSX.
- Fechas: nunca `new Date('YYYY-MM-DD')` ni `toISOString().slice(0,10)`. Usar `src/utils/date.js` (`parseDateOnly`, `todayStr`, `toDateStr`).
- Antes de copiar el cuerpo de cualquier función SQL, `grep -rn "<nombre>" supabase/migrations/*.sql` y usar la aparición de **número más alto**. Nunca transcribir SQL de memoria.
- Agregar un parámetro a una función crea una **sobrecarga nueva**, no la reemplaza: `DROP FUNCTION` explícito de la firma vieja antes de recrear, o PostgREST falla con "function is not unique".
- Las RPC nuevas son `SECURITY DEFINER SET search_path = public` con guarda de rol adentro (saltean RLS).
- Las migraciones se aplican a la base real con `mcp__supabase__apply_migration`, y además se commitea el `.sql` en `supabase/migrations/`.
- Tests: `CI=true npx craco test --testPathPattern "<patrón>" --watchAll=false`. `npx jest` directo **no funciona** (falla con "Cannot use import statement outside a module").
- Si se agregan clases Tailwind nuevas: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.

---

## File Structure

**Migraciones (crear):**
- `supabase/migrations/086_promotions_prepaid_model.sql` — CHECK de `payment_status`, columnas de `promotions`, RLS, `invoices_view` con `promoId`.
- `supabase/migrations/087_promotion_lifecycle_rpcs.sql` — `create_prepaid_promo` (nueva firma), `collect_promo`, `uncollect_promo`, `cancel_promo`.
- `supabase/migrations/088_promo_cash_attribution.sql` — `get_month_collection_panel` + `get_dashboard_finance_series`.
- `supabase/migrations/089_promotions_data_cleanup.sql` — purga de huérfanas y reexpresión de las sanas.

**Lógica pura (modificar):**
- `src/services/promotions/promotionsView.js` — `promoState`, `promoMonthCollection`, `promoKpis`. Se va `classifyPromotions` y `promoCashRow`.
- `src/services/promotions/promotionsView.test.js` — tests de lo anterior.

**Servicios (modificar):**
- `src/services/promotions/promotionService.js` — `createPrepaidPromo` (sin fecha), `collectPromo`, `uncollectPromo`, `cancelPromo`, `getPromotions`, `getClientPromotions`.
- `src/services/api.js` — re-exports.
- `src/services/dashboard/dashboardService.js` — mapear `promo_total_amount`.

**UI (modificar):**
- `src/pages/Clients/ClientDetail.jsx` — badge `n/N | %`, monto del paquete + nominal tachado, badge `Prepago`, cancelar promo.
- `src/pages/Clients/PrepaidPromoModal.jsx` — sacar fecha de pago, mostrar total del paquete.
- `src/pages/Dashboard/sections/PromotionsSection.jsx` — lista única con filtros.
- `src/pages/Dashboard/CollectionPanel.jsx` — `prepaid` fuera de "pagos", tachado desde el estado.

---

### Task 1: Migración 086 — esquema del modelo prepago

**Files:**
- Create: `supabase/migrations/086_promotions_prepaid_model.sql`
- Verify: consultas SQL vía `mcp__supabase__execute_sql`

**Interfaces:**
- Consumes: nada.
- Produces: `payment_status` acepta `'prepaid'`; `promotions.total_amount numeric(12,2) NOT NULL DEFAULT 0`, `promotions.collected_by uuid`, `paid_date`/`paid_amount` nullable; `invoices_view."promoId"`; RLS de `promotions` SELECT para admin+superadmin.

- [ ] **Step 1: Verificar el estado vivo antes de escribir**

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'monthly_invoices'::regclass AND conname LIKE '%payment_status%';

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'promotions' ORDER BY ordinal_position;
```

Esperado: el CHECK es `payment_status IN ('pending','paid')` (mig 009) y `promotions.paid_date` es `NOT NULL`.

- [ ] **Step 2: Escribir la migración**

`supabase/migrations/086_promotions_prepaid_model.sql`:

```sql
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
```

- [ ] **Step 3: Aplicar a la base**

`mcp__supabase__apply_migration` con name `086_promotions_prepaid_model` y el SQL de arriba.

- [ ] **Step 4: Verificar**

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='monthly_invoices'::regclass AND conname='monthly_invoices_payment_status_check';
-- espera: CHECK ((payment_status = ANY (ARRAY['pending','paid','prepaid'])))

SELECT id, total_amount, paid_amount FROM promotions ORDER BY created_at;
-- espera: total_amount = paid_amount en las 8 filas

SELECT relrowsecurity, (SELECT count(*) FROM pg_policies WHERE tablename='promotions') AS policies
FROM pg_class WHERE oid='promotions'::regclass;

SELECT "promoId" FROM invoices_view LIMIT 1;
-- espera: la columna existe (valor puede ser NULL)

SELECT c.reloptions FROM pg_class c WHERE c.relname='invoices_view';
-- espera: {security_invoker=on}
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/086_promotions_prepaid_model.sql
git commit -m "feat(promos): estado prepaid y promo pactada vs cobrada (mig 086)"
```

---

### Task 2: Migración 087 — ciclo de vida de la promo

**Files:**
- Create: `supabase/migrations/087_promotion_lifecycle_rpcs.sql`

**Interfaces:**
- Consumes: Task 1 (`total_amount`, `prepaid`).
- Produces:
  - `create_prepaid_promo(p_client_id uuid, p_start_year int, p_start_month int, p_end_year int, p_end_month int, p_percent numeric, p_notes text)` → `jsonb {success, promoId, monthsUpdated, totalAmount, discountAmount}` · **sin `p_paid_date` ni `p_payment_method`**
  - `collect_promo(p_promo_id uuid, p_paid_date date, p_amount numeric, p_method text, p_notes text)` → `jsonb {success, paidAmount, monthsCollected}`
  - `uncollect_promo(p_promo_id uuid)` → `jsonb {success}`
  - `cancel_promo(p_promo_id uuid)` → `jsonb {success, monthsCleared}`

- [ ] **Step 1: Confirmar la definición vigente que se va a reemplazar**

```bash
grep -rn "create_prepaid_promo" supabase/migrations/*.sql
```

Esperado: 061 y 063. La vigente es la de **063** (la de número más alto). Es la que se dropea.

- [ ] **Step 2: Escribir la migración**

`supabase/migrations/087_promotion_lifecycle_rpcs.sql`:

```sql
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
```

- [ ] **Step 3: Aplicar y verificar que no quedaron sobrecargas**

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('create_prepaid_promo','collect_promo','uncollect_promo','cancel_promo')
ORDER BY 1;
```

Esperado: **exactamente 4 filas**, `create_prepaid_promo` con 7 args (sin `date`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/087_promotion_lifecycle_rpcs.sql
git commit -m "feat(promos): RPC create/collect/uncollect/cancel (mig 087)"
```

---

### Task 3: Migración 088 — atribución del cash

**Files:**
- Create: `supabase/migrations/088_promo_cash_attribution.sql`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `get_month_collection_panel` devuelve además `promo_total_amount numeric`; `get_dashboard_finance_series` bucketea "cobrado" por mes de caja.

- [ ] **Step 1: Confirmar las definiciones vigentes a copiar**

```bash
grep -rln "get_month_collection_panel" supabase/migrations/*.sql   # vigente: 062
grep -rln "get_dashboard_finance_series" supabase/migrations/*.sql # vigente: 028
```

Copiar los cuerpos **desde esos archivos**, no de memoria.

- [ ] **Step 2: Escribir la migración**

`supabase/migrations/088_promo_cash_attribution.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- 088_promo_cash_attribution.sql
-- 1. get_month_collection_panel: + promo_total_amount (el pactado, que es lo
--    que se cobra en el mes ancla). Base: migración 062.
-- 2. get_dashboard_finance_series: el CTE "cobrado" pasa a ser CAJA REAL. Antes
--    bucketeaba por el mes de la factura filtrando payment_status='paid', así
--    que un paquete prepago repartía su plata en los 3 meses. Ahora incluye
--    'paid' y 'prepaid' y bucketea por la fecha en que entró la plata (la del
--    mes ancla, vía promotions). "Previsto" (CTE live) NO cambia: cada mes
--    sigue valiendo su propio servicio devengado. Base: migración 028.
-- month es 0-indexed. Ambas SECURITY INVOKER.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_month_collection_panel(p_year integer, p_month integer)
 RETURNS TABLE(
   client_id uuid,
   attendance_net numeric, attendance_gross numeric,
   transport_net numeric, transport_gross numeric,
   payment_status text, invoice_status text, paid_amount numeric, paid_date date,
   invoice_number text, invoiced_at timestamptz, invoice_date date, invoiced_amount numeric,
   cash_collected numeric, promo_index int, promo_total int, promo_percent numeric,
   promo_total_amount numeric
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
    pr.total_amount AS promo_total_amount
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

CREATE OR REPLACE FUNCTION get_dashboard_finance_series(
  p_from_year  INT,
  p_from_month INT,
  p_to_year    INT,
  p_to_month   INT
)
RETURNS TABLE (
  year             INT,
  month            INT,
  att_net          NUMERIC,
  att_gross        NUMERIC,
  trans_net        NUMERIC,
  trans_gross      NUMERIC,
  paid_att_net     NUMERIC,
  paid_att_gross   NUMERIC,
  paid_trans_net   NUMERIC,
  paid_trans_gross NUMERIC,
  expenses_total   NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT p_from_year * 12 + p_from_month AS lo,
           p_to_year   * 12 + p_to_month   AS hi
  ),
  months AS (
    SELECT (i / 12) AS year, (i % 12) AS month
    FROM bounds, generate_series(bounds.lo, bounds.hi) AS i
  ),
  -- Previsto: live, plan-derived, over clients active & started by each month.
  live AS (
    SELECT m.year, m.month,
      COALESCE(SUM((b->>'attendanceChargeableNet')::numeric), 0)   AS att_net,
      COALESCE(SUM((b->>'attendanceChargeableGross')::numeric), 0) AS att_gross,
      COALESCE(SUM((b->>'transportChargeableNet')::numeric), 0)    AS trans_net,
      COALESCE(SUM((b->>'transportChargeableGross')::numeric), 0)  AS trans_gross
    FROM months m
    JOIN clients c
      ON c.deleted_at IS NULL
     AND date_trunc('month', c.start_date) <= make_date(m.year, m.month + 1, 1)
    CROSS JOIN LATERAL calculate_month_billing(c.id, m.year, m.month) AS b
    WHERE (b->>'error') IS NULL
    GROUP BY m.year, m.month
  ),
  -- Cobrado: CAJA. Cada mes cobrado aporta sus columnas snapshot al mes en que
  -- entró la plata. Un mes 'prepaid' entró con el ancla de su promo.
  cash AS (
    SELECT
      EXTRACT(YEAR FROM cash_date)::int      AS year,
      EXTRACT(MONTH FROM cash_date)::int - 1 AS month,
      attendance_chargeable_net   AS att_net,
      attendance_chargeable_gross AS att_gross,
      transport_chargeable_net    AS trans_net,
      transport_chargeable_gross  AS trans_gross
    FROM (
      SELECT mi.attendance_chargeable_net, mi.attendance_chargeable_gross,
             mi.transport_chargeable_net, mi.transport_chargeable_gross,
             COALESCE(pr.paid_date, mi.paid_date, make_date(mi.year, mi.month + 1, 1)) AS cash_date
      FROM monthly_invoices mi
      LEFT JOIN promotions pr ON pr.id = mi.promo_id
      WHERE mi.payment_status IN ('paid', 'prepaid')
    ) s
  ),
  paid AS (
    SELECT cash.year, cash.month,
      COALESCE(SUM(cash.att_net), 0)   AS paid_att_net,
      COALESCE(SUM(cash.att_gross), 0) AS paid_att_gross,
      COALESCE(SUM(cash.trans_net), 0)   AS paid_trans_net,
      COALESCE(SUM(cash.trans_gross), 0) AS paid_trans_gross
    FROM cash, bounds
    WHERE cash.year * 12 + cash.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY cash.year, cash.month
  ),
  exp AS (
    SELECT e.year, e.month, COALESCE(SUM(e.amount), 0) AS expenses_total
    FROM expenses e, bounds
    WHERE e.year * 12 + e.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY e.year, e.month
  )
  SELECT
    m.year,
    m.month,
    COALESCE(live.att_net, 0),
    COALESCE(live.att_gross, 0),
    COALESCE(live.trans_net, 0),
    COALESCE(live.trans_gross, 0),
    COALESCE(paid.paid_att_net, 0),
    COALESCE(paid.paid_att_gross, 0),
    COALESCE(paid.paid_trans_net, 0),
    COALESCE(paid.paid_trans_gross, 0),
    COALESCE(exp.expenses_total, 0)
  FROM months m
  LEFT JOIN live ON live.year = m.year AND live.month = m.month
  LEFT JOIN paid ON paid.year = m.year AND paid.month = m.month
  LEFT JOIN exp  ON exp.year  = m.year AND exp.month  = m.month
  ORDER BY 1, 2;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_finance_series(INT, INT, INT, INT) TO authenticated;
```

- [ ] **Step 3: Aplicar y verificar**

```sql
SELECT promo_index, promo_total, promo_total_amount
FROM get_month_collection_panel(2026, 8) WHERE promo_index IS NOT NULL LIMIT 3;

SELECT year, month, paid_att_gross, paid_trans_gross
FROM get_dashboard_finance_series(2026, 6, 2026, 11);
```

Antes de la mig 089 el total anual de `paid_att_gross + paid_trans_gross` debe ser el mismo que antes de esta migración (la plata no se crea ni se destruye, sólo se reubica). Guardar el total previo:

```sql
SELECT SUM(paid_att_gross + paid_trans_gross) FROM get_dashboard_finance_series(2026, 0, 2026, 11);
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/088_promo_cash_attribution.sql
git commit -m "feat(promos): cobrado por fecha de caja y promo_total_amount en cobranza (mig 088)"
```

---

### Task 4: Migración 089 — limpieza y reexpresión de datos

**Files:**
- Create: `supabase/migrations/089_promotions_data_cleanup.sql`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `promotions` sin huérfanas; las sanas con el ancla en `paid` por el total y el resto en `prepaid`.

- [ ] **Step 1: Capturar el total cobrado ANTES (para verificar después)**

```sql
SELECT client_id, SUM(paid_amount) AS total
FROM monthly_invoices WHERE payment_status IN ('paid','prepaid')
GROUP BY client_id ORDER BY client_id;
```

Guardar el resultado: debe coincidir peso a peso después de la migración.

- [ ] **Step 2: Escribir la migración**

`supabase/migrations/089_promotions_data_cleanup.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- 089_promotions_data_cleanup.sql
-- Limpia la basura que dejó el modelo viejo y reexpresa las promos sanas.
--   1. Borra promos huérfanas (0 meses asociados) — quedaron al deshacer un
--      cobro y recrear la promo: la nueva se robaba los meses y la vieja
--      quedaba colgada porque nada limpiaba promo_id.
--   2. Suelta las promos parciales (menos meses de los que dice su rango): el
--      mes que conservaban queda cobrado con su descuento pero sin promo_id.
--   3. Reexpresa las sanas: el mes ancla pasa a tener el total del paquete y
--      los meses 2..N pasan a 'prepaid' en $0.
-- El total cobrado por cliente NO cambia: la plata se reatribuye al mes en que
-- efectivamente entró.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Huérfanas ───────────────────────────────────────────────────────────
DELETE FROM promotions p
WHERE NOT EXISTS (SELECT 1 FROM monthly_invoices mi WHERE mi.promo_id = p.id);

-- ── 2. Parciales: la promo no cubre su propio rango ────────────────────────
WITH partial AS (
  SELECT p.id
  FROM promotions p
  WHERE (SELECT COUNT(*) FROM monthly_invoices mi WHERE mi.promo_id = p.id)
        <> (p.end_year * 12 + p.end_month) - (p.start_year * 12 + p.start_month) + 1
)
UPDATE monthly_invoices SET promo_id = NULL, updated_at = now()
WHERE promo_id IN (SELECT id FROM partial);

DELETE FROM promotions p
WHERE NOT EXISTS (SELECT 1 FROM monthly_invoices mi WHERE mi.promo_id = p.id);

-- ── 3. Reexpresar las sanas ya cobradas ────────────────────────────────────
-- Ancla: se queda con todo el paquete.
UPDATE monthly_invoices mi
SET paid_amount = pr.total_amount,
    paid_date = COALESCE(mi.paid_date, pr.paid_date),
    is_amount_overridden = false,
    original_chargeable_amount = NULL,
    updated_at = now()
FROM promotions pr
WHERE mi.promo_id = pr.id
  AND pr.paid_date IS NOT NULL
  AND mi.year = pr.start_year AND mi.month = pr.start_month
  AND mi.payment_status = 'paid';

-- Resto: cubiertos, sin caja propia.
UPDATE monthly_invoices mi
SET payment_status = 'prepaid',
    paid_amount = 0,
    paid_date = NULL,
    is_amount_overridden = false,
    original_chargeable_amount = NULL,
    updated_at = now()
FROM promotions pr
WHERE mi.promo_id = pr.id
  AND pr.paid_date IS NOT NULL
  AND (mi.year * 12 + mi.month) > (pr.start_year * 12 + pr.start_month)
  AND mi.payment_status = 'paid';
```

- [ ] **Step 3: Aplicar y verificar el peso a peso**

```sql
-- a) no quedan huérfanas ni parciales
SELECT p.id, (SELECT COUNT(*) FROM monthly_invoices mi WHERE mi.promo_id = p.id) AS months,
       (p.end_year*12+p.end_month) - (p.start_year*12+p.start_month) + 1 AS expected
FROM promotions p;
-- espera: 4 filas, months = expected en todas

-- b) el total cobrado por cliente no cambió
SELECT client_id, SUM(paid_amount) AS total
FROM monthly_invoices WHERE payment_status IN ('paid','prepaid')
GROUP BY client_id ORDER BY client_id;
-- espera: idéntico al Step 1

-- c) forma nueva
SELECT mi.year, mi.month, mi.payment_status, mi.paid_amount, mi.paid_date
FROM monthly_invoices mi JOIN promotions pr ON pr.id = mi.promo_id
ORDER BY pr.client_id, mi.year, mi.month;
-- espera: por promo, 1 fila 'paid' con el total y N-1 'prepaid' en 0
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/089_promotions_data_cleanup.sql
git commit -m "fix(promos): purga huérfanas y reexpresa las promos al modelo prepago (mig 089)"
```

---

### Task 5: Lógica pura de promociones (TDD)

**Files:**
- Modify: `src/services/promotions/promotionsView.js`
- Test: `src/services/promotions/promotionsView.test.js`

**Interfaces:**
- Consumes: nada (funciones puras).
- Produces:
  - `promoOrdinal(year, month) → number` (sin cambios)
  - `promoState(promo, refYear, refMonth) → 'upcoming' | 'active' | 'expiring' | 'expired'`
  - `promoMonthIndex(promo, year, month) → number | null` — 1-based, `null` fuera del rango
  - `promoMonthCollection({ promoIndex, promoTotalAmount, monthAmount }) → { due, struck }`
  - `promoKpis(promos, refYear, refMonth) → { activeCount, prepaidCashInPeriod, totalDiscountGranted, expiringCount }`
- Se **eliminan** `classifyPromotions` y `promoCashRow`.

- [ ] **Step 1: Reescribir el test**

Reemplazar el contenido de `src/services/promotions/promotionsView.test.js`:

```js
import {
  promoOrdinal, promoState, promoMonthIndex, promoMonthCollection, promoKpis
} from './promotionsView'

// month es 0-indexed (0 = enero), salvo dentro de 'YYYY-MM-DD'.
const promo = (over) => ({
  id: 'p', clientId: 'c', discountPercent: 15,
  startYear: 2026, startMonth: 5, endYear: 2026, endMonth: 7, // 2026-06 .. 2026-08
  paidDate: null, paidAmount: null, totalAmount: 90000, discountAmount: 4500, ...over
})

describe('promoOrdinal', () => {
  test('year*12+month', () => {
    expect(promoOrdinal(2026, 0)).toBe(24312)
    expect(promoOrdinal(2026, 5)).toBe(24317)
  })
})

describe('promoState', () => {
  test('empieza después del ref -> upcoming', () => {
    expect(promoState(promo({ startYear: 2026, startMonth: 9, endYear: 2026, endMonth: 11 }), 2026, 6)).toBe('upcoming')
  })
  test('termina antes del ref -> expired', () => {
    expect(promoState(promo({ startYear: 2026, startMonth: 0, endYear: 2026, endMonth: 2 }), 2026, 6)).toBe('expired')
  })
  test('dentro del rango y lejos del final -> active', () => {
    expect(promoState(promo(), 2026, 5)).toBe('active')
  })
  test('termina en el ref -> expiring', () => {
    expect(promoState(promo(), 2026, 7)).toBe('expiring')
  })
  test('termina en ref+1 -> expiring', () => {
    expect(promoState(promo(), 2026, 6)).toBe('expiring')
  })
  test('devuelve un solo estado: nunca active y expiring a la vez', () => {
    const states = [5, 6, 7].map(m => promoState(promo(), 2026, m))
    expect(states).toEqual(['active', 'expiring', 'expiring'])
  })
})

describe('promoMonthIndex', () => {
  test('1-based dentro del rango', () => {
    expect(promoMonthIndex(promo(), 2026, 5)).toBe(1)
    expect(promoMonthIndex(promo(), 2026, 7)).toBe(3)
  })
  test('null fuera del rango', () => {
    expect(promoMonthIndex(promo(), 2026, 4)).toBeNull()
    expect(promoMonthIndex(promo(), 2026, 8)).toBeNull()
  })
})

describe('promoMonthCollection', () => {
  test('el mes ancla cobra el paquete entero y tacha su nominal', () => {
    expect(promoMonthCollection({ promoIndex: 1, promoTotalAmount: 81000, monthAmount: 27000 }))
      .toEqual({ due: 81000, struck: 27000 })
  })
  test('los meses siguientes no cobran nada', () => {
    expect(promoMonthCollection({ promoIndex: 2, promoTotalAmount: 81000, monthAmount: 27000 }))
      .toEqual({ due: 0, struck: 27000 })
  })
  test('un mes sin promo cobra lo suyo y no tacha nada', () => {
    expect(promoMonthCollection({ promoIndex: null, promoTotalAmount: null, monthAmount: 27000 }))
      .toEqual({ due: 27000, struck: null })
  })
})

describe('promoKpis', () => {
  test('cuenta activas + por vencer y suma el descuento de las vigentes', () => {
    const promos = [
      promo({ id: 'a' }),                                                            // active en 2026-05
      promo({ id: 'b', startYear: 2026, startMonth: 9, endYear: 2026, endMonth: 11 }) // upcoming
    ]
    const k = promoKpis(promos, 2026, 5)
    expect(k.activeCount).toBe(1)
    expect(k.expiringCount).toBe(0)
    expect(k.totalDiscountGranted).toBe(4500)
  })

  test('prepaidCashInPeriod sólo cuenta promos COBRADAS en el mes', () => {
    const promos = [
      promo({ id: 'a', paidDate: '2026-06-05', paidAmount: 90000 }),
      promo({ id: 'b', paidDate: null, paidAmount: null }),            // pactada, sin cobrar
      promo({ id: 'c', paidDate: '2026-07-02', paidAmount: 50000 })    // otro mes
    ]
    expect(promoKpis(promos, 2026, 5).prepaidCashInPeriod).toBe(90000)
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

```bash
CI=true npx craco test --testPathPattern "promotionsView" --watchAll=false
```

Esperado: FAIL — `promoState is not a function`.

- [ ] **Step 3: Reescribir el módulo**

Reemplazar el contenido de `src/services/promotions/promotionsView.js`:

```js
// Helpers puros de promociones. Un mes se identifica por su ordinal:
// year * 12 + month (month 0-indexed).

export function promoOrdinal(year, month) {
  return year * 12 + month
}

const startOrd = (p) => promoOrdinal(p.startYear, p.startMonth)
const endOrd = (p) => promoOrdinal(p.endYear, p.endMonth)

// Estado ÚNICO de una promo respecto de un mes de referencia. Devolver un solo
// valor es lo que impide que la misma promo aparezca en dos listas del dashboard.
// - upcoming: todavía no arrancó
// - expiring: vigente y termina este mes o el próximo (ventana de renovación)
// - active:   vigente, sin urgencia
// - expired:  terminó
export function promoState(promo, refYear, refMonth) {
  const ref = promoOrdinal(refYear, refMonth)
  const s = startOrd(promo)
  const e = endOrd(promo)
  if (s > ref) return 'upcoming'
  if (e < ref) return 'expired'
  return e <= ref + 1 ? 'expiring' : 'active'
}

// Posición 1-based del mes dentro de la promo, o null si cae fuera del rango.
export function promoMonthIndex(promo, year, month) {
  const ord = promoOrdinal(year, month)
  const s = startOrd(promo)
  if (ord < s || ord > endOrd(promo)) return null
  return ord - s + 1
}

// Cuánto se cobra en un mes y qué nominal se muestra tachado al lado.
// El paquete entero se cobra en el mes ancla; el resto de los meses no cobran
// nada porque ya están cubiertos. Un mes sin promo cobra lo suyo.
export function promoMonthCollection({ promoIndex, promoTotalAmount, monthAmount }) {
  const month = Number(monthAmount) || 0
  if (promoIndex == null) return { due: month, struck: null }
  const total = Number(promoTotalAmount) || 0
  return { due: promoIndex === 1 ? total : 0, struck: month }
}

// paidDate 'YYYY-MM-DD' -> ordinal de su mes
const paidOrdinal = (paidDate) => {
  if (!paidDate) return null
  const [y, m] = String(paidDate).slice(0, 10).split('-').map(Number)
  return promoOrdinal(y, m - 1)
}

export function promoKpis(promos, refYear, refMonth) {
  const ref = promoOrdinal(refYear, refMonth)
  const states = (promos || []).map(p => ({ promo: p, state: promoState(p, refYear, refMonth) }))
  const vigentes = states.filter(s => s.state === 'active' || s.state === 'expiring')
  // Cash real: sólo promos efectivamente cobradas en el mes de referencia.
  const prepaidCashInPeriod = (promos || [])
    .filter(p => p.paidDate && paidOrdinal(p.paidDate) === ref)
    .reduce((s, p) => s + (Number(p.paidAmount) || 0), 0)
  // Descuento otorgado: ahorro REAL (sólo asistencia), guardado al crear la promo.
  const totalDiscountGranted = vigentes
    .reduce((s, { promo }) => s + (Number(promo.discountAmount) || 0), 0)
  return {
    activeCount: states.filter(s => s.state === 'active').length,
    prepaidCashInPeriod,
    totalDiscountGranted: Math.round(totalDiscountGranted),
    expiringCount: states.filter(s => s.state === 'expiring').length
  }
}
```

- [ ] **Step 4: Correr y ver pasar**

```bash
CI=true npx craco test --testPathPattern "promotionsView" --watchAll=false
```

Esperado: PASS, todos los describes.

- [ ] **Step 5: Commit**

```bash
git add src/services/promotions/promotionsView.js src/services/promotions/promotionsView.test.js
git commit -m "refactor(promos): estado único por promo y monto a cobrar como lógica pura"
```

---

### Task 6: Servicio de promociones

**Files:**
- Modify: `src/services/promotions/promotionService.js`
- Modify: `src/services/api.js:115-118`
- Modify: `src/services/dashboard/dashboardService.js:229` (mapear `promo_total_amount`)

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  - `createPrepaidPromo(clientId, startYear, startMonth, endYear, endMonth, percent, notes = null)`
  - `collectPromo(promoId, paidDate, amount = null, method = null, notes = null)`
  - `uncollectPromo(promoId)`
  - `cancelPromo(promoId)`
  - `getPromotions()` → filas con `totalAmount`, `paidDate` nullable, `paidAmount` nullable
  - `getClientPromotions(clientId)` → las promos de un cliente
  - fila de cobranza con `promoTotalAmount`

- [ ] **Step 1: Reescribir `promotionService.js`**

```js
import { supabase } from '../supabase/client'

// Fila DB → objeto camelCase.
function fromDb(p, client = {}) {
  return {
    id: p.id,
    clientId: p.client_id,
    firstName: client.firstName || '',
    lastName: client.lastName || '',
    discountPercent: Number(p.discount_percent) || 0,
    discountAmount: Number(p.discount_amount) || 0,
    totalAmount: Number(p.total_amount) || 0,
    startYear: p.start_year,
    startMonth: p.start_month,
    endYear: p.end_year,
    endMonth: p.end_month,
    // null = promo pactada sin cobrar
    paidDate: p.paid_date || null,
    paidAmount: p.paid_amount != null ? Number(p.paid_amount) : null,
    paymentMethod: p.payment_method || null,
    notes: p.notes || null,
    createdAt: p.created_at
  }
}

async function callPromoRpc(fn, params, fallback) {
  const { data, error } = await supabase.rpc(fn, params)
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || fallback)
  return data
}

/**
 * Pactar una promo prepaga (superadmin, validado server-side). NO cobra: deja los
 * meses pendientes, con el total del paquete a cobrar en el primero.
 * @param {number} startMonth - 0-indexed
 */
export async function createPrepaidPromo(clientId, startYear, startMonth, endYear, endMonth, percent, notes = null) {
  return callPromoRpc('create_prepaid_promo', {
    p_client_id: clientId,
    p_start_year: startYear,
    p_start_month: startMonth,
    p_end_year: endYear,
    p_end_month: endMonth,
    p_percent: percent,
    p_notes: notes
  }, 'Error al crear la promoción')
}

/** Cobrar el paquete: el mes ancla queda cobrado y el resto prepago. */
export async function collectPromo(promoId, paidDate, amount = null, method = null, notes = null) {
  return callPromoRpc('collect_promo', {
    p_promo_id: promoId,
    p_paid_date: paidDate,
    p_amount: amount,
    p_method: method,
    p_notes: notes
  }, 'Error al cobrar la promoción')
}

/** Deshacer el cobro. La promo sigue viva y dueña del rango. */
export async function uncollectPromo(promoId) {
  return callPromoRpc('uncollect_promo', { p_promo_id: promoId }, 'Error al deshacer el cobro')
}

/** Cancelar: deshace cobro y descuento, libera los meses y borra la promo. */
export async function cancelPromo(promoId) {
  return callPromoRpc('cancel_promo', { p_promo_id: promoId }, 'Error al cancelar la promoción')
}

/** Todas las promos con nombre del cliente. Admin+superadmin (RLS). */
export async function getPromotions() {
  const [promoRes, clientsRes] = await Promise.all([
    supabase.from('promotions').select('*')
      .order('start_year', { ascending: false })
      .order('start_month', { ascending: false }),
    supabase.from('clients_full').select('id, firstName, lastName')
  ])
  if (promoRes.error) throw new Error(promoRes.error.message)
  if (clientsRes.error) throw new Error(clientsRes.error.message)

  const byId = new Map((clientsRes.data || []).map(c => [c.id, c]))
  return (promoRes.data || []).map(p => fromDb(p, byId.get(p.client_id) || {}))
}

/** Promos de un cliente, para el calendario de su detalle. */
export async function getClientPromotions(clientId) {
  const { data, error } = await supabase
    .from('promotions').select('*')
    .eq('client_id', clientId)
    .order('start_year', { ascending: true })
    .order('start_month', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(p => fromDb(p))
}
```

- [ ] **Step 2: Actualizar el facade**

En `src/services/api.js`, reemplazar el bloque de PROMOTIONS:

```js
export {
  createPrepaidPromo,
  collectPromo,
  uncollectPromo,
  cancelPromo,
  getPromotions,
  getClientPromotions
} from './promotions/promotionService'
```

- [ ] **Step 3: Mapear `promo_total_amount` en la cobranza**

En `src/services/dashboard/dashboardService.js`, dentro del `map` de `getMonthCollectionPanel`, después de `promoPercent`:

```js
      promoTotalAmount: row.promo_total_amount != null ? Number(row.promo_total_amount) : null
```

Y agregar `promoTotalAmount` a la lista de campos del JSDoc de la función.

- [ ] **Step 4: Verificar que nada quedó importando lo viejo**

```bash
grep -rn "classifyPromotions\|promoCashRow" src
```

Esperado: sólo apariciones en archivos que se tocan en las Tasks 7–10. Si aparece alguna fuera de esa lista, arreglarla en esta task.

- [ ] **Step 5: Commit**

```bash
git add src/services/promotions/promotionService.js src/services/api.js src/services/dashboard/dashboardService.js
git commit -m "feat(promos): servicios collect/uncollect/cancel y promo por cliente"
```

---

### Task 7: Calendario del cliente

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

**Interfaces:**
- Consumes: Tasks 5–6 (`promoMonthIndex`, `promoMonthCollection`, `getClientPromotions`, `collectPromo`, `cancelPromo`).
- Produces: nada que consuman otras tasks.

- [ ] **Step 1: Cargar las promos del cliente**

En el `Promise.all` de carga (alrededor de `ClientDetail.jsx:196`) sumar `getClientPromotions(id)` y guardarlo en un state `promotions`. Pasar `promotions` al componente de mes junto con el resto de props (donde hoy se pasa `discountedDays`, ~línea 1383).

Import a agregar:

```js
import { promoMonthIndex, promoMonthCollection } from '../../services/promotions/promotionsView'
import { getClientPromotions, collectPromo, cancelPromo } from '../../services/api'
```

- [ ] **Step 2: Derivar la promo del mes**

Dentro del componente de mes, después del cálculo de `displayAmount` (~`ClientDetail.jsx:1031`):

```js
  // Promo prepaga del mes: el paquete entero se cobra en el primer mes del rango.
  const promo = (promotions || []).find(p => promoMonthIndex(p, year, month) != null) || null
  const promoIndex = promo ? promoMonthIndex(promo, year, month) : null
  const promoTotal = promo ? (promo.endYear * 12 + promo.endMonth) - (promo.startYear * 12 + promo.startMonth) + 1 : null
  const { due: amountDue, struck: struckAmount } = promoMonthCollection({
    promoIndex,
    promoTotalAmount: promo?.totalAmount,
    monthAmount: displayAmount
  })
  const isPrepaid = invoice?.paymentStatus === 'prepaid'
```

- [ ] **Step 3: Badge del título `n/N | %`**

Reemplazar el badge de descuento (`ClientDetail.jsx:1172-1186`, el bloque `invoice?.discountPercent > 0`) por:

```jsx
            {canViewBilling && promo && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 align-middle">
                {promoIndex}/{promoTotal} | {promo.discountPercent}%
                {canCancelPromo && (
                  <button
                    onClick={handleCancelPromo}
                    className="ml-0.5 text-emerald-600 hover:text-emerald-900"
                    title="Cancelar promo"
                  >
                    ✕
                  </button>
                )}
              </span>
            )}
            {canViewBilling && !promo && invoice?.discountPercent > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 align-middle">
                −{invoice.discountPercent}%
                {canRemoveDiscount && (
                  <button
                    onClick={handleRemoveDiscount}
                    className="ml-0.5 text-violet-500 hover:text-violet-800"
                    title="Quitar descuento"
                  >
                    ✕
                  </button>
                )}
              </span>
            )}
```

Con los handlers, junto a `handleRemoveDiscount` (~`ClientDetail.jsx:1158`):

```js
  // Cancelar una promo es destructivo: deshace el cobro del paquete completo.
  const canCancelPromo = !!promo && roleHasAccess(user?.role, 'promotions') && !isInvoiced
  const handleCancelPromo = async () => {
    const range = `${format(new Date(promo.startYear, promo.startMonth, 1), 'MMM yyyy', { locale: es })} – ${format(new Date(promo.endYear, promo.endMonth, 1), 'MMM yyyy', { locale: es })}`
    const warning = promo.paidDate
      ? `Se deshace el cobro de ${formatCurrency(promo.paidAmount || promo.totalAmount)} y los ${promoTotal} meses vuelven a pendiente sin descuento.`
      : `Los ${promoTotal} meses vuelven a pendiente sin descuento.`
    if (!window.confirm(`¿Cancelar la promo ${range}?\n\n${warning}`)) return
    try { await withProcessing(() => cancelPromo(promo.id)) }
    catch (e) { window.alert(e.message) }
  }
```

- [ ] **Step 4: Badge de pago con `Prepago` y cobro del paquete**

En el badge de pago (~`ClientDetail.jsx:1199-1215`), el estado `prepaid` es informativo y no accionable:

```jsx
            <div className="relative flex-1" ref={paymentDropRef}>
              {isPrepaid ? (
                <div
                  className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border bg-violet-50 text-violet-700 border-violet-200"
                  title={`Cubierto por el prepago de ${format(new Date(promo.startYear, promo.startMonth, 1), 'MMMM yyyy', { locale: es })}`}
                >
                  Prepago
                </div>
              ) : (
                <button onClick={() => setPaymentDropOpen(!paymentDropOpen)} /* ...resto igual... */>
```

Y en el ítem "Marcar como cobrado" del dropdown, cuando el mes es el ancla de una promo sin cobrar, el cobro va por `collect_promo`:

```js
  const handleMarkPaid = async (paidDate, amount, method, notes) => {
    if (promo && promoIndex === 1 && !promo.paidDate) {
      return collectPromo(promo.id, paidDate, amount, method, notes)
    }
    return markMonthPaid(client.id, year, month, amount, method, notes, paidDate)
  }
```

El modal de pago debe abrirse con `amountDue` (no `displayAmount`) como monto sugerido.

- [ ] **Step 5: Fila de montos con el nominal tachado**

Reemplazar el bloque del monto (`ClientDetail.jsx:1276-1280`):

```jsx
            {canViewBilling && (
              <span className="ml-auto flex items-baseline gap-1.5">
                <span className="text-base font-bold text-gray-900">{formatCurrency(amountDue)}</span>
                {struckAmount != null && (
                  <span className="text-sm text-gray-400 line-through">{formatCurrency(struckAmount)}</span>
                )}
              </span>
            )}
```

- [ ] **Step 6: Verificar en la app**

Abrir el detalle de un cliente con promo (ej. Victoria Badagián) y confirmar contra la referencia: badge `1/3 | 10%`, mes ancla con el total del paquete y el nominal tachado, meses 2–3 en `$0` con badge `Prepago`.

```bash
grep -rn "displayAmount" src/pages/Clients/ClientDetail.jsx
```

Esperado: `displayAmount` ya no se usa directamente en el render del monto (sólo como insumo de `promoMonthCollection`).

- [ ] **Step 7: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(promos): calendario con paquete, nominal tachado y estado prepago"
```

---

### Task 8: Modal de alta de promo

**Files:**
- Modify: `src/pages/Clients/PrepaidPromoModal.jsx`

**Interfaces:**
- Consumes: Task 6 (`createPrepaidPromo` sin fecha).
- Produces: nada.

- [ ] **Step 1: Sacar la fecha de pago**

- Eliminar el state `paidDate` (`PrepaidPromoModal.jsx:46`), el bloque del input "Fecha de pago" (~líneas 222-227), la validación `if (!paidDate)` (~línea 113) y el `disabled={... || !paidDate}` del botón (~línea 272).
- La llamada pasa a: `await createPrepaidPromo(client.id, s.year, s.month, e.year, e.month, pct, null)`.
- Si el state `method` queda sin uso tras sacar la fecha, eliminarlo también: el método de pago se elige al cobrar.

- [ ] **Step 2: Cambiar el copy del resumen**

El total del paquete deja de ser "pagado" y pasa a ser "a cobrar". Debajo del total, agregar:

```jsx
          <p className="text-xs text-gray-500 mt-1">
            Queda a cobrar en {format(new Date(s.year, s.month, 1), 'MMMM yyyy', { locale: es })}. La promo se registra sin cobrar.
          </p>
```

- [ ] **Step 3: Verificar**

Crear una promo de prueba sobre un cliente sin promo y confirmar que los meses quedan **pendientes**:

```sql
SELECT year, month, payment_status, paid_amount, discount_percent, promo_id
FROM monthly_invoices WHERE promo_id = '<id devuelto>' ORDER BY year, month;
-- espera: 3 filas pending, paid_amount NULL, discount_percent = 10
```

Y que crear otra promo pisando ese rango falle con el mensaje de rango ocupado.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clients/PrepaidPromoModal.jsx
git commit -m "feat(promos): el alta pacta sin cobrar"
```

---

### Task 9: Sección Promociones del dashboard

**Files:**
- Modify: `src/pages/Dashboard/sections/PromotionsSection.jsx`

**Interfaces:**
- Consumes: Task 5 (`promoState`, `promoMonthIndex`, `promoKpis`), Task 6 (`getPromotions`).
- Produces: nada.

- [ ] **Step 1: Reemplazar las tres listas por una sola con filtros**

Reescribir el cuerpo del componente:

```jsx
const STATE_META = {
  expiring: { label: 'vence pronto', cls: 'bg-amber-50 text-amber-700' },
  active: { label: 'al día', cls: 'bg-gray-100 text-gray-500' },
  upcoming: { label: 'por empezar', cls: 'bg-blue-50 text-blue-700' },
  expired: { label: 'finalizada', cls: 'bg-gray-100 text-gray-400' }
}

const FILTERS = [
  { key: 'all', label: 'Todas', states: ['expiring', 'active', 'upcoming', 'expired'] },
  { key: 'active', label: 'Activas', states: ['expiring', 'active'] },
  { key: 'expiring', label: 'Por vencer', states: ['expiring'] },
  { key: 'history', label: 'Historial', states: ['expired'] }
]

// Orden de urgencia: primero lo que vence, al final lo terminado.
const STATE_ORDER = { expiring: 0, active: 1, upcoming: 2, expired: 3 }
```

La lista se arma una sola vez:

```jsx
  const rows = useMemo(() => {
    const withState = (promos || []).map(p => ({ p, state: promoState(p, selected.year, selected.month) }))
    const allowed = FILTERS.find(f => f.key === filter)?.states || []
    return withState
      .filter(r => allowed.includes(r.state))
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        `${a.p.lastName} ${a.p.firstName}`.localeCompare(`${b.p.lastName} ${b.p.firstName}`))
  }, [promos, selected, filter])
```

Cada fila muestra: iniciales, nombre, rango + `%`, badge `n/N` (vía `promoMonthIndex`, oculto si es `null`), sello de estado, y el monto. El monto es `promo.paidAmount ?? promo.totalAmount`, con la aclaración `a cobrar` cuando `paidDate` es `null`.

- [ ] **Step 2: Actualizar los KPI**

`Próximas a vencer` pasa a leer `kpis.expiringCount` (antes `upcomingCount`). `Prepago del mes` ahora es cash real y no cambia de nombre.

- [ ] **Step 3: Verificar que no hay repetidos**

Abrir `/dashboard` → pestaña Promociones en Septiembre 2026. Con el filtro `Todas`, cada cliente-promo aparece **una sola vez**. Contrastar con:

```sql
SELECT count(*) FROM promotions;
```

El número de filas del filtro `Todas` debe ser exactamente ese.

- [ ] **Step 4: Recompilar Tailwind y commitear**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
git add src/pages/Dashboard/sections/PromotionsSection.jsx src/tailwind.output.css
git commit -m "fix(promos): una sola lista con estado por fila en el dashboard"
```

---

### Task 10: Panel de cobranza

**Files:**
- Modify: `src/pages/Dashboard/CollectionPanel.jsx:55-90,199-210`

**Interfaces:**
- Consumes: Tasks 5–6.
- Produces: nada.

- [ ] **Step 1: Sacar los meses prepagos de la pestaña "pagos"**

Un mes `prepaid` no debe plata, así que no es un pago pendiente. En el filtro (`CollectionPanel.jsx:65-68`):

```js
    const filtered = (rows || []).filter(r =>
      tab === 'pagos'
        ? (r.paymentStatus !== 'paid' && r.paymentStatus !== 'prepaid')
        : r.invoiceStatus !== 'invoiced'
    )
```

- [ ] **Step 2: Usar el monto a cobrar en "pagos"**

```js
  const rowAmount = (r) =>
    tab === 'emitidas' ? r.invoicedAmount
    : tab === 'cobrados' ? r.cashCollected
    // Facturar = lo cobrado si el mes ya se cobró (aunque haya diferido del cálculo).
    : tab === 'facturas' ? billableTotal({ paymentStatus: r.paymentStatus, paidAmount: r.paidAmount, liveAmount: r.amount })
    : promoMonthCollection({ promoIndex: r.promoIndex, promoTotalAmount: r.promoTotalAmount, monthAmount: r.amount }).due
```

Import: `import { promoMonthCollection } from '../../services/promotions/promotionsView'` (reemplaza al de `promoCashRow`).

- [ ] **Step 3: Tachado desde el estado, no inferido**

Reemplazar el IIFE del monto (`CollectionPanel.jsx:199-209`):

```jsx
              {(() => {
                // Un mes prepago no aporta caja: su plata entró con el mes ancla.
                if (tab === 'cobrados' && r.paymentStatus === 'prepaid') {
                  return (
                    <span className="flex items-center gap-1.5 tabular-nums flex-shrink-0">
                      <span className="text-xs text-gray-400 line-through opacity-60">{formatCurrency(r.amount)}</span>
                      <span className="text-sm font-semibold text-gray-900">{formatCurrency(0)}</span>
                    </span>
                  )
                }
                return <span className="text-sm font-semibold tabular-nums text-gray-900">{formatCurrency(rowAmount(r))}</span>
              })()}
```

Y en la pestaña `cobrados`, incluir también los prepagos para que se vean:

```js
    if (tab === 'cobrados') {
      return (rows || [])
        .filter(r => r.paymentStatus === 'paid' || r.paymentStatus === 'prepaid')
        .sort((a, b) => String(b.paidDate || '').localeCompare(String(a.paidDate || '')))
    }
```

- [ ] **Step 4: Chequear el bulk de FinanceSection**

En `src/pages/Dashboard/sections/FinanceSection.jsx:147`, el filtro de elegibles para "marcar cobrado" usa `r.paymentStatus !== 'paid'`. Cambiarlo a excluir también `'prepaid'`:

```js
      mode === 'pay' ? (r.paymentStatus !== 'paid' && r.paymentStatus !== 'prepaid') : r.invoiceStatus !== 'invoiced'
```

- [ ] **Step 5: Verificación final de todo el flujo**

```bash
CI=true npx craco test --watchAll=false
npm run build
grep -rn "classifyPromotions\|promoCashRow" src   # debe no devolver nada
```

En la app: el gauge de "Cobrado del mes" de Agosto 2026 debe mostrar los $81.000 de Victoria en Agosto y $0 en Septiembre/Octubre.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Dashboard/CollectionPanel.jsx src/pages/Dashboard/sections/FinanceSection.jsx
git commit -m "fix(cobranza): los meses prepagos salen de pendientes y no aportan caja"
```

---

## Self-Review

**Cobertura del spec:**

| Requisito del spec | Task |
|---|---|
| `payment_status` + `prepaid` | 1 |
| `promotions.total_amount`, `paid_date` nullable | 1 |
| `invoices_view."promoId"` | 1 |
| `create_prepaid_promo` sin cobrar + rechazo de solape | 2 |
| `collect_promo` / `uncollect_promo` / `cancel_promo` | 2 |
| `promo_total_amount` en cobranza | 3 |
| Serie financiera "cobrado" = caja | 3 |
| Purga de huérfanas + reexpresión | 4 |
| `promoState` / `promoMonthCollection` / `promoKpis` | 5 |
| Servicios + facade | 6 |
| Calendario: badge `n/N`, tachado, `Prepago`, cancelar | 7 |
| Modal sin fecha de pago | 8 |
| Dashboard: lista única | 9 |
| Cobranza: prepagos fuera de pendientes | 10 |

**Consistencia de tipos:** `promoMonthCollection({promoIndex, promoTotalAmount, monthAmount})` se usa con esos tres nombres exactos en Tasks 7 y 10. `promoState` devuelve los cuatro literales usados en `STATE_META`/`FILTERS` de la Task 9. La RPC `create_prepaid_promo` tiene 7 parámetros en la Task 2 y el servicio de la Task 6 manda exactamente esos 7.

**Riesgo conocido:** la RLS de `promotions` pasa a admin+superadmin (Task 1) para que el calendario de un admin muestre el paquete correcto; crear/cobrar/cancelar sigue restringido a superadmin dentro de cada RPC.
