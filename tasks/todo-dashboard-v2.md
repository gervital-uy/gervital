# Dashboard v2 — plan

Fuente de diseño: artifact "Gervital Dashboard Mock" (https://claude.ai/artifact/N9LxqwUZsQbRBLuTxYvQVt),
~10.500 líneas, datos inventados. Objetivo: replicarlo con datos REALES en `/dashboard-v2`, como
segunda entrada de la topbar; `/dashboard` (legacy) no se toca.

Análisis: workflow de 15 agentes (7 secciones analizadas + 7 verificadores escépticos + síntesis)
contra el código y la base viva, 2026-10-28. Verificado a mano después: B2 (funciones SECURITY
DEFINER sin guarda y ejecutables por `anon`) y el estado de facturación de las promos.

## Decisiones del usuario (2026-10-28)
- Seguridad (B2) primero, antes que la v2.
- v2 visible solo para superadmin.
- Primera pestaña a portar: Gestión CFP.
- Meses de promo: cada mes se factura por su servicio (CLAUDE.md); qué hacer con A-3475 lo define con el contador.

## Decisión del usuario (2026-10-30): la v2 no cambia la base
Nada de migraciones, tampoco para crear o cambiar una RPC. Si una pieza necesita cambiar el
esquema, se deshabilita. Las RPC nuevas que eran solo por rendimiento también se descartan: se
calcula en el cliente con lo que ya existe.

### Qué queda fuera y por qué (revisado 2026-11-06 contra la base viva)
"Solo quedan fuera las piezas que requerirían cambiar el esquema" exagera: algunas quedan fuera por
decisión aunque no necesiten esquema.

**Necesitan esquema, así que quedan fuera:**
- ~~Columna Motivo en Otros descuentos (B10).~~ Hecho el 2026-11-14 a pedido del usuario, que
  aceptó la migración (095, aplicada): motivo de texto libre opcional en promos y descuentos,
  columna Motivo en las dos tablas. Sin catálogo: `promotions.reason` y
  `monthly_invoices.discount_reason`.
- Costo por chofer y pago por tramo (B12). Nada une un auto de transporte con el prestador que lo
  maneja, ni hay tarifa por tramo: `transport_shift_cars.driver_provider_id` (+ `pay_mode` /
  `per_trip_rate`). Mientras tanto, el costo mensual plano de los choferes se reparte en partes
  iguales por tramo.
- Devolución por baja. Haría falta una entidad de devoluciones y una nota de crédito parcial en
  Biller. Además contradice el prorrateo de `calculate_month_billing`.
- Renovación diferida al cierre de mes. Haría falta una tabla `promo_renewal_decisions` y un
  programador. `pg_cron` está disponible en el proyecto pero no habilitado: activarlo es prender una
  extensión; la pieza de esquema es la tabla.
- Feriados. Haría falta una tabla de calendario.

**Aproximadas porque el esquema no guarda el dato** (cada una se aclara en su "i"):
- Prestadores en meses pasados (B6). `service_providers` no tiene vigencia (solo `active`,
  `created_at`, `updated_at`): el inicio es `created_at`.
- Egreso de empleadas. `employees` solo tiene `active`, y `salaryCostForMonth` (legacy) saltea a una
  inactiva en todos los meses: el día que se dé de baja a una, su costo desaparece también de los
  meses en que trabajó (bajan hacia atrás Personal, los márgenes, el puente y el punto de equilibrio).
  Finanzas toma el mes del `updated_at` de una empleada inactiva como su mes de egreso y lo aclara en
  la "i" de Personal. Es aproximado: `updateEmployee` pisa `updated_at` en cada edición, así que
  editarla después de la baja lo corre. Lo mismo vale para el fin de un prestador dado de baja
  (`providerCostForMonth` también lo saltea en todos los meses). Hoy las 6 empleadas y los 4
  prestadores están activos.
- Pausa contra baja (B13). `client_inactivity_periods` no las distingue: se usa
  `churn_followups.stage`.
- Tier por mes. `cognitive_level` no tiene historial: se usa el tier actual.
- Clientes heredados. No hay marca: convención `start_date` = lanzamiento (`platform_start`).

**Fuera por decisión, aunque no necesitan esquema:**
- Punto "accionable" en Bajas por motivo (B9). Con un mapeo fijo en código no hace falta esquema;
  solo lo necesitaría si se edita desde la app (`deactivation_reasons.is_actionable`).
- Reactivar promos (B11). Se puede con un `createPrepaidPromo` por promo, pero queda a medias si
  falla una; hacerlo atómico es una RPC nueva (`renew_prepaid_promos`).
- Turno de la falta. La columna existe (`attendance_records.shift`, con CHECK
  morning/afternoon/full_day) pero ninguna de las 353 filas de asistencia la tiene cargada (al
  2026-11-06), porque `register_absence` y `register_absence_range` no la reciben. Faltaría un
  `p_shift` en las dos (firma nueva: borrar la vieja) y la UI: cambio de RPC, no de esquema. Las
  faltas ya cargadas no tienen turno.
- Alertas operativas (2 faltas seguidas, caída del 25%). Funcionalidad nueva que se calcularía con
  lo que existe.
- RPC solo por rendimiento (B3, B4, B5, B15). Lecturas existentes + cálculo en el navegador
  (Finanzas pide el panel una vez por mes).

**Con datos que ya existen, sin esquema:** `director_bps` calculado sin persistir (B14); aforo
(`shift_capacity`) y meta neta (`net_margin_target`) como filas de `app_settings` (tabla existente,
admin+ escribe) o controles que solo simulan (B8).

B1 no toca la base (edge function `biller` + `invoiceAmounts.js`). B2/093 son permisos, no esquema,
e independientes de la v2.

## Checklist por fase (detalle en §7)
- [ ] B2 — migración de seguridad 093: escrita en `fix/security-hardening`, POSTERGADA (el usuario no quiere migraciones ahora, 2026-10-30). Sin migración: apagar el signup + rotar las 6 contraseñas
- [x] Fase 0 — ruta, topbar, shell con pestañas y placeholders
      (`/dashboard-v2`, feature `dashboard_v2` = superadmin, entrada "v2" con ícono DashboardSpeed
      al lado de Dashboard — label corto porque la topbar del superadmin ya está al límite de ancho)
- [x] Fase 1 — infraestructura compartida (explicaciones "i", Sheet, primitivas, useMonthData)
      Revisión adversarial (4 lentes): 14 confirmados y corregidos. Contrato de explicaciones en
      `explain/docs/validate.js` (valor con signo, `info`, subtotales `=`, `check: false`); cada
      explicación nueva va con su muestra en `docSamples.js`. Quedan para su fase: Switch,
      Segmented, TipRow, Sparkline, DeltaTag, FinKpi, MetricTabs, MesPicker.
- [x] Fase 2 — Gestión CFP solo lectura
      Control (solo lectura): oct-26 50 filas, previsto = cobrado = 1.793.460, 1 ancla de 81.000;
      sep-26 1.767.730 y A-3475 marcada "monto distinto" (96.360 contra 32.120 del servicio).
      Revisión adversarial: 29 confirmados y corregidos (días prorrateados = cobrables / 4×frec,
      bajas y reingresos desde los períodos de inactividad, heredados no son alta, IVA emitido con
      las líneas guardadas, orden por el monto visible, modo trabadas, móvil, ids en inglés).
- [x] Fase 3 — Cobranza con escrituras (sin probar contra producción: falta el cliente de prueba)
      Mismas funciones que la ficha (mark_month_paid sin monto / collect_promo; unmarkMonthPaid /
      uncollect_promo). Antes de escribir relee monthly_invoices para no pisar un cobro o una factura
      registrados desde otro lado (mark_month_paid no lo controla). Revisión: 29 confirmados y corregidos.
- [x] Verificación a fondo de la Fase 3 sin escribir en producción (2026-10-31): 5 escenarios trazados contra las
      funciones vivas (pg_get_functiondef) y el estado real. 16 confirmados y corregidos: relectura por fila justo antes de
      cada cobro (estado + monto en vivo: no se cobra un monto distinto del que se vio), notas de corrección conservadas,
      revertir relee también el ancla, un mes facturado sin cobro no se cobra desde acá, reparación de un paquete roto
      (la ficha deshace solo el ancla: bug de legacy, ClientDetail.jsx:1185), el día y el mes avanzan con la pestaña abierta,
      una recarga fallida no tapa lo registrado.
- [x] B1 — facturación de meses de promo (303f60a: edge function biller + invoiceAmounts.js + llamadores de legacy).
      `biller` v19 deployada el 2026-11-06 con B1 + 436e2ee (no da por emitida una factura que no se pudo guardar).
      Antes del deploy el error ya había salido una vez: A-3475 (sep-26, 96.360 = el paquete). Pendiente: publicar el
      front (la ficha de producción todavía propone lo cobrado en el ancla de una promo).
- [x] Fase 4 — Facturación (sin emitir contra producción: la prueba queda pendiente)
      Emitir una (hoja con lo que se imprime, total, IVA y fecha fija) o en lote (de a una, 1,1 s entre llamadas, detener,
      reintentar). Fecha = último día hábil del mes y no antes. Antes de cada factura relee el mes y recalcula: no emite un
      monto distinto del que se vio. Control oct-26: 50 facturas listas, 1.871.480 (asistencia 1.689.400 + transporte
      182.080), IVA 321.206, 19 con transporte, ninguna trabada; el ancla de 426057b2 sale por 27.000 y no por 81.000.
      Revisión adversarial: 21 confirmados y corregidos (lote congelado en StrictMode, corrección pendiente y asistencia en
      $0 no se ofrecen para emitir, detener vale en la pausa, resultado de toda la sesión al cerrar el lote sin robar el foco,
      lo que cambió no se reintenta, solo la lista scrollea, textos del aviso de trabadas, biller no da por emitida una
      factura que no pudo guardar).
- [x] Fase 5 — Promociones y otros descuentos (datos e6ccd6a, UI c31fda7; sin Motivo ni Reactivar)
- [ ] Fase 6 — Asistencia (sigue en diseño: conserva el placeholder)
- [x] Fase 7 — Comercial (688fe3a; sin el punto accionable B9)
- [x] Fase 8 — Finanzas: serie v2 + gráfico principal (753a33e)
- [x] Fase 9 — Finanzas: tarjetas (d0f6682; transporte con el costo plano de choferes por tramo, B12 omitido)
- [ ] ~~Fase 10 — Opcionales (B3–B15)~~ descartada: la v2 no cambia la base (decisión 2026-10-30)

---

# Dashboard v2: plan de implementación

Escala de esfuerzo: **S** ≤ 1 día · **M** 2–4 días · **L** 1–2 semanas · **XL** > 2 semanas.

---

## 1. Resumen ejecutivo

- **Qué es.** Una segunda pantalla en `/dashboard-v2` con cuatro pestañas:
  - **Gestión CFP**: cobranza, facturación y promociones. Es una pantalla de trabajo y escribe datos.
  - **Finanzas**: un gráfico principal con 3 vistas y 8 tarjetas de análisis.
  - **Comercial**: cartera, MRR, churn, ocupación y cohortes.
  - **Asistencia**: tasa real, semana promedio, motivación y período de prueba.

  Cada número trae un botón "i" que explica cómo se calcula (45 explicaciones). El `/dashboard` legacy no se toca.
- **Cuánto se porta.** Inventarié unas 116 piezas:
  - ~31% se portan casi tal cual (`direct`).
  - ~64% necesitan lógica nueva sobre datos que ya existen (`adapt`).
  - ~4% necesitan backend (`needs_backend`).
  - 1 no es factible: la devolución por baja.

  Para una v1 fiel no hace falta ninguna tabla nueva. Todo número de la maqueta tiene una fuente real o se puede calcular en el cliente.
- **Hay un solo bloqueo de backend: cómo se facturan los meses de una promo.** Hoy `emit_invoice` factura el paquete entero en el mes ancla. Cuando se emitan octubre y noviembre, la promo de sep-2026 quedaría facturada en 160.600 contra 96.360 cobrados. Esto frena la parte Facturación de Gestión CFP.
- **Hay que hacer una migración de seguridad antes de habilitar escrituras.** Varias funciones de la base corren con permisos elevados (`SECURITY DEFINER`), no chequean el rol y además las puede llamar cualquiera, incluso sin sesión (`anon`). Las principales: `mark_month_paid`, `mark_month_invoiced`, `apply_plan_discount`, `calculate_month_billing`, `get_churn_board` y las que usa solo el biller.
- **El grueso del trabajo es lógica pura con tests.** Son 7 módulos nuevos: padrón del mes, serie financiera v2, línea de tiempo de actividad, valuación de MRR, motor de asistencia, beneficios y economía de transporte. A eso se suma la infraestructura de los modales de explicación.
- **La maqueta inventa reglas que el sistema no tiene, o que contradice:** devoluciones por baja, aforo, meta de margen, promos fijas (3 meses al 10%, 6 meses al 15%), renovación en el cierre de mes, pago a choferes por tramo, motivo de descuento y motivos de baja "accionables". Hay que reescribir los 45 textos de explicación contra las reglas reales.
- **Datos sucios que v2 no debe heredar:**
  - El previsto legacy excluye a los clientes dados de baja: en jun-26 faltan 201k brutos.
  - La tasa de asistencia legacy está mal: da 36% en sep-26 cuando la real ronda 89–91%.
  - Los prestadores se cuentan dos veces en jul y ago (114.500 por mes).
  - El ancla de la promo de sep-26 guarda el paquete entero en su mes, lo que suma 64.240 de más a la caja.
  - Hay 216.800 brutos cobrados con fecha anterior al lanzamiento.
- **Tamaño total: XL.** Calculo unas 9–12 semanas-persona, repartidas en 11 fases que se pueden entregar por separado. La Fase 0 (estructura base, ruta y menú) es S.

---

## 2. Integración

### Ruta y menú superior

| | Legacy (sin cambios) | v2 |
|---|---|---|
| Ruta | `/dashboard` (index y `*` siguen redirigiendo acá) | `/dashboard-v2`, con carga diferida (`React.lazy` + `Suspense`) dentro de `<RequireRole feature="dashboard_v2">` |
| Entrada en el menú | `{ to:'/dashboard', label:'Dashboard', icon: StatsReport, access:'clients' }` | `{ to:'/dashboard-v2', label:'Dashboard v2', icon: DashboardSpeed, access:'dashboard_v2' }`, justo después de la legacy |
| Permiso | `clients` (lo ve también el operador) | `FEATURE_ROLES.dashboard_v2` nuevo en `src/context/AuthContext.jsx`, con casos en `src/context/authAccess.test.js` |

- **No usar `/dashboard/v2`.** El resaltado del menú (`NavLink`) compara por segmento de ruta y encendería las dos entradas a la vez.
- **El menú puede no entrar en pantalla.** Un superadmin vería 8 entradas en unos 1.216 px útiles, y con las 7 actuales ya está al límite. Si no entra, acortar el label o usar una pastilla "v2".
- **Ancho de página.** El `Layout` limita el contenido a `max-w-7xl` (unos 1.216 px) y la maqueta usa todo el ancho. Hay que diseñar para 1.216 px: no tocar `Layout.jsx`.

### Permisos por pestaña

| Pestaña | Permiso | Roles | Nota |
|---|---|---|---|
| Gestión CFP | `billing` | admin, superadmin | El bloque de promos y sus acciones piden `promotions` (solo superadmin), porque `collect_promo`, `uncollect_promo`, `create_prepaid_promo` y `cancel_promo` exigen `is_superadmin()` |
| Finanzas | `dashboard_financials` | superadmin | Igual que en legacy |
| Comercial | `dashboard_financials` | superadmin | Muestra MRR, así que mantiene el mismo permiso que legacy |
| Asistencia | `statistics` | admin, superadmin | El embudo de prueba pasa de ser solo superadmin (Comercial legacy) a verse también como admin |

Se usa el mismo patrón que `src/pages/Dashboard/Dashboard.jsx`: se filtran las pestañas con `hasAccess` y se abre la primera disponible. No hay pestaña Promociones aparte. La pestaña por defecto es Gestión CFP.

### Carpetas

```
src/pages/DashboardV2/
  DashboardV2.jsx            # estructura base, pestañas, permisos, MonthNavigator
  monthWindow.js             # PLATFORM_START = 2026-06; TODAY se calcula en el componente
  format.js                  # coma, plural, fechas largas/cortas (date-fns es)
  useMonthData.js            # padrón y serie del mes, compartidos entre pestañas
  ui/      Sheet, StatCard(infoId), FinKpi, DeltaTag, Sparkline, BreakdownBars(keepOrder/pp),
           MetricTabs(size), Segmented, TipRow, Chip, SectionHeading, Avatar, MesPicker
  explain/ ExplainContext.jsx, InfoButton.jsx, ExplainModal.jsx, FormulaRow.jsx,
           docs/{cfp,finance,commercial,attendance,index}.js
  sections/cfp/  sections/finance/  sections/commercial/  sections/attendance/
src/services/dashboardV2/   (cada uno con su *.test.js)
  padron.js            # adaptador del padrón y derivaciones: due, facturable, IVA, estado, bloqueos, desfase
  financeSeriesV2.js   # banco, caja real, pagado del propio mes, sueldos desglosados, cascada de márgenes, cuadrantes, puente
  benefitsView.js      # promos + descuentos sueltos, corridas, estados, KPIs
  activityTimeline.js  # activo al cierre, altas, bajas, reingresos, heredados
  runRate.js           # MRR = plan vigente × precio versionado × descuento
  attendanceMatrix.js  # expansión de planes − faltas + recuperos
  transportEconomics.js
  queries.js           # lecturas nuevas: client_plans en bloque, descuentos de invoices_view, viajes del mes
```

### Qué se comparte con legacy y qué se copia

| Se importa sin modificar | Se copia en v2 (no editar el original) |
|---|---|
| `Card`, `MonthNavigator`, `Tooltip`, `Modal`, `Toggle` (`src/components/ui/`) | `StatCard` (le falta `infoId`), `BreakdownBars`, `MetricTabs` (le falta `size`) |
| `src/utils/format.js`, `src/utils/date.js` | `Segmented`, `TipRow`, `smoothPath` (no se exportan desde `MonthlyFinanceChart.jsx`) |
| `promotionsView.js` (`promoMonthCollection`, `promoPackageAmount`, `promoOrdinal`, `promoMonthIndex`). No usar `promoState` ni `promoKpis` | `monthWindow.js` (legacy usa 24 meses fijos) |
| `financeSeries.js`: selectores de gasto, `salaryCostForMonth`, `employeeExtraForMonth`, `standaloneExtraForMonth`, `contingencyForMonth` | Versiones v2 de `expensesByCategory`, `lineRevenueKpis`, `breakevenAnalysis`, `deriveKpis` |
| `bulkRows.buildBulkRows` (rutea el cobro), `commercialStats` (funciones del embudo de prueba), `attendanceStats.attendanceRate` | El ejecutor secuencial de `BulkInvoiceModal.processIds`: vive dentro del componente, así que se copia a un servicio v2 |
| `invoiceService`, `promotionService`, `billerService`, `appSettingsService`, `dashboardService` (`getMonthInvoicePanel`, `getBillingBreakdown`) | El `Avatar` de `CollectionPanel.jsx:26` |

**Regla:** en cada fase, `git diff --stat src/pages/Dashboard src/services/dashboard` tiene que salir vacío. La excepción declarada es el arreglo de facturación de promos (B1): cambia `invoiceAmounts.js` y la edge function `biller`, que también usa legacy. Es un bug y corrige ambos lados. Después de agregar clases hay que recompilar Tailwind a mano (`npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`): faltan 65 de las 84 clases con valores arbitrarios y `npm run build` no lo detecta.

---

## 3. Inventario por sección (en el orden en que aparece en la maqueta)

### 3.1 Gestión CFP: cobranza y facturación

| Componente | Portabilidad | Fuente real | Gap |
|---|---|---|---|
| Encabezado + selector Cobranza/Facturación | direct S | conteo de `get_month_collection_panel` | — |
| KPIs de cobranza (Previsto, Cobrado, Pendiente, Paquetes) + barra | adapt S | panel: `attendance_gross`, `transport_gross`, `payment_status`, `paid_amount`, `promo_*`; `promoMonthCollection` | "Cobrado" debe ser `paid_amount` de las filas del mes, no `cash_collected`. Excluir los meses 2..N pendientes y las filas en $0 |
| KPIs de facturación (A facturar, IVA, Sin emitir) + botón de emitir todo | **needs_backend** M | panel `invoice_status`, `invoiced_amount`; `invoices_view` `*_chargeable_*`; `invoiceAmounts.js` | Arreglo B1. IVA = bruto/1,22 y /1,10 (no usar `attendance_net`) |
| Modales "i" (`cfp`, `ivaMes`) | adapt M | derivado | Textos de reglas inventadas (cuotas iguales, devoluciones, 3m/6m) |
| Banner de facturas trabadas | adapt M | `clients_full` (`documentNumber`, `email`, `address`, `billerSyncError`), `invoices_view.emitError` | Bloquear por email o dirección es una regla nueva. Los errores 422 no se guardan. La maqueta mete los "error Biller" en el lote aunque el texto diga que no entran |
| Barra de herramientas: estado, búsqueda, orden | direct S | padrón + `getBillingBreakdown` (frecuencia) | — |
| Barra "lote preparado" (fecha cargada por fila) | adapt M | `markMonthPaid` / `collectPromo`, ruteados con `buildBulkRows` | `collect_promo` es solo superadmin |
| Tabla de Cobranza | adapt L | panel + `getBillingBreakdown` + `invoices_view` + `getPromotions` + `clients_full` | Prorrateo real de altas y bajas. Estados que la maqueta no tiene: vencido, $0, cubierto por promo, corrección pendiente, monto pactado. "Ficha inactiva" no existe. Revertir un ancla debe usar `uncollectPromo` |
| Tabla de Facturación | adapt L | panel `invoice_number`, `invoice_date`; `invoices_view.emitError`, `dgiStatus` | "Sin cobro no hay factura" es una regla nueva de UI. El monto de los meses de promo depende de B1 |
| Barra de selección fija | adapt S | derivado | La emisión masiva de la maqueta saltea Biller; en v2 va por el ejecutor real |
| PaymentModal (registrar cobro) | adapt S | `markMonthPaid(…, notes, paidDate)` / `collectPromo` | Fecha con `todayStr`. Medio de pago y monto distinto: opcionales |
| Confirmación de una factura | adapt M | `calculateMonthBilling`, `emitInvoice`, `lastBusinessDayOfMonth` | Concepto de la maqueta vs `comprobante.ts`. La distancia sale de dos fuentes distintas |
| Modal de facturación en lote | adapt M | `emitInvoice` en secuencia, 1,1 s entre llamadas | Atar el estado del lote al {año, mes}. Separar "sin cobrar" de "datos del receptor" |
| Piezas chicas (Avatar, Chip, SectionHeading) | direct S | `clients_full.avatarUrl` | Agregar chips de estados reales |
| Estados que solo existen en datos reales | adapt S | panel, `invoices_view` (`correctionPending`, `isAmountOverridden`), `ClientDetail.jsx:993` | Vencimiento: día 10 (CLAUDE.md) o día 11 (código) |
| Adaptador del padrón del mes | adapt L | 5 lecturas en paralelo (o B3) | Los días de prorrateo de filas pendientes necesitan `calculate_month_billing` por fila, o B3 |
| Tipo de pago, beneficio, desfase de fecha | adapt S | panel + `invoices_view.discountPercent` | — |
| Devolución por baja | **not_feasible** XL | — | Contradice el prorrateo de `calculate_month_billing`. No portar |

### 3.2 Promociones y otros descuentos (bloque dentro de Gestión CFP)

| Componente | Portabilidad | Fuente real | Gap |
|---|---|---|---|
| Encabezado | direct S | mes elegido | — |
| KPI Con beneficio | adapt S | `getPromotions`, lectura nueva de `invoices_view` (`discountPercent > 0`, `promoId` vacío), base del panel | Agrupar por la duración real de cada promo, no 3m/6m |
| KPI Descuento del mes | adapt M | `getBillingBreakdown` + `att/(1−p)` o `calculateMonthBilling` | Descuento prorrateado vs de lista. No usar snapshots |
| KPI Paquetes que arrancan | adapt S | `promotions` (`start_*`, `total_amount`, `paid_*`), `promoPackageAmount` | Reescribir el texto de advertencia |
| KPI Por renovar | adapt M | `promotions.end_*` + corridas de descuentos sueltos | Descuentos escalonados (25→20→15%): ¿un acuerdo o tres? |
| Barra de cobertura | adapt M | lo mismo, más el mes −6 | Segmentos 3m/6m fijos. El pie queda oculto hasta dic-26 |
| Chips de estado | direct S | — | Las promos futuras quedan invisibles |
| Historial (rango + resumen) | adapt M | `promotions` + historial de descuentos | "Dto total" de las corridas: conviene B5. El estado tiene que ser siempre "Finalizado" (la maqueta rompe) |
| MesPicker | direct S | — | — |
| Reactivar promos | **needs_backend** L | `createPrepaidPromo` (superadmin) | No hay persistencia ni scheduler. Pisa descuentos sueltos sin avisar |
| Tabla Promos prepagas | adapt M | `getPromotions` (+ avatar), `promotionsView` | Textos 3m/10% y 6m/15% |
| Tabla Otros descuentos | adapt M (**needs_backend** con Motivo) | `invoices_view` | El motivo no existe. No hay una entidad "acuerdo de descuento" |
| Capa de datos (`benefitsView`) y 8 modales | adapt M | — | Módulo puro nuevo y textos nuevos |

### 3.3 Finanzas

| Componente | Portabilidad | Fuente real | Gap |
|---|---|---|---|
| Serie mensual y ventana (desde 2026-06) | **needs_backend** M (alternativa en cliente) | `get_dashboard_finance_series` + `mergeFinanceSeries` | El previsto pierde a los clientes dados de baja. No hay "banco" agregado. Sueldos en un solo número. Prestadores sin fechas. No tiene guarda de rol |
| `selectIncome` con 3 bases (previsto, cobrado, banco) | needs_backend M (alternativa: una llamada al panel por mes) | panel + `promoMonthCollection` | Snapshot del ancla de sep (+64.240). Las notas de crédito son solo de la maqueta |
| Selectores de gasto | direct S | `financeSeries.js` (código idéntico) | Las compras de activo están cargadas como gasto variable |
| Cascada bruto / operativo / neto (`marginKpis`) | adapt M | salaryCalc, `providerCostForMonth`, `director_bps` | Separar por `systemKey`. `director_bps` solo se crea al abrir Costos |
| `deriveKpis` / extended / líneas v2 | adapt S | financeSeries + `invoices_view` | La tasa de cobro legacy pasa el 100% |
| Recorte de período, selector de vista, rango, años, meses, Interanual, Limpiar, avisos | direct S–M | cliente | Años e Interanual sirven recién desde 2027 |
| Encabezado + cifras destacadas | adapt S | derivado | El texto dice "cobrado" pero el dato es "banco" |
| Vista Pesos + leyenda | adapt M | maquetado de `MonthlyFinanceChart.jsx` | La línea de margen recorta los negativos a 0 |
| Vista Tendencia / vista Márgenes / tabla comparativa | direct M | derivado | Comparaciones año contra año vacías hasta 2027 |
| Meta de margen neto (MetaNetoControl) | adapt S | `app_settings` vía `setSetting` | Clave nueva. Sin política de DELETE: se borra guardando `''` |
| KPI Previsto a ingresar | adapt M | panel por mes + `cash_collected` | "Ya entró" debe salir del estado de cada fila, no de la caja del mes (en jun había 155k cobrados en mayo) |
| KPI Total gastos / KPI Resultado | adapt S | serie v2 | Prestadores. La base es mixta: ingreso "banco" contra costo devengado |
| KPI Margen promedio | adapt M | serie de N meses | Acotar a jun-2026 |
| Cuadrante Personal | adapt M | sueldos, extras, prestadores | Hay que desglosar. Doble conteo jul/ago |
| Cuadrante Fijos / Variables / Extraordinarios | adapt S | serie | La tabla `extraordinary_expenses` está vacía, así que "Extraordinarios" siempre da 0 |
| Gastos por categoría | adapt M | `expense_categories` + vistas | Mes anterior y desglose por tipo |
| Caja e impuestos | adapt M | panel + `calculateMonthBilling` | No existen devoluciones. El desglose "cuotas plenas − prorrateos" necesita tarifas por cliente |
| Puente de rentabilidad | adapt M | serie v2 | El texto de la maqueta lo compara con un margen de caja |
| Ingreso por línea | adapt S | `getBillingBreakdown` | Todos los meses comparados deben salir de la misma fuente |
| Transporte por banda | adapt L | `transport_*` + `getBillingBreakdown` + prestadores "Chofer" | Modelo de pago a choferes. Chofer↔auto solo se deduce del nombre del auto. Falta Gonzalo. Hay viajes sin facturar |
| Punto de equilibrio + gráfico PV | adapt M | `breakevenAnalysis` + panel | Las compras de activo inflan el costo variable por usuario |

### 3.4 Comercial

| Componente | Portabilidad | Fuente real | Gap |
|---|---|---|---|
| KPI Clientes activos | adapt M | `clients_full` + `client_inactivity_periods` | Clientes heredados. Reingresos. Períodos mal cargados |
| KPI MRR contratado | adapt M | `client_plans` en bloque + `getPlanPriceSync` / `getTransportPriceSync` (año y mes) + `invoices_view.discountPercent` | — (control oct-26: 1.568.724 neto) |
| KPI Churn 12 meses | adapt M | línea de tiempo | Definición de baja. La comparación contra la ventana anterior aparece recién en may-2028 |
| KPI MRR ganado y perdido | adapt M | valuación + línea de tiempo | Reingresos. No hay evento de cambio de plan: queda como residuo |
| KPI Permanencia media | adapt S | `start_date` | 35 de los 50 activos son heredados |
| Ocupación + control de aforo | adapt M | `client_plans` (`assigned_days`, `schedule`), `getBillingBreakdown` | El aforo no existe. El turno mañana son solo clientes de día completo. No usar la serie financiera legacy |
| Mapa de calor (Cupos / Tiers) | adapt M | lo mismo + `cognitive_level`; `buildPlannedRoster` | El tier no tiene historial |
| Composición de la base | adapt S | plan vigente + `birth_date` | — |
| Aporte a la facturación | adapt M | valuación de MRR | Base a definir: lista, MRR o facturado |
| Altas vs bajas | adapt M | línea de tiempo | Interanual vacío hasta jun-27 |
| Bajas por motivo | adapt M (needs_backend si se guarda "accionable") | `client_inactivity_periods.reason`, `deactivation_reasons` | "Accionable" no existe. Las reversiones quedan con motivo `other` |
| Retención por cohortes | adapt L | línea de tiempo | Heredados. ¿El alta es la fecha de conversión o `start_date`? |
| MetricTabs tamaño `sm` / 13 modales | direct S / adapt M | — | Textos con "30 lugares" y "feb-2024" |

### 3.5 Asistencia

| Componente | Portabilidad | Fuente real | Gap |
|---|---|---|---|
| Motor de asistencia | adapt M | lectura nueva de `client_plans` en bloque, `getAttendanceForDateRange`, `clients_full`, `isInactiveOn` | `get_attendance_stats` legacy no sirve. Hay que descartar faltas en días inactivos y filas sobrantes de faltas deshechas |
| 4 KPIs | adapt S | motor | Faltas justificadas no cobrables ("licencia"): ¿dentro o fuera del denominador? |
| Tasa por segmento | adapt S | motor + `cognitive_level` | `keepOrder`. Tier sin historial |
| Tendencia mensual | adapt S | motor + TrendLine | Recortar a los meses con datos |
| Asistencia real vs contratada (semana promedio) | adapt M | motor | La tasa de recupero tiene dos definiciones en la maqueta. No hay feriados |
| Motivación | adapt M | `client_followup_reports.motivation` (filas crudas de `getLatestMotivations`) | Poca cobertura: hace falta un balde "sin dato". No hay reportes desde el 18-09 |
| Período de prueba | adapt S | funciones de prueba de `commercialStats` + `getReasons` | ¿Por cohorte de inicio o por mes de resolución? |
| 6 modales (8 botones) | adapt M | — | Textos falsos: turno, suspensiones, "toda alta viene de una prueba" |

### 3.6 Elementos comunes (estructura e infraestructura)

| Componente | Portabilidad | Nota |
|---|---|---|
| Estructura base + pestañas + permisos + ventana de meses | adapt S | Ver §2 |
| MonthNavigator | direct S | Reutilizar el de `src/components/ui/` |
| ExplainContext, InfoButton, ExplainModal, FormulaRow | direct S | **Arreglos al portar:** signo (`Math.abs` oculta negativos), `—` cuando falta el dato, Escape solo con el modal abierto, bloqueo de scroll, foco, `role=dialog` |
| Sheet (panel inferior en celular) | direct S | Se usa 3 veces: explicación, cobro, emitir |
| Registro de los 45 textos | adapt L | Reescribirlos todos. Test de integridad: cada id existe, las filas suman el total, no rompe con datos parciales |
| Capa de datos asíncrona (cargas, errores, vacíos) | adapt M | La maqueta es sincrónica. Desactivar los botones "i" hasta que haya datos |

---

## 4. Trabajo de backend (consolidado)

| # | Trabajo | Tipo | ¿Obligatorio? | Qué desbloquea |
|---|---|---|---|---|
| **B1** | **Facturación de meses de promo:** en `emit_invoice` (`supabase/functions/biller/index.ts:99-118`), si el mes tiene `promo_id`, facturar el servicio de ese mes y no el `paid_amount` del ancla. Reflejarlo en `src/services/invoices/invoiceAmounts.js` (`prorateInvoiceLines`, `billableTotal`) con sus tests | Edge function + front | **Sí**, antes de la Fase 4 | KPIs A facturar e IVA, tabla de Facturación, confirmación, lote. También arregla legacy (`EmitInvoiceModal`, `CollectionPanel`) |
| **B2** | **Seguridad:** agregar guarda `is_admin_or_superadmin()` a `mark_month_paid`, `mark_month_invoiced` y `apply_plan_discount`, y que esta última rechace meses con `promo_id`. Quitar el permiso de ejecución a `anon` en esas tres y en `mark_invoice_emitted`, `mark_invoice_voided`, `set_invoice_emit_error`, `set_invoice_dgi_status`, `set_client_biller_sync`, `calculate_month_billing` y `get_churn_board`. Las que usa solo el biller pueden perderlo también para `authenticated`. Revisar las RLS de UPDATE/DELETE de `monthly_invoices` (hoy alcanza con `is_authenticated()`, que es lo que usa `unmarkMonthPaid`). Partir de `pg_get_functiondef` y medir una métrica de control antes y después | Migración | Muy recomendado antes de la Fase 3 | Habilitar escrituras de cobro, descuento y reversión con seguridad |
| B3 | `get_month_collection_panel_v2`: función nueva, la actual no se toca. Devuelve el padrón ancho en una sola llamada: plan vigente, dirección, `discount_percent`, `payment_notes`, `emit_error`, `dgi_status`, `correction_pending`, `is_amount_overridden`, `promotions.paid_date`, días de prorrateo y `attendanceMonthlyRateGross`. Con guarda de rol | RPC | Opcional | Rendimiento de Gestión CFP. Días de alta y baja en filas pendientes |
| B4 | `get_dashboard_finance_series_v2`: con `is_superadmin()`, la misma población que el panel (clientes regulares, incluidos los dados de baja con cargo en el mes), `banco_*`, caja real (`paid_amount` por `paid_date`), `paid_own_*` y `expenses_total` | RPC | Opcional pero recomendado | Gráfico principal, Margen promedio, sparklines y variaciones mes a mes y año a año, sin una llamada al panel por mes |
| B5 | `get_benefit_ledger(desde, hasta)`: descuento antes y después por cliente y mes | RPC | Opcional | Descuento del mes, "Dto total" del Historial, cobertura de hace 6 meses |
| B6 | Fechas de vigencia en `service_providers` (mes desde/hasta) + marca de chofer, y limpieza de los extras sueltos de jul/ago (114.500 por mes) | Migración + datos | Recomendado | Personal, Puente, margen bruto, Total gastos y Transporte históricos |
| B7 | Limpieza de datos, revisándola con el usuario y usando los flujos reales (no SQL directo): snapshot del ancla 9676f2cc (sep-26); fechas de pago anteriores al lanzamiento (216.800; la del 2025-12-29 parece un error de tipeo); períodos de inactividad mal cargados (1d9babaf, e7a74d05, 6d86dfb3, d229b739); prueba 9c3a43bb | Datos | Recomendado | Controles de Finanzas y Comercial |
| B8 | Claves de `app_settings` (sin cambios de esquema): `platform_start`, `net_margin_target`, `shift_capacity` | Config | Según decisión 6 | Ventana de meses, meta neto, ocupación y mapa de calor |
| B9 | Columna `deactivation_reasons.is_actionable` + interruptor en `ReasonsManagerModal.jsx` | Migración chica | Opcional | Punto de "accionable" en Bajas por motivo |
| B10 | Motivo de descuento: catálogo `discount_reasons` + columna, o tabla de acuerdos. Agregar `p_reason` a `apply_plan_discount` y borrar la firma vieja (si no, quedan dos versiones de la función y la llamada falla) | Migración | Condicional | Columna Motivo en Otros descuentos |
| B11 | `renew_prepaid_promos(p_promo_ids)`: atómica, solo superadmin, llama primero a `ensure_client_months` y devuelve el resultado por fila | RPC | Condicional | Reactivar promos sin riesgo de quedar a medias |
| B12 | `transport_shift_cars.driver_provider_id` (+ `pay_mode` / `per_trip_rate` si el pago por tramo es real) | Migración + UI de Transporte | Condicional | Costo de transporte por chofer |
| B13 | Pausa vs baja: un campo `kind` en `client_inactivity_periods`, o usar `churn_followups.stage` | Migración | Condicional | Churn, altas/bajas y cohortes exactos |
| B14 | Generar `director_bps` desde la base (hoy se crea recién cuando alguien abre Costos) | Migración | Opcional | Personal del mes en curso |
| B15 | `get_attendance_matrix`, `get_commercial_roster`, `get_transport_month_economics` | RPC | Solo por rendimiento | Llevan guarda explícita: `calculate_month_billing` corre con permisos elevados y sin chequeo de rol |

**Bugs de legacy a arreglar aparte** (v2 no los arrastra y legacy no se toca):
- [x] "Deshacer cobro" en la ficha llamaba a `unmarkMonthPaid` sobre un ancla de promo y dejaba el paquete trabado. Ahora
      usa `uncollectPromo` (con confirmación; solo superadmin, como la RPC). 2026-11-06: no había paquetes trabados en la base.
- `get_dashboard_finance_series` filtra `deleted_at IS NULL`, así que el previsto de meses pasados pierde a los clientes que después se dieron de baja.
- La tasa de `get_attendance_stats` está mal.
- `REASON_LABELS` no tiene la clave `problema_de_salud_transitorio`.

**Fuera de alcance** (el motivo de cada uno, en "Qué queda fuera y por qué", al principio): calendario de feriados, historial de `cognitive_level`, fecha de egreso de empleados (Finanzas la aproxima con `updated_at`), entidad de devoluciones y nota de crédito parcial en Biller, `promo_renewal_decisions` con un programador (`pg_cron` está disponible pero no habilitado). El turno de la falta no es esquema: `attendance_records.shift` existe y falta que `register_absence` lo reciba (cambio de RPC).

---

## 5. Conceptos de negocio que inventa la maqueta

| Concepto | Qué implica soportarlo de verdad | Opciones | Recomendación |
|---|---|---|---|
| Devolución por baja (`DIA_TOPE_DEVOLUCION = 10`; "la baja paga el mes completo") | Contradice `calculate_month_billing`, que prorratea hasta `deactivation_date − 1`. Haría falta una entidad de devoluciones, nota de crédito parcial en Biller y su impacto en caja | omitir / diseñar la funcionalidad | **Omitir.** Mostrar "baja del mes" con el monto prorrateado real |
| Aforo por turno (30, rango 5–60) | Un parámetro nuevo. Hoy el turno mañana son solo clientes de día completo (3–5 por día contra 21–27 a la tarde) | parámetro guardado / control local para simular / omitir | Guardar `shift_capacity` en `app_settings`, editable en Gerencia. El control del dashboard solo simula |
| Meta de margen neto | Parámetro global | `app_settings` / omitir | `net_margin_target`, arranca "sin definir" |
| Ingreso "previsto al banco" (paquete entero en el mes ancla, $0 en los meses cubiertos) | Se calcula con el panel y `promoMonthCollection` | adoptar / quedarse con previsto devengado | Adoptar como cifra principal, con la etiqueta "A ingresar al banco" (la maqueta lo llama a la vez cobrado, caja y devengado) |
| Promos fijas 3m/10% y 6m/15% | Limitaría `PrepaidPromoModal`. El sistema real acepta cualquier N ≥ 1 y 1–100% | adoptar como política / modelo libre | **Modelo libre.** Agrupar por duración real |
| Facturar la promo en cuotas iguales (total/N) | Choca con CLAUDE.md: cada e-factura es el servicio de su mes | total/N / servicio del mes | Servicio del mes (B1) |
| Renovar promos en el cierre de mes | No hay scheduler ni evento de cierre | diferido (XL) / crear al confirmar / omitir | Botón que crea al confirmar (superadmin), con aviso si pisa un descuento suelto |
| Motivo de descuento; descuento como acuerdo con nombre | Catálogo + columna o tabla (B10) | omitir en v1 / migración | Omitir la columna en v1. Las corridas se agrupan por heurística |
| Motivos de baja accionables | Columna `is_actionable` (B9) o un mapeo fijo | — | Fuera por la decisión del 30-10. Con un mapeo fijo no haría falta esquema |
| Clientes heredados (cargados al lanzar) | No hay marca. Proxy: `start_date = 2026-06-01` (43 clientes) | `platform_start` + convención / columna `is_migrated` | `app_settings.platform_start = '2026-06'` + la convención |
| Reingreso cuenta como alta; pausa vs baja | Es la única definición en la que activos(mes anterior) + altas − bajas = activos(mes) cierra. Los datos tienen errores | — | Ver decisión 3 |
| Pago a choferes por tramo ($650) y descuento por faltas al chofer fijo | No hay tarifa por viaje ni registro de faltas del chofer | omitir / B12 | Costo mensual plano repartido en partes iguales por tramo |
| Costos del vehículo dentro de transporte | Ya existe la categoría "Vehículo" | incluir / excluir | Excluir en v1, decirlo en la explicación |
| "Sin cobro no hay factura"; email y dirección válidos para emitir | Reglas de UI. Hoy el servidor solo exige documento | bloqueo / aviso | Cobro previo: bloqueo en UI (en los datos nunca pasó lo contrario). Email y dirección: solo aviso |
| Ventana de fecha de pago + etiquetas anticipado/atrasado | Validación en el front | — | Adoptar: es un cálculo puro |
| Motivación como métrica de cartera | El dato existe pero es escaso (sin reportes desde el 18-09) | 4.º balde "sin dato" / excluir y mostrar cobertura | 4.º balde gris + cobertura |
| Unidad "turno" (día completo = 2) y licencia fuera del denominador | La columna `attendance_records.shift` existe, pero `register_absence` no la llena: ninguna falta tiene turno | turno / día-cliente | Día-cliente (como se guarda y como factura `calculate_month_billing`). Licencia fuera del denominador, como en legacy |
| Umbrales: cobertura 30%, cobranza 90/70%, conversión 60% | Constantes de UI | — | Dejarlos como constantes, documentados en la "i" |
| Alertas operativas (2 faltas seguidas, caída del 25%) y calendario de feriados | Funcionalidades nuevas. Las alertas se calcularían con lo que existe; los feriados necesitan una tabla | — | Omitir y mencionarlo en la explicación |

---

## 6. Escrituras

| Acción en v2 | Flujo real | Rol hoy | Riesgos y reglas |
|---|---|---|---|
| Marcar cobrado (una fila, lote preparado, PaymentModal) | Mes normal: `markMonthPaid(clientId, y, m, null, method?, notes, paidDate)`. Ancla de promo: `collectPromo(promoId, paidDate, null, null, notes)`. Meses 2..N y filas en $0: no se escribe nada | `billing` en UI; `collect_promo` es superadmin | Pasar `p_amount = null` (legacy manda el monto del navegador). Llamadas en secuencia y recarga al final. `mark_month_paid` no tiene guarda en el servidor (B2) |
| Revertir cobro | Mes normal: `unmarkMonthPaid` (UPDATE directo). Ancla: `uncollectPromo` (devuelve todo el rango a pendiente y se niega si hay un mes facturado) | Cualquier autenticado / superadmin | Definir si se puede revertir un mes ya facturado. No repetir el bug de `ClientDetail` |
| Emitir factura (una o en lote) | `emitInvoice(clientId, y, m, { fechaEmision, fechaVencimiento })` → `emit_invoice` → `mark_invoice_emitted` o `set_invoice_emit_error`. Secuencial con 1,1 s entre llamadas. No duplica (`numero_interno`; 409 si ya existe) | admin, superadmin | Depende de B1. Atar el lote a {año, mes}. Los errores 422 (sin documento, monto 0, transporte sin distancia) no se guardan: detectarlos antes en el cliente. Anular: enlazar a `voidInvoice` (superadmin) |
| Reactivar promos | Un `createPrepaidPromo` por promo, o B11 | superadmin | Sin B11 queda a medias si falla una. Pisa descuentos sueltos sin avisar. Correr `ensure_client_months` antes. Solo para el mes en curso |
| Meta de margen neto | `setSetting('net_margin_target', String(n) o '')` | admin+ (RLS) | Valor global. Guardar al cerrar el popover. No guardar `null`, que queda como el texto `'null'` |
| Aforo (si se guarda) | `setSetting('shift_capacity', …)` | admin+ | Separar "probar" de "guardar" |

**No portar** las escrituras simuladas de la maqueta: `aplicar()` y `revertir()` locales, la latencia y el "falla la primera vez" de `emitirLote`, y la emisión masiva de la barra de selección que saltea Biller.

---

## 7. Plan por fases

Verificación común a todas: tests de los módulos puros, tests de legacy en verde, `git diff --stat src/pages/Dashboard src/services/dashboard` vacío, Tailwind recompilado (buscar las clases nuevas en `tailwind.output.css`), revisión visual a 1.216 px y permisos por rol con `useAuth` simulado.

| Fase | Contenido | Esfuerzo | Requisito previo | Verificación / control |
|---|---|---|---|---|
| **0. Estructura base, ruta y menú** | `dashboard_v2` en `FEATURE_ROLES` + test; ruta con carga diferida y `RequireRole`; entrada en el menú; `DashboardV2.jsx` con 4 pestañas con permisos y `PlaceholderCard`; `monthWindow` v2 | S | — | El operador no ve la entrada. El resaltado del menú no enciende las dos. El menú entra a 1.280 px |
| **1. Infraestructura compartida** | Sistema de explicaciones (con los arreglos de signo, `—`, Escape y foco); `Sheet`; piezas de UI; `format.js`; `useMonthData`; registro de textos con test de integridad | M | 0 | Tests con Testing Library (abrir y cerrar, total negativo con `−`, `undefined` como `—`) |
| **2. Gestión CFP, solo lectura** | `padron.js` + tests; KPIs de cobranza; tablas de Cobranza y Facturación sin acciones; filtros; banner de trabadas; estados reales; textos `cfp` | L | 1 | Oct-26: 50 filas (47 pagadas, 3 prepagas), previsto = cobrado = 1.793.460, 1 ancla de 81.000. Sep-26: una fila en $0 |
| **3. Cobranza con escrituras** | Lote preparado, PaymentModal, cobro por fila, revertir (anclas con `uncollectPromo`), selección | M | B2 (al menos las guardas y quitar `anon` en `mark_month_paid` y `apply_plan_discount`); decisión 1 | Con un cliente de prueba, por el flujo real: un ancla cobra todo el rango, revertir el ancla deja la promo cobrable de nuevo |
| **4. Facturación** | Monto facturable que respeta las promos, confirmación individual, lote con el ejecutor real, KPIs de facturación | L | B1 + decisión 2 | Tests de `invoiceAmounts`; una emisión controlada contra el ambiente Biller configurado |
| **5. Promociones y otros descuentos** | `benefitsView.js`; KPIs, cobertura, tablas, Historial; Reactivar como vista previa (o creando promos, según la decisión 6) | L | 2 | Oct-26: 7 de 50 (14%), 1 paquete de 81.000, 2 promos por renovar |
| **6. Asistencia** | `attendanceMatrix.js` + lectura de `client_plans` en bloque; 4 KPIs, segmentos, tendencia, semana promedio, motivación, prueba; textos | L | 1 | Sep-26: 499 días planificados; faltas 2 injustificadas / 44 justificadas cobrables / 12 licencias; 15 recuperos; tasa 88,7% (90,8% sin licencia) |
| **7. Comercial** | `activityTimeline.js`, `runRate.js`; 6 KPIs; ocupación y mapa de calor; composición; aporte; altas/bajas; bajas por motivo; cohortes | L–XL | 1; decisiones 3 y 6 | Activos al cierre jun–oct: 42/44/43/48/50. MRR oct 1.568.724. Activos(mes anterior) + altas − bajas = activos(mes), todos los meses |
| **8. Finanzas: serie v2 + gráfico principal** | `financeSeriesV2.js` (una llamada al panel por mes, o B4); sueldos desglosados; base banco; 3 vistas, filtros y meta neto | L | 1; decisiones 4 y 5 | Banco bruto jun–oct, igual al Previsto de Gestión CFP (una fila cobrada cuenta por lo que entró): 1.632.810 / 1.642.260 / 1.863.325 / 1.767.730 / 1.793.460. Fijos mensualizados jul y ago: 108.693 (sin las plantillas cargadas hacia atrás sobre gastos que ya eran variables). Caja real sep: 1.791.730 |
| **9. Finanzas: tarjetas** | Cuadrantes, categorías, caja e impuestos, puente, líneas, punto de equilibrio; transporte por banda (L por sí sola, puede ir aparte) | L | 8; B6 recomendado | Transporte sep-26: 169.313 neto, 128 tramos, 361 viajes, 70,5% de ocupación |
| **10. Opcionales** | B3, B4, B5 (rendimiento); B9 (accionables); B10 (motivo); B11 (renovación atómica); B12 (chofer↔auto); B13 y B14 | M–XL | según cada decisión | — |

**Orden recomendado y por qué:**
- **Gestión CFP primero.** Es la pestaña por defecto y la de más valor operativo, y reutiliza piezas de legacy. Se hace primero en solo lectura y después habilita escrituras por etapas.
- **Asistencia antes que Comercial.** Es más chica y no depende de nadie.
- **Finanzas al final.** Es la que más depende de decisiones y de limpieza de datos.

Si se prefiere arrancar por el análisis, Asistencia (sin backend y sin escrituras) es lo más rápido de entregar después de la Fase 1.

---

## 8. Decisiones abiertas

1. **Quién ve v2.**
   - **Recomendado:** solo superadmin al principio (`dashboard_v2: ['superadmin']`). Los permisos por pestaña quedan armados para después abrir Gestión CFP y Asistencia a admin, una vez hecha la migración de seguridad (B2).
   - Alternativa: admin y superadmin desde el principio. El admin ganaría la cobranza masiva, que hoy no tiene, y vería deshabilitadas las acciones sobre anclas de promo.
2. **Cómo se facturan los meses de promo, y qué hacer con la factura del ancla de sep-26 ya emitida por 96.360.**
   - **Recomendado:** cada mes se factura por su propio servicio, como dice CLAUDE.md (no total/N).
   - **Para la factura ya emitida, recomendado** (si el contador lo valida): anularla con `void_invoice` (nota de crédito total) y volver a emitir septiembre por su servicio.
   - Alternativa: dejarla como está y no emitir octubre ni noviembre de esa promo.
3. **Bajas, reingresos y heredados.** Recomendado:
   - (a) Sin devoluciones: la baja se sigue prorrateando como hoy.
   - (b) Una baja es un período de inactividad depurado (períodos superpuestos unificados y reversiones de 1 día descartadas), y cada reingreso cuenta como alta. "Pausa temporal" se muestra como una etiqueta.
   - (c) Los 43 clientes con `start_date = 2026-06-01` son heredados, vía `platform_start`.
4. **Cifra principal de ingreso en Finanzas.** Recomendado:
   - Usar "A ingresar al banco", con la etiqueta explícita.
   - Incluir en el previsto de meses pasados a los clientes que después se dieron de baja, como ya hace el panel (jun-26: +201.220 brutos).
   - La serie arranca en 2026-06 y los pagos adelantados se asignan a su mes de servicio.

   Consecuencia: los números de v2 no van a coincidir con los de legacy, a propósito.
5. **Prestadores de servicios.**
   - **Recomendado:** agregar vigencia (mes desde/hasta) a `service_providers` y borrar los extras sueltos de jul/ago que se cuentan dos veces (114.500 por mes). Mientras tanto, aplicar prestadores solo desde sep-2026.
   - Choferes: costo mensual plano repartido por tramo, hasta confirmar si el pago por tramo es real. Gonzalo no está cargado como prestador: confirmar si se le paga.
6. **Qué entra en v1 de lo que inventa la maqueta.** Recomendado (la decisión del 30-10 deja fuera Reactivar promos y "accionable"):
   - **Sí:** aforo (`shift_capacity`, editable en Gerencia) y meta neto (`net_margin_target`, empieza sin definir), guardados en `app_settings`.
   - **Sí:** Reactivar promos como botón que crea al confirmar (superadmin, con aviso si pisa un descuento).
   - **Sí, en la Fase 10:** "accionable" con la migración chica B9.
   - **No:** columna Motivo de descuento, renovación diferida al cierre de mes, pago por tramo, feriados y alertas.

**Lo que asumo si no se dice otra cosa** (cada punto se puede cambiar en su fase):
- La licencia queda fuera del denominador de asistencia, y la unidad es el día-cliente.
- "Cobrado" en Gestión es el `paid_amount` de las filas del mes; Finanzas mide la caja por fecha de pago.
- Para emitir hay que haber cobrado (bloqueo en la UI). Email y dirección solo generan aviso.
- La fecha de emisión queda fija en el último día hábil del mes.
- El navegador de meses llega hasta el mes en curso.
- Hacer clic en una fila la selecciona, y además hay un enlace a la ficha del cliente.
- El vencimiento es el día 10, como dice CLAUDE.md.
- El período de prueba se mide por cohorte de inicio y se muestra en Asistencia.
- La pestaña Promociones de legacy sigue existiendo en legacy.