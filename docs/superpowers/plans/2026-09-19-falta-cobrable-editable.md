# Falta cobrable elegible, corrección de mes pago y permisos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el usuario elija si una falta justificada se cobra (y genera recupero) o no, que un mes ya pago cuyo monto cambió se pueda corregir desde la UI, y que registrar/deshacer faltas y recuperos quede restringido a admin y superadmin.

**Architecture:** La derivación por fecha de `is_chargeable` desaparece de la RPC `register_absence` y pasa a ser un parámetro elegido en el modal, con default siempre "cobrable + recupero". Cuando un cambio descuadra un mes pago, el front detecta la diferencia recalculando con `calculate_month_billing` y abre un modal de confirmación; el monto que se persiste lo vuelve a calcular el servidor, nunca viaja desde el browser. Los permisos se refuerzan dentro de cada RPC porque son `SECURITY DEFINER` y saltean la RLS.

**Tech Stack:** React 19 + CRA/CRACO, Tailwind (compilación manual), Supabase (PostgreSQL + PostgREST), Jest via `craco test`.

**Spec:** `docs/superpowers/specs/2026-09-19-falta-cobrable-editable-design.md`

## Global Constraints

- Variables y código en **inglés**; textos de UI en **español**.
- **No usar `;`** en JS/JSX cuando no es obligatorio.
- Fechas: nunca `new Date('YYYY-MM-DD')` ni `toISOString().slice(0,10)`. Usar `parseDateOnly`, `todayStr`, `toDateStr` de `src/utils/date.js`.
- Tests: `CI=true npx craco test --testPathPattern "<patrón>" --watchAll=false`. `npx jest` directo **falla** (ESM sin transformar).
- Tailwind se compila a mano: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`. Clases nuevas no existen hasta recompilar, y `npm run build` no lo detecta.
- Agregar un parámetro a una RPC crea una **sobrecarga nueva**. Toda migración que cambie una firma debe `DROP FUNCTION` la vieja explícitamente, o PostgREST falla con *"function is not unique"*.
- `CREATE OR REPLACE VIEW` / `DROP VIEW` + `CREATE VIEW` **pierde** `security_invoker`. Reasertar `ALTER VIEW ... SET (security_invoker = on)` en la misma migración.
- La migración más alta hoy es `083_director_contribution.sql`. Las nuevas arrancan en `084`.
- Las migraciones **no se aplican** a la base como parte de este plan. Se escriben, se commitean, y al final se le pregunta al usuario si las aplica.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/services/attendance/absenceModel.js` | **Modificar.** `deriveAbsence` y `outcomePreview` pasan de derivar por fecha a describir la elección. |
| `src/services/attendance/absenceModel.test.js` | **Modificar.** Reescribir los tests de `deriveAbsence`/`outcomePreview`. |
| `src/services/invoices/billingCorrection.js` | **Crear.** Lógica pura: ¿corresponde corregir?, diferencia y dirección. |
| `src/services/invoices/billingCorrection.test.js` | **Crear.** Tests de lo anterior. |
| `src/context/AuthContext.jsx` | **Modificar.** Feature `attendance_edit`. |
| `src/context/authAccess.test.js` | **Crear.** Tests de `roleHasAccess` para la feature nueva. |
| `supabase/migrations/084_absence_chargeable_choice.sql` | **Crear.** Nueva firma de `register_absence`/`register_absence_range` + guardas de rol en las cuatro RPC de asistencia. |
| `supabase/migrations/085_month_billing_correction.sql` | **Crear.** Columna `correction_pending`, las dos RPC nuevas, `invoices_view`. |
| `src/services/attendance/attendanceService.js` | **Modificar.** `registerAbsence`/`registerAbsenceRange` pasan `isChargeable`. |
| `src/services/invoices/invoiceService.js` | **Modificar.** `applyMonthBillingCorrection`, `flagMonthCorrectionPending`, mapear `correctionPending`. |
| `src/services/api.js` | **Modificar.** Re-exportar lo nuevo. |
| `src/pages/Clients/AbsenceChargeableChoice.jsx` | **Crear.** El selector de dos opciones, aislado del modal grande. |
| `src/pages/Clients/MonthBillingCorrectionModal.jsx` | **Crear.** El modal de corrección. |
| `src/pages/Clients/ClientDetail.jsx` | **Modificar.** Wiring del selector, del modal encadenado y del gate de permisos. |

`ClientDetail.jsx` ya tiene ~1700 líneas. Los dos componentes nuevos van a archivos propios en vez de sumarse ahí: son autocontenidos y así el archivo grande no crece más.

---

### Task 1: `absenceModel` pasa de derivar a describir

La fórmula `is_chargeable := NOT (justificada AND futuro AND mes NO pago)` desaparece. `deriveAbsence` ya no mira la fecha: recibe la elección.

