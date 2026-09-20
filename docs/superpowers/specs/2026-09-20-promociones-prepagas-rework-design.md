# Promociones prepagas — rework

Fecha: 2026-09-20

## Problema

El módulo de promos prepagas (migraciones 060–063) acumuló bugs porque mezcla dos
cosas distintas en un solo acto: **pactar** una promo y **cobrarla**.

Síntomas observados en producción:

1. **Promos huérfanas.** `promotions` tiene 8 filas: 3 con cero meses asociados y 1
   con un solo mes. Se generan al deshacer el cobro y volver a crear la promo:
   `unmarkMonthPaid` y `removePlanDiscount` no limpian `promo_id`, y
   `create_prepaid_promo` no valida que el rango esté libre, así que la promo nueva
   se roba los meses y la vieja queda colgada sin que nada la borre.
2. **Duplicación visual.** `classifyPromotions` mete la misma promo en `active` y en
   `upcoming` cuando termina este mes o el siguiente (`e === ref || e === ref + 1`),
   así que las mismas filas aparecen en las dos columnas del dashboard.
3. **Semántica de pago incorrecta.** Crear la promo marca los N meses como cobrados,
   cada uno con su propio monto. El dinero todavía no entró, y cuando entra no hay
   forma de registrar la fecha real.

## Modelo

### Estados de pago

`monthly_invoices.payment_status` pasa de `('pending','paid')` a
`('pending','paid','prepaid')`:

| estado | significa | `paid_amount` | `paid_date` |
|---|---|---|---|
| `pending` | debe plata | `NULL` | `NULL` |
| `paid` | entró plata | lo que entró | fecha real del pago |
| `prepaid` | cubierto por el pago de otro mes | `0` | `NULL` |

`prepaid` sólo lo produce el cobro de una promo. Ningún flujo manual lo escribe.

### La promo es dueña de su rango

Una promo etiqueta N meses consecutivos (N ≥ 2) con su `promo_id` y su
`discount_percent`. Mientras la promo viva, esos meses no pueden pertenecer a otra:
`create_prepaid_promo` rechaza el solapamiento en vez de pisarlo.

**Crear la promo no cobra nada.** Deja los N meses en `pending` y fija cuánto debe
cada uno:

- **mes 1 (ancla)** → debe el total del paquete (`promotions.total_amount`)
- **meses 2..N** → deben `$0`

Cobrar el mes ancla resuelve el rango entero de forma atómica: ancla → `paid` con la
plata real, meses 2..N → `prepaid` en `$0`.

### Cobro vs facturación

El total del paquete es un concepto de **cobranza**, no de facturación.
`calculate_month_billing` no se toca: la e-factura de cada mes sigue siendo el
servicio de ese mes (con su descuento aplicado). Los meses 2..N se facturan
normalmente aunque no entre plata en ellos.

## Esquema

Migración `086`:

- `monthly_invoices_payment_status_check` → `('pending','paid','prepaid')`
- `promotions.total_amount numeric(12,2) NOT NULL DEFAULT 0` — precio pactado del
  paquete, con descuento, calculado al crear. Es lo que se cobra en el mes ancla.
- `promotions.paid_date` pasa a **nullable**. `NULL` = promo pactada sin cobrar.
- `promotions.paid_amount` pasa a nullable: lo realmente recibido (puede diferir del
  pactado). Se escribe al cobrar.
- `promotions.collected_by uuid` — quién registró el cobro.

`discount_amount` (mig 063) se mantiene con el mismo significado: ahorro real, sólo
asistencia.

## RPC

Cuatro operaciones, todas `SECURITY DEFINER SET search_path = public` y con guarda
`is_superadmin()`. Las firmas viejas se dropean explícitamente antes de recrear
(agregar parámetros crea sobrecargas, no reemplaza).

### `create_prepaid_promo(client, start_y, start_m, end_y, end_m, percent, method, notes)`

Cambia de firma: **se va `p_paid_date`**.

1. Valida rango consecutivo, N ≥ 2, percent en (0,100].
2. Valida que los N meses existan, estén `pending` de pago y de factura, y **que
   ninguno tenga `promo_id`**. Si alguno pertenece a otra promo, error nombrando el
   mes: `"Oct 2026 ya pertenece a otra promo de este cliente. Cancelala primero."`
3. Inserta la promo y etiqueta los meses con `promo_id` + `discount_percent`.
4. Calcula `total_amount` = suma de `calculate_month_billing(...).totalChargeableGross`
   del rango **después** de aplicar el descuento, y `discount_amount` con la fórmula
   ya existente.
5. No toca `payment_status`.

### `collect_promo(promo_id, paid_date, amount, method, notes)`

1. Valida que la promo exista y que ningún mes esté ya `paid`/`prepaid`.
2. Mes ancla: `mark_month_paid(..., p_amount := COALESCE(amount, total_amount), p_paid_date := paid_date)`.
3. Meses 2..N: `mark_month_paid` (para que queden snapshotadas las columnas
   `attendance_*` / `transport_*`, que alimentan la serie financiera) e
   inmediatamente `payment_status = 'prepaid'`, `paid_amount = 0`, `paid_date = NULL`,
   `is_amount_overridden = false`.
4. Sella `promotions.paid_date`, `paid_amount`, `payment_method`, `notes`,
   `collected_by`.

### `uncollect_promo(promo_id)`

