# Lessons

## PostgREST embeds: UNIQUE FK → objeto, no array
`client_addresses` tiene `UNIQUE(client_id)`. Cuando una relación embebida tiene
constraint UNIQUE en la FK, PostgREST/supabase-js la detecta como **uno-a-uno** y
la devuelve como **objeto** (`{street: ...}`), NO como array (`[{street: ...}]`).
- Síntoma: `client.client_addresses?.[0]?.street` siempre da `undefined` → guards
  de "no tiene dirección" disparan falsos positivos aunque el dato exista.
- Regla: al leer un embed, no asumir array. Normalizar:
  `const row = Array.isArray(a) ? a[0] : a`. (helper `addrStreet` en `biller/index.ts`)
- Pasó en `sync_client` Y en `emit_invoice` (este último emitía facturas con
  dirección vacía sin avisar). Revisar todos los embeds de tablas con FK única.

## Verificar antes de afirmar "no existe X" en una API externa
Caso Biller: la doc Postman es JS y WebFetch devolvía vacío → casi afirmo "no hay
endpoint de búsqueda" sin evidencia. La forma correcta: leer el JSON crudo de la
colección vía `https://documenter.gw.postman.com/api/collections/<view>/<pubid>`.
Confirmar contra la fuente antes de concluir, sobre todo si el usuario duda.

## La fuente de verdad es la DB/código, no CLAUDE.md ni los specs
Afirmé que frecuencia de plan era 1-4 (sale del data model y "Reglas de precios"
del CLAUDE.md). El usuario sabía que pueden ser 5 días. La realidad: CHECK de
client_plans permite 1-5 y plan_pricing tiene 15 combos (5 freq x 3 horarios).
CLAUDE.md y los specs pueden estar desactualizados. Para constraints/enums/valores
permitidos, verificar SIEMPRE contra el esquema vivo (CHECK constraints, tablas de
catálogo como plan_pricing) antes de documentar o decidir. Corregido CLAUDE.md
(líneas de Client, PlanPricing y Reglas de precios) para no propagar el error.

## Enum "hardcodeado" → dinámico: grepear TODAS las validaciones, no solo el CHECK
Al convertir los motivos de baja (lista fija) en gestionables por DB (tabla
`deactivation_reasons`, mig 044), dropeé el CHECK de `clients.deactivation_reason`
pero se me escapó que el RPC `deactivate_client` (mig 030) validaba el motivo
contra la MISMA lista vieja hardcodeada con `RAISE EXCEPTION 'Invalid deactivation
reason'`. Resultado: la baja con motivos nuevos fallaba con 400 en producción.
- Síntoma: error de dominio ("Invalid X") con código 400, NO el error típico de
  CHECK constraint de Postgres → señal de que hay validación en plpgsql, no en el schema.
- Regla: al migrar un enum/lista a datos dinámicos, grepear el valor en TODO
  `supabase/migrations/`: `CHECK`, `RAISE EXCEPTION`, `NOT IN (...)`, `= ANY`, y
  funciones que lo reciban como parámetro. El review de diff no lo caza si el RPC
  no está en el diff — buscar consumidores fuera del diff explícitamente.
- Fix elegante: validar contra la tabla fuente de verdad
  (`EXISTS (SELECT 1 FROM deactivation_reasons WHERE key = p_reason AND is_active)`),
  no re-hardcodear la lista.

## Al copiar el cuerpo de una función SQL, buscar si una migración POSTERIOR la reemplazó
Escribiendo la migración 084 copié `register_absence` de la 068 sin chequear que la
**069** la había reemplazado después con una guarda anti-doble-crédito (`v_has_consumed`,
"Fix (final review #3)"). El plan mandaba copiar de la 068, así que el error viajó del
plan a la implementación: habría revertido en producción un fix ya aplicado, re-otorgando
un crédito de recupero ya consumido al re-marcar una falta.
- Regla: antes de copiar el cuerpo de cualquier función, `grep -rn "<nombre>"
  supabase/migrations/*.sql` y usar la aparición de número MÁS ALTO, no la que uno
  recuerda. Lo mismo para vistas (`invoices_view`) y para RPCs que se editan por
  `CREATE OR REPLACE` en varias migraciones.
- La transcripción de memoria también falló: mi versión del cuerpo de `unregister_absence`
  tenía cuatro diferencias con la real (mensaje de error, condición del EXISTS/DELETE,
  `is_justified = false` en vez de `NULL`, y `reason` `'absence_undone'` en vez de
  `'reverted_justified_absence'`). Nunca transcribir SQL de memoria: abrir el archivo.

## Un tooltip con `title` nativo es casi invisible; y `display:contents` no tiene caja
Dos errores encadenados en el mismo componente:
1. Usé el atributo `title` nativo para mostrar el motivo de una falta. El usuario no lo
   vio: es gris del sistema y tarda ~1s. Si se pide "tooltip en hover", hacer uno real.
2. Al hacerlo real, el wrapper usaba `display: contents` para no romper el layout flex —
   pero un elemento con `display: contents` **no genera caja**, así que
   `getBoundingClientRect()` devuelve todo en cero y el tooltip aterrizó en la esquina
   de la pantalla. Medir `firstElementChild`, no el wrapper.
- Regla más general: un componente de posicionamiento no se da por hecho leyendo el
  código. jsdom no hace layout, así que el test tiene que mockear
  `getBoundingClientRect` POR ELEMENTO para reproducir el caso real (wrapper sin caja,
  hijo con caja). Ver `src/components/ui/Tooltip.test.js`.

## Verificar el estado de la DB antes de afirmar que algo no se escribió
Dije "sigue sin haber ninguna fila escrita" sobre el aporte de directores cuando el
usuario ya la había generado abriendo la pantalla. Lo di por sentado en vez de volver a
consultar la base después de su mensaje. Si el usuario dice que ve algo distinto de lo
que yo creo, la base gana: consultarla antes de responder.

## El grep para "¿cuál es la definición vigente?" tiene que ser exhaustivo, y la base manda
Reincidencia de la lección anterior, con un modo de fallo nuevo. Al escribir la migración
088 hice `grep -rln ... | tail -2` y leí "028" como la versión vigente de
`get_dashboard_finance_series`. El listado completo era 027, 028, 042, 048 y **052**: la
vigente era la 052. Reemplacé la función con un cuerpo derivado de la 028 y perdí en
producción el filtro `c.client_type = 'regular'` del CTE de previsto (que habían agregado
las migraciones 042 y 048). El previsto de agosto 2026 pasó de 1.633.040 a 1.663.770:
clientes de caridad y a prueba sumando al ingreso previsto.
- Lo caché sólo porque comparé los números antes y después y me llamó la atención que el
  cobrado diera EXACTAMENTE igual: ese "no cambió nada" era la pista de que la función que
  yo creía estar reemplazando no era la que estaba viva.
- Regla: antes de reemplazar cualquier función, leer la definición viva de la base:
  `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = '<nombre>'`. Es la única
  fuente infalible — el grep sobre migraciones es un índice, no la verdad. Si igual se
  greppea, `| sort` y mirar el MAYOR; nunca `tail -N` sobre un listado sin ordenar.
- Regla 2: medir SIEMPRE una métrica de control antes y después de tocar una función de
  agregación, y del lado que se supone que NO cambia (acá: previsto), no sólo del que sí.