**Files:**
- Modify: `src/services/attendance/absenceModel.js`
- Test: `src/services/attendance/absenceModel.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `deriveAbsence({ isJustified: boolean, isChargeable: boolean }) → { status: 'absent', isJustified: boolean, isChargeable: boolean, generatesCredit: boolean }`
  - `outcomePreview({ isJustified: boolean, isChargeable: boolean }) → string`
  - `dayStyle` y `dayTooltip` quedan **sin cambios**.

- [ ] **Step 1: Reescribir el bloque `deriveAbsence` del test**

En `src/services/attendance/absenceModel.test.js`, reemplazar el `describe('deriveAbsence', ...)` completo (y la constante `TODAY` de arriba, que deja de usarse) por:

```js
describe('deriveAbsence', () => {
  test('injustificada: siempre cobrable, nunca crédito', () => {
    expect(deriveAbsence({ isJustified: false, isChargeable: true }))
      .toEqual({ status: 'absent', isJustified: false, isChargeable: true, generatesCredit: false })
  })

  test('injustificada ignora isChargeable=false: el día se cobra igual', () => {
    expect(deriveAbsence({ isJustified: false, isChargeable: false }))
      .toEqual({ status: 'absent', isJustified: false, isChargeable: true, generatesCredit: false })
  })

  test('justificada cobrable: +1 crédito', () => {
    expect(deriveAbsence({ isJustified: true, isChargeable: true }))
      .toEqual({ status: 'absent', isJustified: true, isChargeable: true, generatesCredit: true })
  })

  test('justificada no cobrable: sin crédito', () => {
    expect(deriveAbsence({ isJustified: true, isChargeable: false }))
      .toEqual({ status: 'absent', isJustified: true, isChargeable: false, generatesCredit: false })
  })

  test('el crédito sale sii justificada y cobrable', () => {
    const credito = (j, c) => deriveAbsence({ isJustified: j, isChargeable: c }).generatesCredit
    expect([credito(true, true), credito(true, false), credito(false, true), credito(false, false)])
      .toEqual([true, false, false, false])
  })
})
```

Y el `describe('outcomePreview', ...)` completo por:

```js
describe('outcomePreview', () => {
  test('injustificada', () => {
    expect(outcomePreview({ isJustified: false, isChargeable: true }))
      .toBe('Se cobra el día igual. Sin crédito de recupero.')
  })

  test('justificada cobrable', () => {
    expect(outcomePreview({ isJustified: true, isChargeable: true }))
      .toBe('Se cobra el día y se acredita 1 día de recupero.')
  })

  test('justificada no cobrable', () => {
    expect(outcomePreview({ isJustified: true, isChargeable: false }))
      .toBe('No se cobra el día (sin recupero).')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `CI=true npx craco test --testPathPattern "absenceModel" --watchAll=false`
Expected: FAIL. `deriveAbsence` devuelve `isChargeable: false` para `{isJustified: false, isChargeable: false}` porque todavía calcula `!(isJustified && isFuture && !monthPaid)` con `date`/`today` en `undefined`.

- [ ] **Step 3: Reescribir `deriveAbsence` y `outcomePreview`**

En `src/services/attendance/absenceModel.js`, reemplazar el comentario de cabecera y las dos funciones:

```js
/**
 * Lógica pura del modelo unificado de faltas. Toda falta es status 'absent',
 * descrita por is_justified + is_chargeable.
 *
 * `is_chargeable` lo ELIGE el usuario en el modal, ya no se deriva de la fecha:
 * que una falta justificada se cobre o se descuente es una concesión comercial,
 * no una consecuencia de cuándo se cargó. El default de la UI es siempre
 * cobrable. Espejo exacto de la RPC register_absence.
 */

/**
 * @param {{ isJustified: boolean, isChargeable: boolean }} p
 * @returns {{ status: 'absent', isJustified: boolean, isChargeable: boolean, generatesCredit: boolean }}
 */
export function deriveAbsence({ isJustified, isChargeable }) {
  // Una falta injustificada se cobra siempre: la elección solo aplica a las justificadas.
  const chargeable = !isJustified || !!isChargeable
  return {
    status: 'absent',
    isJustified: !!isJustified,
    isChargeable: chargeable,
    generatesCredit: !!isJustified && chargeable
  }
}
```

Y reemplazar `outcomePreview` por:

```js
/** Texto predecible del resultado, para el modal de registro de falta. */
export function outcomePreview({ isJustified, isChargeable }) {
  if (!isJustified) return 'Se cobra el día igual. Sin crédito de recupero.'
  return isChargeable
    ? 'Se cobra el día y se acredita 1 día de recupero.'
    : 'No se cobra el día (sin recupero).'
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `CI=true npx craco test --testPathPattern "absenceModel" --watchAll=false`
Expected: PASS, todos los bloques (`deriveAbsence`, `dayStyle`, `dayTooltip`, `outcomePreview`).

- [ ] **Step 5: Verificar que nadie más llama con la firma vieja**

Run: `grep -rn "outcomePreview\|deriveAbsence" src/ --include=*.js --include=*.jsx`
Expected: solo `absenceModel.js`, su test, y `ClientDetail.jsx:~1580` (la llamada `outcomePreview({ isJustified: ..., date, today: todayStr, monthPaid: !!isPaid })`). Esa llamada se arregla en la Task 7 — anotarlo y seguir. El build todavía no se corre porque quedaría inconsistente.

- [ ] **Step 6: Commit**

```bash
git add src/services/attendance/absenceModel.js src/services/attendance/absenceModel.test.js
git commit -m "refactor(faltas): is_chargeable pasa de derivado por fecha a elegido"
```

---

### Task 2: Lógica pura de la corrección de mes pago

Decide si hay que abrir el modal y cuánto es la diferencia. Puro, sin Supabase, para poder testearlo sin red.

**Files:**
- Create: `src/services/invoices/billingCorrection.js`
- Test: `src/services/invoices/billingCorrection.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `shouldPromptCorrection({ isPaid: boolean, paidAmount: number|null, recalculatedAmount: number }) → boolean`
  - `correctionDelta({ paidAmount: number, recalculatedAmount: number }) → { amount: number, direction: 'refund' | 'debt' }` — `amount` siempre positivo; `refund` = el cliente pagó de más.

- [ ] **Step 1: Escribir el test**

Crear `src/services/invoices/billingCorrection.test.js`:

```js
import { shouldPromptCorrection, correctionDelta } from './billingCorrection'

describe('shouldPromptCorrection', () => {
  test('mes pago con monto distinto: corresponde corregir', () => {
    expect(shouldPromptCorrection({ isPaid: true, paidAmount: 12400, recalculatedAmount: 11600 })).toBe(true)
  })

  test('mes pago con el mismo monto: no molesta', () => {
    expect(shouldPromptCorrection({ isPaid: true, paidAmount: 12400, recalculatedAmount: 12400 })).toBe(false)
  })

  test('mes no pago: nunca corrige, no hay monto cobrado', () => {
    expect(shouldPromptCorrection({ isPaid: false, paidAmount: null, recalculatedAmount: 11600 })).toBe(false)
  })

  test('mes pago sin paidAmount registrado: no corrige', () => {
    // Dato viejo sin monto: no hay contra qué comparar, no se inventa una diferencia.
    expect(shouldPromptCorrection({ isPaid: true, paidAmount: null, recalculatedAmount: 11600 })).toBe(false)
  })

  test('compara redondeado a peso, no en flotante', () => {
    expect(shouldPromptCorrection({ isPaid: true, paidAmount: 11600.4, recalculatedAmount: 11600 })).toBe(false)
    expect(shouldPromptCorrection({ isPaid: true, paidAmount: 11601, recalculatedAmount: 11600 })).toBe(true)
  })
})

describe('correctionDelta', () => {
  test('pagó de más: a favor del cliente', () => {
    expect(correctionDelta({ paidAmount: 12400, recalculatedAmount: 11600 }))
      .toEqual({ amount: 800, direction: 'refund' })
  })

  test('pagó de menos: el cliente debe', () => {
    expect(correctionDelta({ paidAmount: 11600, recalculatedAmount: 12400 }))
      .toEqual({ amount: 800, direction: 'debt' })
  })

  test('el monto siempre es positivo', () => {
    expect(correctionDelta({ paidAmount: 100, recalculatedAmount: 900 }).amount).toBe(800)
    expect(correctionDelta({ paidAmount: 900, recalculatedAmount: 100 }).amount).toBe(800)
  })

  test('sin diferencia da 0 y dirección refund', () => {
    expect(correctionDelta({ paidAmount: 500, recalculatedAmount: 500 }))
      .toEqual({ amount: 0, direction: 'refund' })
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `CI=true npx craco test --testPathPattern "billingCorrection" --watchAll=false`
Expected: FAIL con "Cannot find module './billingCorrection'".

- [ ] **Step 3: Escribir la implementación**

Crear `src/services/invoices/billingCorrection.js`:

```js
/**
 * Corrección de un mes ya pago cuyo monto cambió (típicamente al marcar un día
 * como no cobrable, o al deshacer esa falta).
 *
 * Puro a propósito: el front usa esto solo para DECIDIR si abre el modal y qué
 * diferencia mostrar. El monto que se persiste lo recalcula la RPC
 * apply_month_billing_correction del lado del servidor — si el número viajara
 * desde el browser, un bug de redondeo en la UI se escribiría como monto cobrado.
 */

// Los montos se cobran redondeados a peso; comparar en flotante daría
// diferencias fantasma de centavos.
const toPesos = (n) => Math.round(Number(n) || 0)

/**
 * @param {{ isPaid: boolean, paidAmount: number|null, recalculatedAmount: number }} p
 * @returns {boolean}
 */
export function shouldPromptCorrection({ isPaid, paidAmount, recalculatedAmount }) {
  if (!isPaid) return false
  if (paidAmount === null || paidAmount === undefined) return false
  return toPesos(paidAmount) !== toPesos(recalculatedAmount)
}

/**
 * @param {{ paidAmount: number, recalculatedAmount: number }} p
 * @returns {{ amount: number, direction: 'refund' | 'debt' }} amount siempre positivo
 */
export function correctionDelta({ paidAmount, recalculatedAmount }) {
  const diff = toPesos(paidAmount) - toPesos(recalculatedAmount)
  return { amount: Math.abs(diff), direction: diff >= 0 ? 'refund' : 'debt' }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `CI=true npx craco test --testPathPattern "billingCorrection" --watchAll=false`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/invoices/billingCorrection.js src/services/invoices/billingCorrection.test.js
git commit -m "feat(faltas): lógica pura de corrección de mes pago"
```

---

### Task 3: Feature `attendance_edit` en la matriz de roles

**Files:**
- Modify: `src/context/AuthContext.jsx:7-17`
- Test: `src/context/authAccess.test.js` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: `roleHasAccess(role, 'attendance_edit')` — `true` para `admin` y `superadmin`, `false` para `operador`.

- [ ] **Step 1: Escribir el test**

Crear `src/context/authAccess.test.js`:

```js
import { roleHasAccess } from './AuthContext'

describe('roleHasAccess — attendance_edit', () => {
  test('el operador no edita asistencia: registrar una falta mueve plata', () => {
    expect(roleHasAccess('operador', 'attendance_edit')).toBe(false)
  })

  test('admin y superadmin sí', () => {
    expect(roleHasAccess('admin', 'attendance_edit')).toBe(true)
    expect(roleHasAccess('superadmin', 'attendance_edit')).toBe(true)
  })

  test('el operador conserva clientes (ve el calendario)', () => {
    expect(roleHasAccess('operador', 'clients')).toBe(true)
  })

  test('rol desconocido o vacío no accede', () => {
    expect(roleHasAccess('otro', 'attendance_edit')).toBe(false)
    expect(roleHasAccess(undefined, 'attendance_edit')).toBe(false)
  })

  test('feature inexistente no accede', () => {
    expect(roleHasAccess('superadmin', 'no_existe')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `CI=true npx craco test --testPathPattern "authAccess" --watchAll=false`
Expected: FAIL. `roleHasAccess('admin', 'attendance_edit')` da `false` porque la feature no existe en `FEATURE_ROLES`.

- [ ] **Step 3: Agregar la feature**

En `src/context/AuthContext.jsx`, dentro de `FEATURE_ROLES`, después de la línea `clients: [...]`:

```js
  // Registrar/deshacer faltas y marcar recuperos: mueve plata (cobra o descuenta
  // un día, otorga o consume un crédito), así que no es operativo.
  attendance_edit: ['admin', 'superadmin'],
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `CI=true npx craco test --testPathPattern "authAccess" --watchAll=false`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/context/AuthContext.jsx src/context/authAccess.test.js
git commit -m "feat(permisos): feature attendance_edit para admin y superadmin"
```

---

### Task 4: Migración 084 — elección de cobrable y guardas de rol

**Files:**
- Create: `supabase/migrations/084_absence_chargeable_choice.sql`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `register_absence(p_client_id uuid, p_date date, p_is_justified boolean, p_is_chargeable boolean, p_notes text, p_created_by text) → jsonb {success, isChargeable, creditEarned}`
  - `register_absence_range(p_client_id uuid, p_from_date date, p_to_date date, p_is_justified boolean, p_is_chargeable boolean, p_notes text, p_created_by text) → jsonb {success, daysMarked}`
  - `unregister_absence` y `mark_day_recovery_attended`: misma firma, con guarda de rol.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/084_absence_chargeable_choice.sql`:

```sql
-- Migration 084: is_chargeable elegido por el usuario + permisos admin/superadmin
--
-- Hasta acá register_absence derivaba is_chargeable de la fecha:
--   is_chargeable := NOT (justificada AND futuro AND mes NO pago)
-- Que una falta justificada se cobre (y genere recupero) o se descuente es una
-- concesión comercial, no una consecuencia de cuándo se cargó. Pasa a ser un
-- parámetro; el default "siempre cobrable" vive en la UI, no acá.
--
-- Además: las RPC de asistencia son SECURITY DEFINER, así que saltean la RLS.
-- Esconder el botón en el front no protege nada — la restricción real es este
-- chequeo de rol adentro de cada función.

-- ── 1. Dropear las firmas viejas ───────────────────────────────────────────
-- Agregar un parámetro crea una SOBRECARGA nueva, no reemplaza. Con las dos
-- vivas, PostgREST falla con "function is not unique".
DROP FUNCTION IF EXISTS public.register_absence(uuid, date, boolean, text, text);
DROP FUNCTION IF EXISTS public.register_absence_range(uuid, date, date, boolean, text, text);

-- ── 2. register_absence con la elección ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_absence(
  p_client_id uuid,
  p_date date,
  p_is_justified boolean DEFAULT false,
  p_is_chargeable boolean DEFAULT true,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_record_id UUID; v_credit_id UUID; v_new_balance INTEGER;
  v_is_chargeable BOOLEAN; v_grants_credit BOOLEAN;
  v_clean_notes TEXT;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para registrar faltas');
  END IF;

  v_clean_notes := NULLIF(TRIM(COALESCE(p_notes, '')), '');

  -- Una falta injustificada se cobra siempre: la elección solo aplica a las justificadas.
  v_is_chargeable := (NOT p_is_justified) OR COALESCE(p_is_chargeable, true);
  v_grants_credit := p_is_justified AND v_is_chargeable;

  INSERT INTO attendance_records (client_id, date, status, is_justified, is_chargeable, notes)
  VALUES (p_client_id, p_date, 'absent', p_is_justified, v_is_chargeable, v_clean_notes)
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = 'absent',
    is_justified = EXCLUDED.is_justified,
    is_chargeable = EXCLUDED.is_chargeable,
    notes = EXCLUDED.notes,
    updated_at = NOW()
  RETURNING id INTO v_record_id;

  -- Re-marca idempotente: revoca cualquier crédito vivo previo de este registro
  DELETE FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available';

  IF v_grants_credit THEN
    INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, note, grant_attendance_id, created_by_name)
    VALUES (p_client_id, p_date, p_date + 30, 'justified_absence', v_clean_notes, v_record_id, p_created_by)
    RETURNING id INTO v_credit_id;
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
    VALUES (p_client_id, p_date, 1, 'justified_absence', v_record_id, v_new_balance, p_created_by, v_credit_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'isChargeable', v_is_chargeable, 'creditEarned', v_grants_credit);
END;
$function$;

-- ── 3. register_absence_range pasa la elección a cada día ──────────────────
CREATE OR REPLACE FUNCTION public.register_absence_range(
  p_client_id uuid,
  p_from_date date,
  p_to_date date,
  p_is_justified boolean DEFAULT false,
  p_is_chargeable boolean DEFAULT true,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_day DATE; v_day_of_week INTEGER; v_day_name TEXT;
  v_assigned_days TEXT[]; v_count INTEGER := 0;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para registrar faltas');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM client_plans WHERE client_id = p_client_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan no encontrado');
  END IF;
  v_day := p_from_date;
  WHILE v_day <= p_to_date LOOP
    SELECT assigned_days INTO v_assigned_days
    FROM client_plans
    WHERE client_id = p_client_id AND effective_from <= date_trunc('month', v_day)::date
    ORDER BY effective_from DESC LIMIT 1;

    v_day_of_week := EXTRACT(DOW FROM v_day)::INTEGER;
    v_day_name := CASE v_day_of_week
      WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
      WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' ELSE NULL END;
    IF v_day_name IS NOT NULL AND v_assigned_days IS NOT NULL AND v_day_name = ANY(v_assigned_days) THEN
      PERFORM register_absence(p_client_id, v_day, p_is_justified, p_is_chargeable, p_notes, p_created_by);
      v_count := v_count + 1;
    END IF;
    v_day := v_day + INTERVAL '1 day';
  END LOOP;
  RETURN jsonb_build_object('success', true, 'daysMarked', v_count);
END;
$function$;

-- ── 4. Guarda de rol en las otras dos RPC de asistencia ────────────────────
-- Se reemplaza solo el prólogo; el cuerpo queda igual al de las migraciones
-- 068 (unregister_absence) y 017 (mark_day_recovery_attended).
CREATE OR REPLACE FUNCTION public.unregister_absence(
  p_client_id uuid,
  p_date date,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_record_id UUID; v_had_credit BOOLEAN := false; v_new_balance INTEGER;
BEGIN
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para deshacer faltas');
  END IF;

  SELECT id INTO v_record_id FROM attendance_records
  WHERE client_id = p_client_id AND date = p_date AND status = 'absent';
  IF v_record_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No hay falta registrada ese día');
  END IF;

  SELECT EXISTS (SELECT 1 FROM recovery_credits WHERE grant_attendance_id = v_record_id)
    INTO v_had_credit;
  DELETE FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available';

  UPDATE attendance_records
  SET status = CASE WHEN p_date > CURRENT_DATE THEN 'scheduled' ELSE 'attended' END,
      is_justified = false, is_chargeable = true, notes = NULL, updated_at = NOW()
  WHERE id = v_record_id;

  IF v_had_credit THEN
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, -1, 'absence_undone', v_record_id, v_new_balance, p_created_by);
  END IF;

  RETURN jsonb_build_object('success', true, 'creditRevoked', v_had_credit);
END;
$function$;
```

> **Antes de escribir el bloque 4:** abrir `supabase/migrations/068_unified_absence_model.sql` a partir de la sección 7 y `supabase/migrations/017_recovery_credits.sql:294` y **copiar el cuerpo actual** de `unregister_absence` y `mark_day_recovery_attended`, agregándoles solo el `IF NOT is_admin_or_superadmin()` al principio. El cuerpo de `unregister_absence` de arriba es una transcripción — verificarla contra la 068 antes de darla por buena, y agregar al final de la migración el `CREATE OR REPLACE` de `mark_day_recovery_attended` con su cuerpo real de la 017 más la guarda:

```sql
  IF NOT is_admin_or_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos para marcar recuperos');
  END IF;
```

- [ ] **Step 2: Verificar que las firmas viejas están todas dropeadas**

Run: `grep -n "DROP FUNCTION" supabase/migrations/084_absence_chargeable_choice.sql`
Expected: dos líneas, una por cada firma vieja (`register_absence` de 5 args y `register_absence_range` de 6). Si falta alguna, agregarla: sin el DROP, la próxima llamada del front falla con *"function is not unique"*.

- [ ] **Step 3: Verificar que el cuerpo copiado no se desvió**

Run: `sed -n '/unregister_absence/,/\$function\$;/p' supabase/migrations/068_unified_absence_model.sql`
Expected: comparar línea por línea contra el bloque 4. Lo único que puede diferir es el `IF NOT is_admin_or_superadmin()` agregado.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/084_absence_chargeable_choice.sql
git commit -m "feat(faltas): migración de is_chargeable elegido y permisos admin+"
```

---

### Task 5: Migración 085 — corrección de mes pago

**Files:**
- Create: `supabase/migrations/085_month_billing_correction.sql`

**Interfaces:**
- Consumes: `calculate_month_billing(p_client_id uuid, p_year integer, p_month integer) → jsonb` (ya existe, migración 071; devuelve `chargeableAmount`).
- Produces:
  - `monthly_invoices.correction_pending BOOLEAN NOT NULL DEFAULT false`
  - `apply_month_billing_correction(p_client_id uuid, p_year integer, p_month integer, p_created_by text) → jsonb {success, previousAmount, newAmount}`
  - `flag_month_correction_pending(p_client_id uuid, p_year integer, p_month integer) → jsonb {success}`
  - `invoices_view` expone `"correctionPending"`

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/085_month_billing_correction.sql`:

```sql
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
  v_new := ROUND((v_billing->>'chargeableAmount')::NUMERIC);

  v_note := format('[%s] Corrección de cobro: %s → %s%s',
    to_char(CURRENT_DATE, 'DD/MM/YYYY'), v_previous, v_new,
    COALESCE(' · ' || p_created_by, ''));

  UPDATE monthly_invoices
  SET chargeable_amount = v_new,
      paid_amount = v_new,
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
```

- [ ] **Step 2: Agregar la columna a `invoices_view`**

Abrir `supabase/migrations/029_plan_discount.sql` a partir de la línea 225 y copiar el `CREATE VIEW invoices_view` **completo** al final de la migración 085, precedido de `DROP VIEW IF EXISTS invoices_view;`, agregando `mi.correction_pending AS "correctionPending",` junto a las demás columnas de pago. Terminar con:

```sql
ALTER VIEW invoices_view SET (security_invoker = on);
```

Ese `ALTER` **no es opcional**: `DROP` + `CREATE VIEW` pierde `security_invoker`, y sin él la RLS de `monthly_invoices` deja de aplicarse al leer la vista — el operador pasaría a ver montos.

- [ ] **Step 3: Verificar que el `security_invoker` está**

Run: `grep -c "security_invoker" supabase/migrations/085_month_billing_correction.sql`
Expected: `1`. Si da `0`, la vista quedó insegura — agregarlo antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/085_month_billing_correction.sql
git commit -m "feat(facturacion): migración de corrección de monto cobrado"
```

---

### Task 6: Servicios — pasar la elección y exponer la corrección

**Files:**
- Modify: `src/services/attendance/attendanceService.js:79-105`
- Modify: `src/services/invoices/invoiceService.js`
- Modify: `src/services/api.js`

**Interfaces:**
- Consumes: las RPC de las Tasks 4 y 5.
- Produces:
  - `registerAbsence(clientId, date, isJustified, isChargeable, userName, notes) → Promise<{success, isChargeable, creditEarned}>`
  - `registerAbsenceRange(clientId, fromDate, toDate, isJustified, isChargeable, userName, notes) → Promise<{success, daysMarked}>`
  - `applyMonthBillingCorrection(clientId, year, month, userName) → Promise<{success, previousAmount, newAmount}>`
  - `flagMonthCorrectionPending(clientId, year, month) → Promise<void>`
  - `getClientInvoices` devuelve además `correctionPending: boolean`

- [ ] **Step 1: Actualizar `registerAbsence` y `registerAbsenceRange`**

En `src/services/attendance/attendanceService.js`, reemplazar las dos funciones:

```js
/**
 * Registra una falta. `isChargeable` lo elige el usuario y solo aplica a las
 * justificadas: una injustificada se cobra siempre (ver absenceModel).
 * @param {string} clientId
 * @param {string} date - YYYY-MM-DD
 * @param {boolean} isJustified
 * @param {boolean} isChargeable - se cobra el día (y genera recupero si es justificada)
 * @param {string} userName
 * @param {string|null} notes - Motivo (chip o texto libre)
 * @returns {Promise<{success: boolean, isChargeable: boolean, creditEarned: boolean}>}
 */
export async function registerAbsence(clientId, date, isJustified, isChargeable, userName, notes = null) {
  const { data, error } = await supabase.rpc('register_absence', {
    p_client_id: clientId,
    p_date: date,
    p_is_justified: isJustified,
    p_is_chargeable: isChargeable,
    p_notes: notes,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al registrar falta')
  return data
}

/**
 * Registra faltas en un rango; cada día asignado se evalúa por separado.
 * @returns {Promise<{success: boolean, daysMarked: number}>}
 */
export async function registerAbsenceRange(clientId, fromDate, toDate, isJustified, isChargeable, userName, notes = null) {
  const { data, error } = await supabase.rpc('register_absence_range', {
    p_client_id: clientId,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_is_justified: isJustified,
    p_is_chargeable: isChargeable,
    p_notes: notes,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al registrar rango de faltas')
  return data
}
```

- [ ] **Step 2: Agregar las funciones de corrección**

En `src/services/invoices/invoiceService.js`, al final del archivo:

```js
/**
 * Reescribe el monto cobrado de un mes con lo que corresponde según la
 * asistencia actual. El monto lo recalcula el servidor, no se manda desde acá.
 * @param {string} clientId
 * @param {number} year
 * @param {number} month - 0-indexed
 * @param {string} userName
 * @returns {Promise<{success: boolean, previousAmount: number, newAmount: number}>}
 */
export async function applyMonthBillingCorrection(clientId, year, month, userName) {
  const { data, error } = await supabase.rpc('apply_month_billing_correction', {
    p_client_id: clientId,
    p_year: year,
    p_month: month,
    p_created_by: userName
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al corregir el cobro')
  return data
}

/**
 * Marca el mes como "requiere corrección" (el usuario canceló el modal).
 * @param {string} clientId
 * @param {number} year
 * @param {number} month - 0-indexed
 */
export async function flagMonthCorrectionPending(clientId, year, month) {
  const { data, error } = await supabase.rpc('flag_month_correction_pending', {
    p_client_id: clientId,
    p_year: year,
    p_month: month
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al marcar la corrección')
}
```

Y en el `.map(...)` de `getClientInvoices`, junto a `paymentNotes: inv.paymentNotes`:

```js
    paymentNotes: inv.paymentNotes,
    correctionPending: !!inv.correctionPending
```

- [ ] **Step 3: Re-exportar en el facade**

En `src/services/api.js`, agregar `applyMonthBillingCorrection` y `flagMonthCorrectionPending` al bloque `export { ... } from './invoices/invoiceService'`.

- [ ] **Step 4: Verificar que el facade quedó consistente**

Run: `npx eslint src/services/ 2>&1 | grep -v -i "browserslist\|update-db"`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add src/services/attendance/attendanceService.js src/services/invoices/invoiceService.js src/services/api.js
git commit -m "feat(faltas): servicios de elección de cobrable y corrección de cobro"
```

---

### Task 7: Selector de cobrable en el modal de falta

**Files:**
- Create: `src/pages/Clients/AbsenceChargeableChoice.jsx`
- Modify: `src/pages/Clients/ClientDetail.jsx` (componente `AbsenceModal`, ~línea 1554, y su `onConfirm`, ~línea 1299)

**Interfaces:**
- Consumes: `outcomePreview({ isJustified, isChargeable })` de la Task 1; `registerAbsence`/`registerAbsenceRange` de la Task 6.
- Produces: `AbsenceChargeableChoice({ value: boolean, onChange: (next: boolean) => void, disabled?: boolean })`; el `onConfirm` de `AbsenceModal` pasa a recibir `{ type, isChargeable, reason, range }`.

- [ ] **Step 1: Crear el selector**

Crear `src/pages/Clients/AbsenceChargeableChoice.jsx`:

```jsx
// Elección de si una falta justificada se cobra. El default siempre es cobrable
// (ver migración 084): que se descuente es una concesión, no el caso base.
const OPTIONS = [
  { value: true, label: 'Cobrable + recupero', hint: 'Se cobra el día y suma 1 día de recupero' },
  { value: false, label: 'No cobrable', hint: 'No se cobra el día, sin recupero' }
]

export default function AbsenceChargeableChoice({ value, onChange, disabled }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">Tipo de falta justificada</label>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map(opt => {
          const selected = value === opt.value
          return (
            <button
              key={String(opt.value)}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(opt.value)}
              className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                selected
                  ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-300'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="text-sm font-medium text-gray-900">{opt.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{opt.hint}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Enchufarlo en `AbsenceModal`**

En `ClientDetail.jsx`:

1. Importar arriba: `import AbsenceChargeableChoice from './AbsenceChargeableChoice'`
2. En `AbsenceModal` (que usa `useState` sueltos, no un objeto `form` — `emptyForm` es de `FollowupModal`), agregar junto a `const [selected, setSelected] = useState(null)`: `const [isChargeable, setIsChargeable] = useState(true)`
3. En el `useEffect` de reset (cuando `!isOpen`), agregar `setIsChargeable(true)` — el default vuelve a cobrable en cada apertura.
4. Renderizar el selector **dentro del bloque que ya aparece cuando `isJustified`**, arriba del campo "Motivo":

```jsx
{isJustified && (
  <AbsenceChargeableChoice value={isChargeable} onChange={setIsChargeable} disabled={submitting} />
)}
```

5. Reemplazar el cálculo de `previewText` por:

```jsx
  const previewText = selected
    ? outcomePreview({ isJustified: selected === 'justified', isChargeable })
    : null
```

   y borrar la constante `todayStr` local si queda sin uso.
6. En `handleConfirm`, agregar `isChargeable` al objeto: `await onConfirm({ type: selected, isChargeable, reason: ..., range: ... })`

- [ ] **Step 3: Actualizar el `onConfirm` del call site**

En `ClientDetail.jsx`, el `<AbsenceModal onConfirm={...}>` (~línea 1299):

```jsx
        onConfirm={({ type, isChargeable, reason, range }) => {
          const isJustified = type === 'justified'
          if (range)
            return withProcessing(() => registerAbsenceRange(client.id, range.from, range.to, isJustified, isChargeable, user?.name, reason))
          return withProcessing(() => registerAbsence(client.id, selectedDate, isJustified, isChargeable, user?.name, reason))
        }}
```

- [ ] **Step 4: Compilar y verificar que no quedó la firma vieja**

Run: `grep -n "outcomePreview\|registerAbsence(" src/pages/Clients/ClientDetail.jsx`
Expected: `outcomePreview({ isJustified, isChargeable })` sin `date`/`today`/`monthPaid`, y `registerAbsence(client.id, selectedDate, isJustified, isChargeable, user?.name, reason)` con seis argumentos.

Run: `CI=true npx craco build 2>&1 | grep -E "Compiled|Failed|error"`
Expected: `Compiled successfully.`

- [ ] **Step 5: Recompilar Tailwind**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Run: `git status --short src/tailwind.output.css`
Expected: si aparece modificado, incluirlo en el commit. Las clases del selector (`ring-orange-300`, `disabled:opacity-50`) pueden ser nuevas.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients/AbsenceChargeableChoice.jsx src/pages/Clients/ClientDetail.jsx src/tailwind.output.css
git commit -m "feat(faltas): selector de cobrable/no cobrable en el modal de falta"
```

---

### Task 8: Modal de corrección de mes pago

**Files:**
- Create: `src/pages/Clients/MonthBillingCorrectionModal.jsx`
- Modify: `src/pages/Clients/ClientDetail.jsx` (`MonthCard`)

**Interfaces:**
- Consumes: `shouldPromptCorrection`, `correctionDelta` (Task 2); `applyMonthBillingCorrection`, `flagMonthCorrectionPending` (Task 6); `calculateMonthBilling` (ya existe); `formatCurrency` de `src/utils/format`.
- Produces: `MonthBillingCorrectionModal({ isOpen, onClose, months, clientId, userName, onDone })` donde `months` es `Array<{ year, month, paidAmount, recalculatedAmount }>` — se procesan encadenados, uno por vez.

- [ ] **Step 1: Crear el modal**

Crear `src/pages/Clients/MonthBillingCorrectionModal.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { formatCurrency } from '../../utils/format'
import { correctionDelta } from '../../services/invoices/billingCorrection'
import { applyMonthBillingCorrection, flagMonthCorrectionPending } from '../../services/api'

// Corrección de meses ya pagos que quedaron descuadrados. `months` puede traer
// más de uno: un rango de faltas cruza meses. Se procesan encadenados, en el
// orden recibido, y cancelar uno marca ese mes y pasa al siguiente.
export default function MonthBillingCorrectionModal({ isOpen, onClose, months, clientId, userName, onDone }) {
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) { setIndex(0); setBusy(false); setError('') }
  }, [isOpen])

  const current = months?.[index]
  if (!current) return null

  const delta = correctionDelta({ paidAmount: current.paidAmount, recalculatedAmount: current.recalculatedAmount })
  const monthLabel = format(new Date(current.year, current.month, 1), 'MMMM yyyy', { locale: es })

  const advance = async () => {
    if (index + 1 < months.length) { setIndex(index + 1); setBusy(false); return }
    setBusy(false)
    await onDone()
    onClose()
  }

  const handleApply = async () => {
    setBusy(true); setError('')
    try {
      await applyMonthBillingCorrection(clientId, current.year, current.month, userName)
      await advance()
    } catch (e) { setError(e.message); setBusy(false) }
  }

  const handleSkip = async () => {
    setBusy(true); setError('')
    try {
      await flagMonthCorrectionPending(clientId, current.year, current.month)
      await advance()
    } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleSkip} title={`Corregir cobro — ${monthLabel}`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Este mes ya está cobrado por un monto que dejó de corresponder.
        </p>

        <dl className="rounded-lg border border-gray-200 divide-y divide-gray-100">
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-sm text-gray-500">Cobrado</dt>
            <dd className="text-sm font-medium text-gray-900">{formatCurrency(current.paidAmount)}</dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-sm text-gray-500">Corresponde</dt>
            <dd className="text-sm font-medium text-gray-900">{formatCurrency(current.recalculatedAmount)}</dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
            <dt className="text-sm font-medium text-gray-700">
              {delta.direction === 'refund' ? 'A favor del cliente' : 'El cliente debe'}
            </dt>
            <dd className={`text-sm font-semibold ${delta.direction === 'refund' ? 'text-red-600' : 'text-emerald-600'}`}>
              {formatCurrency(delta.amount)}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-gray-500">
          Corregir reescribe el monto cobrado del mes. La transferencia se hace por fuera del sistema.
        </p>

        {months.length > 1 && (
          <p className="text-xs text-gray-400">Mes {index + 1} de {months.length}</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleSkip} disabled={busy}>Ahora no</Button>
          <Button onClick={handleApply} disabled={busy}>
            {busy ? 'Corrigiendo...' : 'Corregir monto cobrado'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Detectar la diferencia después de cada cambio**

En `ClientDetail.jsx`, dentro de `MonthCard`, agregar estado y reemplazar `withProcessing`:

```jsx
  const [correctionMonths, setCorrectionMonths] = useState([])

  // Después de tocar la asistencia, ver si algún mes pago quedó descuadrado.
  // Solo para MOSTRAR la diferencia: el monto que se persiste lo recalcula la RPC.
  const detectCorrections = async () => {
    if (!invoice || invoice.paymentStatus !== 'paid') return
    try {
      const billing = await calculateMonthBilling(client.id, year, month)
      const recalculated = billing.chargeableAmount
      if (shouldPromptCorrection({ isPaid: true, paidAmount: invoice.paidAmount, recalculatedAmount: recalculated })) {
        setCorrectionMonths([{ year, month, paidAmount: invoice.paidAmount, recalculatedAmount: recalculated }])
      }
    } catch (e) {
      console.error('No se pudo verificar el cobro del mes:', e)
    }
  }

  const withProcessing = async (fn) => {
    setProcessing(true)
    try {
      await fn()
      await detectCorrections()
      await onRefresh()
    } catch (err) {
      console.error(err)
    } finally {
      setProcessing(false)
      closeModal()
    }
  }
```

Importar arriba: `shouldPromptCorrection` de `../../services/invoices/billingCorrection` y `MonthBillingCorrectionModal` de `./MonthBillingCorrectionModal`. `calculateMonthBilling` ya está importado.

> **Alcance de esta task:** solo el mes de la card. El rango que cruza meses se resuelve en la Task 9; el modal ya acepta un array para no tener que tocarlo dos veces.

- [ ] **Step 3: Renderizar el modal y el badge**

En el JSX de `MonthCard`, junto a los otros modales:

```jsx
      <MonthBillingCorrectionModal
        isOpen={correctionMonths.length > 0}
        onClose={() => setCorrectionMonths([])}
        months={correctionMonths}
        clientId={client.id}
        userName={user?.name}
        onDone={onRefresh}
      />
```

Y en el header de la card, junto al título del mes:

```jsx
            {canViewBilling && invoice?.correctionPending && (
              <button
                type="button"
                onClick={() => setCorrectionMonths([{ year, month, paidAmount: invoice.paidAmount, recalculatedAmount: liveChargeableAmount }])}
                className="ml-2 px-2 py-0.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 align-middle"
              >
                requiere corrección
              </button>
            )}
```

- [ ] **Step 4: Compilar**

Run: `CI=true npx craco build 2>&1 | grep -E "Compiled|Failed|error"`
Expected: `Compiled successfully.`

- [ ] **Step 5: Recompilar Tailwind y commitear**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
git add src/pages/Clients/MonthBillingCorrectionModal.jsx src/pages/Clients/ClientDetail.jsx src/tailwind.output.css
git commit -m "feat(facturacion): modal de corrección de monto cobrado"
```

---

### Task 9: Rango que cruza meses

Un rango de faltas puede descuadrar más de un mes pago. El modal ya los encadena; falta detectarlos.

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx` (`MonthCard`)
- Test: `src/services/invoices/billingCorrection.test.js`

**Interfaces:**
- Consumes: `shouldPromptCorrection` (Task 2).
- Produces: `monthsInRange(fromDate: string, toDate: string) → Array<{year, month}>` exportada desde `billingCorrection.js`.

- [ ] **Step 1: Escribir el test de `monthsInRange`**

Agregar a `src/services/invoices/billingCorrection.test.js`:

```js
import { shouldPromptCorrection, correctionDelta, monthsInRange } from './billingCorrection'

describe('monthsInRange', () => {
  test('un solo mes', () => {
    expect(monthsInRange('2026-09-03', '2026-09-20')).toEqual([{ year: 2026, month: 8 }])
  })

  test('dos meses consecutivos', () => {
    expect(monthsInRange('2026-09-28', '2026-10-05'))
      .toEqual([{ year: 2026, month: 8 }, { year: 2026, month: 9 }])
  })

  test('cruza el fin de año', () => {
    expect(monthsInRange('2026-12-28', '2027-01-04'))
      .toEqual([{ year: 2026, month: 11 }, { year: 2027, month: 0 }])
  })

  test('rango invertido da vacío', () => {
    expect(monthsInRange('2026-10-05', '2026-09-28')).toEqual([])
  })
})
```

(Ajustar el `import` de la primera línea del archivo, que ya existe.)

- [ ] **Step 2: Correr y verificar que falla**

Run: `CI=true npx craco test --testPathPattern "billingCorrection" --watchAll=false`
Expected: FAIL, `monthsInRange is not a function`.

- [ ] **Step 3: Implementar**

Agregar a `src/services/invoices/billingCorrection.js`:

```js
/**
 * Meses calendario tocados por un rango de fechas, inclusive. Un rango de
 * faltas puede cruzar meses y descuadrar más de un mes pago.
 * @param {string} fromDate - 'YYYY-MM-DD'
 * @param {string} toDate - 'YYYY-MM-DD'
 * @returns {Array<{year: number, month: number}>} month 0-indexed
 */
export function monthsInRange(fromDate, toDate) {
  const [fy, fm] = String(fromDate).split('-').map(Number)
  const [ty, tm] = String(toDate).split('-').map(Number)
  if (!fy || !fm || !ty || !tm) return []
  const months = []
  for (let i = fy * 12 + (fm - 1), last = ty * 12 + (tm - 1); i <= last; i++) {
    months.push({ year: Math.floor(i / 12), month: i % 12 })
  }
  return months
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `CI=true npx craco test --testPathPattern "billingCorrection" --watchAll=false`
Expected: PASS, 13 tests.

- [ ] **Step 5: Usarlo en la detección**

En `ClientDetail.jsx`, `MonthCard`, reemplazar `detectCorrections` por una versión que acepta los meses a revisar:

```jsx
  // Después de tocar la asistencia, ver qué meses pagos quedaron descuadrados.
  // Solo para MOSTRAR la diferencia: el monto que se persiste lo recalcula la RPC.
  const detectCorrections = async (months = [{ year, month }]) => {
    const found = []
    for (const m of months) {
      const inv = allInvoices.find(i => i.year === m.year && i.month === m.month)
      if (!inv || inv.paymentStatus !== 'paid') continue
      try {
        const billing = await calculateMonthBilling(client.id, m.year, m.month)
        if (shouldPromptCorrection({ isPaid: true, paidAmount: inv.paidAmount, recalculatedAmount: billing.chargeableAmount })) {
          found.push({ year: m.year, month: m.month, paidAmount: inv.paidAmount, recalculatedAmount: billing.chargeableAmount })
        }
      } catch (e) {
        console.error('No se pudo verificar el cobro de un mes:', e)
      }
    }
    if (found.length) setCorrectionMonths(found)
  }
```

`MonthCard` necesita la lista completa de facturas para mirar otros meses: pasarle `allInvoices={invoices}` desde el render de `ClientDetail` (los dos call sites, el fallback y el mapeo real) y agregarlo a la firma del componente.

Y en el `onConfirm` de `AbsenceModal`, cuando hay rango, pasar los meses:

```jsx
          if (range)
            return withProcessing(
              () => registerAbsenceRange(client.id, range.from, range.to, isJustified, isChargeable, user?.name, reason),
              monthsInRange(range.from, range.to)
            )
```

y `withProcessing` acepta el segundo parámetro:

```jsx
  const withProcessing = async (fn, months) => {
    setProcessing(true)
    try {
      await fn()
      await detectCorrections(months)
      await onRefresh()
    } catch (err) {
      console.error(err)
    } finally {
      setProcessing(false)
      closeModal()
    }
  }
```

- [ ] **Step 6: Compilar y commitear**

Run: `CI=true npx craco build 2>&1 | grep -E "Compiled|Failed|error"`
Expected: `Compiled successfully.`

```bash
git add src/services/invoices/billingCorrection.js src/services/invoices/billingCorrection.test.js src/pages/Clients/ClientDetail.jsx
git commit -m "feat(facturacion): corrección encadenada para rangos que cruzan meses"
```

---

### Task 10: Calendario en solo lectura para el operador

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx` (`MonthCard`: `handleDayClick`, `canClick`)

**Interfaces:**
- Consumes: `roleHasAccess(role, 'attendance_edit')` de la Task 3.
- Produces: nada.

- [ ] **Step 1: Agregar el gate**

En `MonthCard`, junto a `canViewBilling`:

```jsx
  // El operador lee el calendario (lo necesita para coordinar Grupos y
  // Transporte) pero no lo edita: registrar una falta mueve plata.
  const canEditAttendance = roleHasAccess(user?.role, 'attendance_edit')
```

En `handleDayClick`, primera línea:

```jsx
    if (isDeactivated || !canEditAttendance) return
```

En el cálculo de `canClick` de cada día, agregar la condición:

```jsx
              const canClick = !isWeekend && !isDeactivated && canEditAttendance && (
```

`roleHasAccess` ya está importado en el archivo (se usa para `canViewBilling`).

- [ ] **Step 2: Verificar que el gate no rompe la vista**

Run: `grep -n "canEditAttendance" src/pages/Clients/ClientDetail.jsx`
Expected: tres apariciones — la definición, `handleDayClick` y `canClick`. La leyenda de colores y los tooltips **no** deben aparecer en la lista: el operador los sigue viendo.

- [ ] **Step 3: Compilar**

Run: `CI=true npx craco build 2>&1 | grep -E "Compiled|Failed|error"`
Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(permisos): calendario de asistencia en solo lectura para operador"
```

---

### Task 11: Cierre — suite completa, CLAUDE.md y aplicación de migraciones

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Correr la suite completa**

Run: `CI=true npx craco test --watchAll=false`
Expected: todos los suites en verde. Si algún test viejo de `absenceModel` quedó con la firma anterior, arreglarlo acá.

- [ ] **Step 2: Build limpio**

Run: `CI=true npx craco build 2>&1 | grep -E "Compiled|Failed|error|warning"`
Expected: `Compiled successfully.` sin warnings nuevos.

- [ ] **Step 3: Actualizar `CLAUDE.md`**

En la sección **Roles y Permisos**, agregar `attendance_edit` a la lista de features y cambiar la línea del operador:

```markdown
Features: `clients`, `costs`, `billing`, `attendance_edit`, `salaries`, `dashboard_financials`, `users`.

### Operador
- ✅ Clientes, grupos, transporte (operación y coordinación)
- ✅ Calendario de asistencia (**solo lectura** — feature `attendance_edit`)
- ❌ Registrar/deshacer faltas y marcar recuperos: mueve plata
```

En **Estados de Asistencia**, aclarar que `is_chargeable` lo elige el usuario y que el default es cobrable.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: permisos de asistencia y elección de cobrable"
```

- [ ] **Step 5: Preguntarle al usuario por las migraciones**

Las migraciones 084 y 085 **no se aplicaron**. Sin ellas el front falla: `register_absence` no acepta `p_is_chargeable` y `invoices_view` no trae `correctionPending`. Preguntar si se aplican con el MCP de Supabase, y avisar que la 084 dropea las firmas viejas — entre el DROP y el CREATE, cualquier sesión abierta que registre una falta falla.

Después de aplicarlas, verificar:

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('register_absence', 'register_absence_range')
ORDER BY 1;
```

Expected: **una fila por función**, no dos. Dos filas = quedó una sobrecarga viva y el front va a fallar con *"function is not unique"*.

---

## Self-Review

**Cobertura de la spec:**

| Requisito de la spec | Task |
|---|---|
| Decisión 1 — tipo elegible | 1, 4, 7 |
| Decisión 2 — default siempre cobrable | 1 (lógica), 7 (UI) |
| Decisión 3 — modal de corrección reescribe el monto | 2, 5, 8 |
| Decisión 4 — caso simétrico (deshacer) | 8 (`withProcessing` cubre `unregisterAbsence`, que pasa por el mismo camino) |
| Decisión 5 — cancelable + `correction_pending` | 5 (columna, RPC), 8 (botón "Ahora no", badge) |
| Decisión 6 — admin+ | 3 (front), 4 (RPC), 10 (calendario) |
| Rango que cruza meses | 9 |
| `paid_amount` reescrito + nota | 5 |
| `invoices_view` con `security_invoker` | 5 |
| Testing de `absenceModel` | 1 |
| Testing de `billingCorrection` | 2, 9 |
| Testing de permisos | 3 |

**Riesgo no cubierto por una task, a propósito:** el punto 2 de "Riesgos" de la spec (el badge `correction_pending` puede quedar viejo si se deshace la falta que lo causó). La mitigación descrita —recalcular al abrir y apagar el flag si no hay diferencia— **no está implementada**: el badge abre el modal con `liveChargeableAmount`, que puede diferir. Si el usuario lo quiere, es una task adicional; queda anotado para no darlo por hecho.
