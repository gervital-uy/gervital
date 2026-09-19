# Falta justificada: cobrable elegible, corrección de mes pago y permisos

Fecha: 2026-09-19

## Problema

Hoy, al registrar una falta justificada, el sistema **decide solo** si el día se
cobra. La RPC `register_absence` aplica:

```
is_chargeable := NOT (justificada AND futuro AND mes NO pago)
grants_credit := justificada AND is_chargeable
```

Eso genera tres problemas:

1. **La decisión no es del sistema, es del negocio.** Que una falta justificada
   se cobre (y genere recupero) o se descuente es una concesión comercial que se
   decide caso por caso. Hoy depende de en qué día del mes la cargaste, que es
   un proxy equivocado.
2. **Un mes ya cobrado no se puede corregir.** Si se marca un día como no
   cobrable sobre un mes pago, el monto cobrado queda mal y no hay forma de
   arreglarlo desde la UI.
3. **El operador puede registrar faltas.** Registrar una falta mueve plata
   (cobra o descuenta un día, otorga o no un crédito de recupero). No debería
   estar al alcance de un rol operativo.

## Decisiones

| # | Decisión |
|---|---|
| 1 | El tipo de falta justificada es **elegible**: `[cobrable + recupero]` o `[no cobrable (sin recupero)]`. |
| 2 | El default es **siempre** `[cobrable + recupero]`, incluso para una falta futura en un mes no pago. La derivación por fecha desaparece. |
| 3 | Si el mes está pago y el monto cambia, un segundo modal muestra la diferencia y **reescribe el monto cobrado**. La transferencia al cliente se hace por fuera del sistema. |
| 4 | El caso simétrico (deshacer una falta no cobrable en un mes pago, que **sube** el monto) dispara la misma corrección, con el signo invertido. |
| 5 | El modal de corrección se puede **cancelar**. El mes queda marcado como *requiere corrección* hasta que se aplique. |
| 6 | Registrar, deshacer y recuperar días pasa a ser **admin + superadmin**. El operador ve el calendario en solo lectura. |

## Modelo de datos

### `attendance_records`

Sin cambios de esquema. `is_chargeable` pasa de derivado a **elegido**.

### `monthly_invoices`

Una columna nueva:

| Columna | Tipo | Significado |
|---|---|---|
| `correction_pending` | `BOOLEAN NOT NULL DEFAULT false` | El mes está pago por un monto que ya no corresponde. Se prende cuando se detecta la diferencia y el usuario cancela el modal; se apaga al aplicar la corrección. |

