// Contextos de muestra para el test de integridad de las explicaciones (solo lo
// importa docs.test.js). Uno por explicación registrada en index.js:
//   id: { full: ctx con todos los datos, partial: ctx a medio cargar (opcional) }
// Con `full` la explicación tiene que cerrar (valores en todas las filas y la suma
// igual al total); con `partial` y con {} alcanza con que no se rompa.
export const DOC_SAMPLES = {}
