# Seguimiento de bajas en período de prueba

Fecha: 2026-08-01

## Problema

Un cliente marcado `client_type = 'trial'` ("a prueba") que se da de baja queda
registrado como trial para siempre. Eso genera dos problemas:

1. No hay forma de analizar **cuántos clientes prueban y no se quedan**, ni por qué.
2. Los clientes trial están excluidos de *todas* las métricas comerciales del
   dashboard (MRR, altas/bajas, bajas por motivo, ARPU, breakeven), así que su
   baja es invisible en el análisis.

La reacción intuitiva —revertir `client_type` a `regular` al dar de baja— es
contraproducente: al volverse "regular", el cliente entra a las métricas
comerciales como una baja normal y suma **MRR perdido que nunca se facturó**.
Destruye la distinción en vez de crearla.

## Decisión

No se toca `client_type` al dar de baja. Se registra el **embudo de prueba** como
dato propio y se deriva de ahí la condición "no se quedó tras la prueba".

## Modelo de datos

Dos fechas nuevas en `clients`:

| Columna | Significado |
|---|---|
| `trial_started_at date` | Cuándo el cliente pasó a estar a prueba |
| `trial_converted_at date` | Cuándo dejó de estar a prueba quedándose (pasó a otro tipo estando activo) |

Las mantiene un **trigger** sobre `clients`, no los RPCs. Motivo: el embudo queda
consistente venga el cambio del alta, de la edición, del ABM o de SQL directo —
una sola regla, un solo lugar.

Reglas del trigger:

- INSERT con `client_type = 'trial'` → `trial_started_at = COALESCE(start_date, CURRENT_DATE)`
- UPDATE que entra a `trial` → `trial_started_at = CURRENT_DATE`, `trial_converted_at = NULL`
  (re-entrar a prueba reinicia el embudo)
- UPDATE que sale de `trial` hacia cualquier otro tipo → `trial_converted_at = CURRENT_DATE`

Backfill: los clientes trial existentes reciben `trial_started_at = start_date`.

## Regla derivada: "no se quedó tras la prueba"

Sin columna nueva ni snapshot:

```
estuvoAPrueba  Y  (nuncaSeConvirtió  O  seConvirtióDespuésDeLaFechaDeBaja)
```

En SQL/JS (sin fecha de baja no hay baja en prueba):

```
trial_started_at IS NOT NULL
AND deactivation_date IS NOT NULL
AND (trial_converted_at IS NULL OR trial_converted_at > deactivation_date)
```

Vive en dos lugares que deben mantenerse espejados: `was_trial` en
`get_churn_board()` y `churnedDuringTrial()` en `commercialStats.js`.

Propiedades:

- Sobrevive reintegros y cambios de tipo posteriores a la baja.
- Es **una sola definición** compartida por el board de bajas y el dashboard.
- No depende de que `client_type` siga siendo `'trial'` al momento de leer.

## Superficies

### 1. Board `/bajas`

- `get_churn_board()` devuelve `was_trial boolean` con la regla de arriba.
- Badge naranja **"A prueba"** en `ChurnCard` y en `ChurnCardModal`, con el mismo
  color/etiqueta que usa la lista de clientes (`CLIENT_TYPE_META.trial`).
- Toggle en el header del board: **"Solo bajas en prueba"**, junto al filtro de días.

### 2. Dashboard → Comercial: bloque "Período de prueba"

Bloque nuevo y **aislado**: ninguna métrica existente cambia, los clientes trial
siguen fuera de MRR / altas / bajas / composición.

Contenido, sobre la ventana de meses ya seleccionada:

- **Pruebas iniciadas** (`trial_started_at` dentro del rango)
- **Se quedaron** (`trial_converted_at` dentro del rango)
- **No se quedaron** (baja en prueba con `deactivation_date` dentro del rango)
- **% conversión** = se quedaron / (se quedaron + no se quedaron)
- Desglose de las bajas en prueba **por motivo**

Lógica pura en `src/services/dashboard/commercialStats.js` (`trialFunnelKpis`,
`trialChurnByReason`) con tests, igual que el resto de la sección.

**Limitación conocida y aceptada:** el % de conversión sólo mide de acá en
adelante. Las conversiones anteriores a esta migración no se pueden reconstruir
porque no existía historial de `client_type`. Las bajas en prueba, en cambio,
funcionan desde el día uno.

### 3. Bug adyacente

`churn_followups.mrr_snapshot` calcula el precio de lista sin mirar
`client_type`. Hoy el board muestra "MRR perdido −$30.000" para clientes trial y
charity — plata que nunca se facturó, y que ensucia justamente la lectura que
este trabajo busca habilitar. Se corrige: **snapshot 0 para no facturables**,
tanto en las filas nuevas como en las ya existentes.

## Fuera de alcance

- Historial completo de cambios de `client_type` (auditoría). Dos fechas alcanzan
  para el embudo; una tabla de auditoría es otro problema.
- Duración configurable del período de prueba / vencimiento automático.
- Reconstrucción del histórico de conversiones previo a la migración.
