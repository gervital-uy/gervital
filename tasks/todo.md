# Plan — Pestaña "Seguimiento" (informes de observaciones)

Spec: `docs/superpowers/specs/2026-07-24-client-followups-design.md`

- [x] 1. Migración `072_client_followup_reports.sql` (tabla + RLS + índice)
- [x] 2. Servicio `src/services/clients/followupService.js` (CRUD)
- [x] 3. Re-export en `src/services/api.js`
- [x] 4. `src/pages/Clients/FollowupModal.jsx` (formulario por tipo)
- [x] 5. `src/pages/Clients/ClientFollowups.jsx` (historial + botón nuevo)
- [x] 6. Wire en `ClientDetail.jsx` (import, estado, fetch, tab, render)
- [x] 7. Aplicar migración a Supabase (aplicada a prod) + `npm run build` OK + Tailwind recompilado

## Review
- Pestaña "Seguimiento" entre "Información Médica" y "Tests", solo en el detalle.
- 3 tipos (seguimiento/objetivos/familiares) con campos condicionales; motivación alta/media/baja
  con chip + borde izquierdo coloreado (verde/ámbar/rojo).
- Profesional autocompleta con el usuario logueado, editable.
- Todos los roles ven y editan (RLS is_authenticated). Sin edición si el cliente está dado de baja.
- Build compila; clases de color nuevas verificadas en tailwind.output.css.
