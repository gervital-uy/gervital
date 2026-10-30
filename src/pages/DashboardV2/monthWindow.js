import { startOfMonth } from 'date-fns'
import { parseDateOnly } from '../../utils/date'
import { PLATFORM_START_ISO } from '../../services/dashboardV2/platform'

// La ventana del dashboard v2 arranca cuando empezó la plataforma (antes no hay
// datos) y crece sola con cada mes que pasa (legacy usa 24 meses fijos, la mayoría
// vacíos).
export const PLATFORM_START = parseDateOnly(PLATFORM_START_ISO)

// Se calcula al montar y no al cargar el módulo: una pestaña abierta de un mes para
// el otro tiene que poder llegar al mes nuevo.
export const currentMonthStart = () => startOfMonth(new Date())
