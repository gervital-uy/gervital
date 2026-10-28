import { startOfMonth } from 'date-fns'

// La plataforma empezó a funcionar en junio de 2026: antes no hay asistencia, ni
// cobranza, ni costos cargados. La ventana del dashboard v2 arranca ahí y crece sola
// con cada mes que pasa (legacy usa 24 meses fijos, la mayoría vacíos).
export const PLATFORM_START = new Date(2026, 5, 1)

// Se calcula al montar y no al cargar el módulo: una pestaña abierta de un mes para
// el otro tiene que poder llegar al mes nuevo.
export const currentMonthStart = () => startOfMonth(new Date())