**Por qué una columna y no derivarlo.** Lo natural sería derivar "requiere
corrección" comparando el monto pago contra el recálculo. No sirve: el recálculo
usa los precios **vigentes hoy**, y un aumento de precio posterior haría que
todos los meses pagos aparezcan descuadrados. Es exactamente el motivo por el
que `ClientDetail` ya muestra el snapshot y no el cálculo live en los meses
finalizados. La columna registra un hecho puntual ("esta falta descuadró este
mes"), no una comparación que envejece.

## Cambios por capa

### Base de datos

**`register_absence`** — nueva firma con `p_is_chargeable`:

```sql
register_absence(p_client_id, p_date, p_is_justified, p_is_chargeable,
                 p_notes, p_created_by)
```

- Desaparecen `v_is_future`, `v_month_paid` y el cálculo de `v_is_chargeable`.
- Una falta **no justificada** es siempre cobrable: el parámetro se ignora
  (`v_is_chargeable := NOT p_is_justified OR p_is_chargeable`).
- `v_grants_credit := p_is_justified AND v_is_chargeable` se mantiene.

**`register_absence_range`** — mismo parámetro, lo pasa a cada día.

**`unregister_absence`** — sin cambios de firma.

**`apply_month_billing_correction(p_client_id, p_year, p_month, p_created_by)`** — nueva:

- Llama a `calculate_month_billing` y escribe `chargeable_amount` y
  `paid_amount` con el resultado.
- Apendea a `payment_notes` una línea con fecha, monto anterior, monto nuevo y
  quién lo hizo.
- Apaga `correction_pending`.
- Devuelve `{ success, previousAmount, newAmount }`.

**`flag_month_correction_pending(p_client_id, p_year, p_month)`** — nueva:
prende `correction_pending`. Se llama cuando el usuario cancela el modal.

#### Qué significa reescribir `paid_amount`

`paid_amount` es "lo que el cliente pagó". La corrección lo pisa con lo que
**correspondía** cobrar, así que después de aplicarla el sistema afirma que el
cliente pagó $Y cuando en realidad transfirió $X. La diferencia existe en el
mundo real hasta que se devuelve a mano.

Es lo que se pidió ("corregir el monto cobrado") y mantiene un solo número por
mes, que es lo que leen el dashboard y la cobranza. El rastro de lo realmente
recibido queda en la línea de `payment_notes`.

**La alternativa** sería dejar `paid_amount` en $X y corregir solo
`chargeable_amount`, con la diferencia visible como saldo a favor. Sería más
fiel a la realidad contable, pero deja dos números por mes y obliga a decidir
cuál lee cada pantalla. Si en algún momento la devolución deja de hacerse por
fuera, esta es la decisión a revisar primero.

> **Trampa conocida del repo:** agregar un parámetro a una RPC crea una
> **sobrecarga nueva**, no la reemplaza. Las firmas viejas de `register_absence`
> y `register_absence_range` hay que **dropearlas explícitamente** o el próximo
> llamado falla con *"function is not unique"*.

### Permisos (lo que realmente protege)

Las cuatro RPC de asistencia son `SECURITY DEFINER`, así que **saltean la RLS**:
esconder el botón en el front no protege nada. Cada una arranca con:

```sql
IF NOT is_admin_or_superadmin() THEN
  RETURN jsonb_build_object('success', false, 'error', 'Sin permisos');
END IF;
```

Aplica a `register_absence`, `register_absence_range`, `unregister_absence`,
`mark_day_recovery_attended` y las dos nuevas.

### Frontend

**`FEATURE_ROLES`** (`AuthContext.jsx`): `attendance_edit: ['admin', 'superadmin']`.

**`absenceModel.js`** — `deriveAbsence` hoy es el espejo puro de la fórmula que
desaparece. Pasa a describir la elección:

```js
deriveAbsence({ isJustified, isChargeable })
  → { status: 'absent', isJustified, isChargeable, generatesCredit }
```

`outcomePreview` lee la elección en vez de la fecha. Los parámetros `date`,
`today` y `monthPaid` se van, junto con sus tests.

**`AbsenceModal`** — bajo "Justificada", un selector de dos opciones:

```
( • Cobrable + recupero )  ( ○ No cobrable, sin recupero )
```

Default en la primera, siempre. El texto de resultado que ya existe
(`outcomePreview`) sigue abajo, reflejando la elección.

**`MonthBillingCorrectionModal`** — nuevo:

```
Este mes está pago por $ 12.400
Con este cambio corresponde   $ 11.600
Diferencia a favor del cliente  $ 800

La transferencia se hace por fuera del sistema.
[ Cancelar ]  [ Corregir monto cobrado ]
```

Con el signo invertido cuando el monto sube ("el cliente debe $800").

**`MonthCard`** — badge *requiere corrección* cuando `correction_pending`, que
abre el mismo modal.

**`ClientDetail`** — `handleDayClick` sale temprano sin `attendance_edit`, y los
días pierden el `cursor-pointer` y el hover. La leyenda y los tooltips quedan:
el operador sigue leyendo el calendario para coordinar Grupos y Transporte.

## Flujos

### Registrar una falta no cobrable sobre un mes pago

```
Usuario elige [no cobrable] → confirma
         │
         ▼
  register_absence(is_chargeable = false)
         │
         ▼
  front recalcula con calculate_month_billing
         │
    ¿mes pago y monto ≠ paid_amount?
         │
    ┌────┴────┐
   no        sí
    │         │
   fin   modal de corrección
              │
         ┌────┴────┐
     cancelar   confirmar
         │         │
  flag_month_   apply_month_billing_
  correction_   correction
  pending       (badge apagado)
```

**El número que se persiste nunca viaja desde el browser.** El front recalcula
solo para *mostrar* la diferencia; la RPC de corrección vuelve a llamar a
`calculate_month_billing` y escribe su propio resultado. Si el front mandara el
monto, un bug de redondeo en la UI se escribiría como monto cobrado.

### Deshacer una falta no cobrable sobre un mes pago

Idéntico, disparado desde `unregister_absence`. El monto sube y la diferencia se
muestra como deuda del cliente.

## Casos borde

| Caso | Comportamiento |
|---|---|
| Falta **no justificada** | Siempre cobrable, sin recupero. El selector no se muestra. |
| Rango de días con `[no cobrable]` | Cada día se registra igual; la corrección se evalúa **una vez por mes tocado**, al final, no por día. |
| Rango que **cruza meses** | Puede descuadrar más de un mes pago. El modal se abre encadenado, un mes por vez, en orden cronológico; cancelar uno marca ese mes y sigue con el siguiente. |
| Mes **facturado pero no pago** | No hay monto cobrado que corregir: no se dispara el modal. La factura electrónica ya emitida se resuelve por fuera. |
| Mes pago y monto **sin cambio** | No se dispara nada (el día ya era no cobrable, o el prorrateo cae en el mismo escalón). |
| Operador con la URL directa | La RPC responde `{ success: false, error: 'Sin permisos' }`. El front ya muestra ese error. |
| Cliente no facturable (beneficencia / prueba) | No tiene `monthly_invoices`: nunca hay corrección. |

## Testing

Lógica pura (`absenceModel.test.js`), reescrita para la elección:

- `generatesCredit` sii justificada ∧ cobrable — las cuatro combinaciones.
- No justificada ignora `isChargeable`.
- `outcomePreview` para cada combinación.

Nuevo `billingCorrection.js` + tests (puro, sin Supabase):

- Decide si corresponde abrir el modal: `shouldPromptCorrection({ isPaid, paidAmount, recalculated })`.
- Diferencia y dirección (a favor del cliente / deuda).
- Sin cambio → no promptea. Mes no pago → no promptea.
- Tolerancia: la comparación es sobre enteros redondeados, no flotantes.

Permisos: `roleHasAccess('operador', 'attendance_edit') === false` y los dos
roles altos en `true`.

## Qué NO cambia

- El cálculo de facturación (`calculate_month_billing`) y el de precios.
- El modelo de créditos de recupero: vencimiento a 30 días, balance derivado.
- La emisión en Biller. Una corrección sobre un mes ya facturado **no** reemite
  ni anula la factura electrónica; eso se resuelve por fuera.
- El dashboard financiero: lee `monthly_invoices`, así que toma la corrección
  sola sin cambios de código.

## Riesgos

1. **El default cambia de signo.** Hasta hoy, avisar una falta futura la dejaba
   sin cobrar. Desde ahora se cobra y suma recupero salvo que se elija lo otro.
   Es lo pedido, pero invierte el resultado del caso más frecuente y conviene
   avisarle al equipo.
2. **`correction_pending` puede quedar viejo.** Si se prende y después se
   deshace la falta que lo causó, el badge queda encendido sin diferencia real.
   Mitigación: al abrir el modal se recalcula, y si no hay diferencia se apaga
   el flag y se avisa que ya está al día.
3. **Dropear las firmas viejas de las RPC es obligatorio.** Si la migración solo
   hace `CREATE OR REPLACE`, quedan dos sobrecargas y PostgREST falla con
   *"function is not unique"* — ya pasó en este repo con `create_client_full`.
