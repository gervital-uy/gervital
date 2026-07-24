# Informes de Seguimiento y Observaciones — Diseño

**Fecha:** 2026-07-24
**Ubicación:** Pestaña "Seguimiento" en el detalle del cliente (`ClientDetail`), entre "Información Médica" y "Tests". Solo en el detalle, no en el alta.

## Objetivo

Registro cronológico de informes del equipo interdisciplinario por cliente. Cada informe es de uno de tres tipos con campos propios, con un indicador de motivación del cliente. Historial editable.

## Decisiones

- **Permisos:** todos los roles autenticados ven y editan (igual que Info Médica y Tests). RLS `is_authenticated()`.
- **Profesional:** autocompleta con el usuario logueado, editable a mano.
- **Tres tipos** con campos condicionales (igual que el mockup).
- **Motivación:** nivel de motivación/ánimo del cliente (`alta`/`media`/`baja`, opcional). Chip de color + borde izquierdo coloreado en el historial. Paleta app: alta=verde, media=ámbar, baja=rojo.
- **UX:** botón "Nuevo informe" abre un **modal** (no formulario inline), consistente con Tests. Historial = lista de cards, más reciente primero.
- **Fuera de alcance:** impresión/PDF; filtro por tipo.

## Modelo de datos — migración `072_client_followup_reports.sql`

Tabla `client_followup_reports`, RLS `is_authenticated()` en SELECT/INSERT/UPDATE/DELETE (espeja `client_test_instances`, migración 058).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `client_id` | uuid not null fk → clients ON DELETE CASCADE | |
| `type` | text not null | CHECK in (`seguimiento`,`objetivos`,`familiares`) |
| `report_date` | date not null | |
| `professional` | text | |
| `discipline` | text | |
| `motivation` | text | CHECK in (`alta`,`media`,`baja`) or null |
| `observations` | text | seguimiento/familiares |
| `actions` | text | seguimiento/familiares |
| `recipient` | text | familiares |
| `general_objectives` | jsonb not null default `[]` | array de strings |
| `specific_objectives` | jsonb not null default `[]` | array de strings |
| `strategies` | jsonb not null default `[]` | array de `{objective, text}` (`objective` = índice del objetivo específico o null) |
| `created_at` / `updated_at` | timestamptz default now() | |

Índice: `(client_id, report_date desc)`.

## Servicio — `src/services/clients/followupService.js`

Espeja `testInstanceService.js`: `fromDb`/`toDb` + `getClientFollowups(clientId)` (order by `report_date desc`), `createFollowup(clientId, payload)`, `updateFollowup(id, payload)`, `deleteFollowup(id)`. Re-export en `api.js`.

## Frontend

- **`ClientDetail`:** import servicio, estado `followups`, fetch en `loadClientData` (agregar al `Promise.all`), tab `{ id: 'followups', label: 'Seguimiento' }` antes de `tests`, render `<ClientFollowups clientId={id} reports={followups} professional={user?.name} canMutate={!client.deletedAt} onRefresh={loadClientData} />`.
- **`ClientFollowups.jsx`:** botón "Nuevo informe" (si `canMutate`) + lista de cards. Card: fecha, `profesional · disciplina` (+ `Recibe: destinatario` si familiares), badge de tipo, chip de motivación, borde izquierdo por motivación, bloques de contenido según tipo, botones editar/eliminar (si `canMutate`). Vacío → mensaje.
- **`FollowupModal.jsx`:** formulario con selector de tipo (segmentado), motivación (segmentado con colores), fecha, y campos condicionales:
  - `seguimiento`/`familiares`: profesional, disciplina, [destinatario si familiares], observaciones, acciones.
  - `objetivos`: listas dinámicas de objetivos generales y específicos (agregar/quitar), y estrategias (cada una con select del objetivo específico asociado + texto). Fecha arriba.
  - Guardar deshabilitado si no hay contenido. Usa componentes UI de la app.

## Verificación

- `npm run build` compila sin errores.
- Migración aplicada a Supabase.
- Recompilar Tailwind si se usan clases nuevas.
