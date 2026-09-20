-- ════════════════════════════════════════════════════════════════════════════
-- 089_promotions_data_cleanup.sql
-- Limpia la basura que dejó el modelo viejo y reexpresa las promos sanas.
--
-- Estado de partida (8 filas): 3 huérfanas sin ningún mes, 1 parcial con un solo
-- mes de su rango, 1 que dice estar cobrada pero con 2 de sus 3 meses en
-- pendiente, y 3 sanas. Todo eso salió del mismo bug raíz: deshacer un cobro o
-- quitar un descuento no limpiaba promo_id, y crear una promo nueva pisaba los
-- meses de la vieja sin avisar.
--
-- Principio: LA PLATA NO SE MUEVE. El total cobrado por cliente es idéntico
-- antes y después. Dentro de una promo íntegramente cobrada se reatribuye al
-- mes en que entró; una promo que no está íntegramente cobrada no se toca, se
-- libera.
--   1. Huérfanas (0 meses) → borrar.
--   2. Inconsistentes → liberar y borrar:
--      - le faltan meses de su propio rango, o
--      - dice estar cobrada (paid_date) pero algún mes no está pago.
--      Liberar = soltar promo_id. Los meses conservan su estado de pago y su
--      plata; sólo se les quita el descuento a los que siguen PENDIENTES, que
--      si no quedarían descontados sin promo que lo respalde.
--   3. Sanas y cobradas → reexpresar: el mes ancla se queda con el paquete
--      entero y los meses 2..N pasan a 'prepaid' en $0.
--   4. Re-asertar el descuento de los meses que sobreviven, por si a alguno le
--      habían sacado el descuento dejando la promo viva.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Huérfanas ───────────────────────────────────────────────────────────
DELETE FROM promotions p
WHERE NOT EXISTS (SELECT 1 FROM monthly_invoices mi WHERE mi.promo_id = p.id);

-- ── 2. Inconsistentes: liberar los meses y borrar la promo ─────────────────
-- El set se define inline y se repite: al soltar promo_id estas promos quedan
-- sin ningún mes, así que las barre el mismo DELETE de huérfanas del final.

-- Un mes pendiente no debe quedar descontado sin promo detrás. Uno ya cobrado
-- conserva su descuento: su paid_amount ya lo refleja y reescribirlo mentiría
-- sobre lo que se cobró.
UPDATE monthly_invoices
SET discount_percent = 0, updated_at = now()
WHERE payment_status = 'pending'
  AND promo_id IN (
    SELECT p.id FROM promotions p
    WHERE (SELECT COUNT(*) FROM monthly_invoices mi WHERE mi.promo_id = p.id)
          <> (p.end_year * 12 + p.end_month) - (p.start_year * 12 + p.start_month) + 1
       OR (p.paid_date IS NOT NULL
           AND EXISTS (SELECT 1 FROM monthly_invoices mi
                       WHERE mi.promo_id = p.id AND mi.payment_status <> 'paid'))
  );

UPDATE monthly_invoices
SET promo_id = NULL, updated_at = now()
WHERE promo_id IN (
  SELECT p.id FROM promotions p
  WHERE (SELECT COUNT(*) FROM monthly_invoices mi WHERE mi.promo_id = p.id)
        <> (p.end_year * 12 + p.end_month) - (p.start_year * 12 + p.start_month) + 1
     OR (p.paid_date IS NOT NULL
         AND EXISTS (SELECT 1 FROM monthly_invoices mi
                     WHERE mi.promo_id = p.id AND mi.payment_status <> 'paid'))
);

DELETE FROM promotions p
WHERE NOT EXISTS (SELECT 1 FROM monthly_invoices mi WHERE mi.promo_id = p.id);

-- ── 3. Reexpresar las sanas ya cobradas ────────────────────────────────────
-- Ancla: se queda con el paquete entero.
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

-- ── 4. Re-asertar el descuento de la promo en sus meses ────────────────────
UPDATE monthly_invoices mi
SET discount_percent = pr.discount_percent, updated_at = now()
FROM promotions pr
WHERE mi.promo_id = pr.id
  AND mi.discount_percent IS DISTINCT FROM pr.discount_percent;