Vuelve los N meses a `pending` (limpia `paid_*`, `payment_method`, conservando las
líneas de corrección como hace `unmarkMonthPaid`) y limpia el sello de cobro de la
promo. La promo sigue viva y dueña del rango.

### `cancel_promo(promo_id)`

1. Rechaza si algún mes del rango tiene `invoice_status = 'invoiced'` — no se
   deshace un descuento ya declarado a DGI.
2. Deshace el cobro si lo hubiera (mismo cuerpo que `uncollect_promo`).
3. Limpia `promo_id` y `discount_percent = 0` en los N meses.
4. Borra la fila de `promotions`.

## Contabilidad

### Cobranza y KPIs — cash puro

`get_month_collection_panel` (migración `088`) suma al panel:

- `promo_total_amount` — el pactado, para mostrar el monto a cobrar del mes ancla.
- `payment_status` ahora puede venir `prepaid`; esas filas salen de la pestaña
  "pagos" (no deben nada) y no cuentan en el gauge.
- `cash_collected` ya colapsa por `paid_date` desde la mig 052 y no necesita cambios:
  el ancla aporta los $81.000 en su mes y los `prepaid` aportan 0.

KPI "prepago del mes" pasa a derivarse del cash real (promos con `paid_date` en el
mes) en vez de la fecha declarada al crear.

### Serie Ingresos vs Gastos

El CTE `paid` de `get_dashboard_finance_series` hoy bucketea por el mes de la factura
(`mi.year, mi.month`) filtrando `payment_status = 'paid'`. Con el modelo nuevo eso
dejaría los meses `prepaid` fuera de "cobrado" para siempre.

Se reescribe a **cash real**: se incluyen las filas `paid` y `prepaid`, y cada una se
bucketea por su mes de caja:

```
cash_month = COALESCE(pr.paid_date, mi.paid_date, make_date(mi.year, mi.month+1, 1))
```

donde `pr` es la promo de la fila (join por `promo_id`). Así los tres meses del
paquete aportan sus columnas `attendance_*` / `transport_*` al mes en que entró la
plata: el split neto/bruto y asistencia/transporte queda exacto y el total no cambia.

La base **"previsto"** (CTE `live`) no se toca: cada mes sigue valiendo su propio
servicio devengado.

## Frontend

### Lógica pura — `src/services/promotions/promotionsView.js`

Todo lo derivado vive acá, con tests:

- `promoState(promo, refYear, refMonth)` → **un solo** estado por promo:
  `'upcoming' | 'active' | 'expiring' | 'expired'`. Reemplaza a
  `classifyPromotions`, que devolvía arrays solapados.
- `promoMonthCollection({ promoIndex, promoTotalAmount, monthAmount })` → `{ due, struck }`:
  el monto a cobrar del mes y el nominal a mostrar tachado.
- `promoKpis(promos, refYear, refMonth)` → activas, prepago cobrado en el mes (por
  `paidDate` real), descuento otorgado, por vencer.

### Dashboard — `PromotionsSection.jsx`

Una sola lista con filtros `Todas / Activas / Por vencer / Historial`, ordenada por
urgencia, con sello de estado por fila. Una promo no puede aparecer dos veces porque
`promoState` devuelve un valor.

### Detalle de cliente — `ClientDetail.jsx`

- Badge de mes: `1/3 | 10%` (índice/total + porcentaje) en vez de sólo `−10%`.
- Fila de montos: monto a cobrar (`total_amount` en el ancla, `$0` en el resto) con
  el nominal del mes tachado al lado.
- Badge de pago: `Prepago` en violeta, no accionable, en los meses 2..N. La acción de
  cobro existe sólo en el mes ancla y llama a `collect_promo`.
- El `✕` del badge de promo pasa a "Cancelar promo (Oct–Dic)", con confirmación que
  enumera lo que se deshace.

### Modal de alta — `PrepaidPromoModal.jsx`

Se va el campo "Fecha de pago". El resumen muestra el total del paquete y aclara que
queda **a cobrar** en el primer mes.

### Panel de cobranza — `CollectionPanel.jsx`

Las filas `prepaid` salen de la pestaña "pagos". `promoCashRow` se simplifica: el
tachado ahora sale del estado `prepaid`, no de inferirlo desde `cashCollected === 0`.

## Migración de datos (`089`)

Estado actual: 8 filas.

1. **Borrar 3 huérfanas** (0 meses asociados) y **1 rota** (Walter Ago–Oct, con sólo
   Agosto). El mes de Agosto de Walter conserva su cobro y su descuento pero pierde
   `promo_id`: queda como un mes cobrado con descuento suelto.
2. **Reexpresar las 4 sanas**: `total_amount := paid_amount` (que ya era la suma del
   rango); el mes ancla pasa a `paid_amount = total_amount` con el `paid_date` de la
   promo; los meses 2..N pasan a `prepaid`, `paid_amount = 0`, `paid_date = NULL`.

El total cobrado del club no cambia: la plata se reatribuye al mes en que entró.

## Tests

`promotionsView.test.js` cubre: estado único por promo en los cuatro bordes del
rango, monto a cobrar del ancla vs resto, KPIs con promos cobradas y sin cobrar.

Verificación manual post-migración: el total de `paid_amount` por cliente antes y
después de `089` debe coincidir peso a peso.

## Fuera de alcance

- `calculate_month_billing` y el flujo de facturación electrónica.
- El descuento suelto (`apply_plan_discount`), que es una feature distinta y
  convive sin cambios.
- Editar una promo viva (cambiar %, correr el rango): se cancela y se recrea.
