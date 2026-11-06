// Claves del caché compartido de datos del dashboard (useMonthData) que más de una
// pestaña necesita conocer. Gestión CFP invalida la de Finanzas después de un cobro o
// una factura: si no, Finanzas mostraría lo que entró antes de registrarlo.
export const FINANCE_DATA_KEY = 'finance'
