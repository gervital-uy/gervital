# Fix timezone off-by-one en fechas (frontend)

Diagnóstico completo: la app corre en GMT-3 y `new Date('YYYY-MM-DD')` parsea como
medianoche **UTC**, por lo que cualquier lectura local (`format`, `getDate`,
`differenceInCalendarDays`) devuelve el **día anterior**. En sentido inverso,
`new Date().toISOString().slice(0,10)` calcula el día en UTC y después de las 21:00
locales devuelve **mañana**.

Alcance de esta tanda: **solo frontend**. Sin cambios de DB, sin migraciones de datos.

## 1. Utilidades compartidas
- [x] `parseDateOnly(str)` en `src/utils/date.js` → medianoche LOCAL.
      OJO: debe ser medianoche, no mediodía — `ClientDetail.jsx:915` compara
      `clientStart` contra días de calendario a medianoche; mediodía excluiría
      el primer día del cliente de la facturación.
- [x] `todayStr()` en `src/utils/date.js` → hoy local en YYYY-MM-DD.
- [x] Tests de ambas, incluyendo el caso borde de las 21:00-24:00.

## 2. Lecturas que muestran el día anterior (Tier 1)
- [x] `ClientDetail.jsx` :375, :590, :600 (ingreso / nacimiento)
- [x] `ClientDetail.jsx` :297, :299 (vencimiento de recupero)
- [x] `ClientDetail.jsx` :1274, :1290, :1304, :1575 ← **el caso reportado**:
      el modal dice un día, se aplica otro
- [x] `RecoveryCreditsModal.jsx` :98, :103
- [x] `CostsPage.jsx` :608, :863, :1689, :1739
- [x] `ChurnCardModal.jsx` :28
- [x] `ClientList.jsx` :124 (edad off-by-one la víspera del cumpleaños)

## 3. Escrituras que guardan mañana después de las 21:00
- [x] `AddClient.jsx` :75 (start_date del cliente), :494
- [x] `FollowupModal.jsx` :29
- [x] `TestInstanceModal.jsx` :137
- [x] `PlanCalculatorModal.jsx` :34
- [x] `recoveryService.js` :10 (filtro que descarta créditos válidos)

## 4. Corrupción de datos independiente del horario
- [x] `CostsPage.jsx` :1078 y :1255 — `new Date(form.date).getMonth()` archiva
      todo gasto del día 1 en el mes anterior. Solo se corrige el código;
      los datos ya guardados NO se tocan (decisión del usuario).

## 5. Limpieza
- [x] Borrar las 3 copias de `todayStr()` (Deactivate/Reactivate/BulkInvoice)
- [x] Normalizar los `T00:00:00`/`T12:00:00` sueltos a `parseDateOnly`

## 6. Verificación
- [x] Tests nuevos + suite completa
- [x] `npm run build` sin warnings
- [x] Confirmar que la facturación (`ClientDetail.jsx:915-921`) no cambia

## Fuera de alcance (pendiente de go/no-go)
- Cambio de timezone en la DB (`ALTER ROLE authenticator SET TimeZone`)
- Backfill de datos históricos ya escritos con la fecha corrida

---

## Review

**Hecho** (solo frontend, sin tocar la DB ni datos existentes):

- `src/utils/date.js`: `parseDateOnly`, `todayStr`, `toDateStr` + 13 tests.
  `parseDateOnly` distingue una fecha sin hora (medianoche local) de un timestamp
  con hora (instante real), así que sirve para columnas `date` y `timestamptz`.
- 17 lecturas que mostraban el día anterior, incluido el caso reportado:
  clic en el 24 → el modal decía "23 de junio". Verificado: ahora dice 24 y
  lo que se escribe (`2026-06-24`) no cambió.
- 6 escrituras que guardaban mañana después de las 21:00 (la más grave,
  `start_date` en el alta de cliente).
- `CostsPage`: los gastos del día 1 se archivaban en el mes anterior. Corregido
  para gastos nuevos; los ya guardados quedan como están.
- Eliminadas las 3 copias de `todayStr()` y los 7 `T00:00:00`/`T12:00:00` sueltos.
- `cleanupCutoff` extraída y testeada contra el cálculo viejo para los 365 días
  del año: el corte de borrado es idéntico.

**Verificación**: 285 tests en 24 suites pasan, `npm run build` sin warnings.
La facturación (`ClientDetail.jsx:915-921`) no cambia: `parseDateOnly` devuelve
medianoche local, así que `día >= inicio` sigue incluyendo el primer día.

**Pendiente de decisión del usuario**:
- Timezone de la DB (`ALTER ROLE authenticator SET TimeZone = 'America/Montevideo'`).
  Mientras no se haga, todo lo que la DB calcula con `CURRENT_DATE` sigue corrido
  entre las 21:00 y la medianoche.
- Backfill de datos históricos ya escritos con la fecha corrida.
