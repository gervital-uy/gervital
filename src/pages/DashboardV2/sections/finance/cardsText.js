// Rótulos y colores de las tarjetas de análisis de Finanzas. El personal va en la
// familia gris (más oscuro cuanto más estructural), el resto del gasto en índigo y
// lo extraordinario en rosa: es la excepción.

export const PART_LABELS = {
  salaries: 'Sueldos (costo empresa)',
  providers: 'Prestadores',
  extras: 'Extras del personal',
  director: 'Aporte de directores',
  fixed: 'Fijos',
  variable: 'Variables',
  extraordinary: 'Extraordinarios'
}

export const PART_COLORS = {
  salaries: '#475569',
  providers: '#64748b',
  extras: '#94a3b8',
  director: '#cbd5e1',
  fixed: '#4e54af',
  variable: '#828df4',
  extraordinary: '#e11d48'
}

// [renglón 1, renglón 2] de cada barra del puente.
export const BRIDGE_LABELS = {
  income: ['Ingresos', 'sin IVA'],
  salaries: ['Sueldos', 'y cargas'],
  providers: ['Prestadores', 'de servicios'],
  extras: ['Extras', 'y directores'],
  fixed: ['Gastos', 'fijos'],
  variable: ['Gastos', 'variables'],
  extraordinary: ['Gastos', 'extraordinarios'],
  net: ['Resultado', 'del mes']
}

export const BRIDGE_COLORS = {
  income: '#059669',
  salaries: '#475569',
  providers: '#64748b',
  extras: '#94a3b8',
  fixed: '#4e54af',
  variable: '#828df4',
  extraordinary: '#e11d48',
  net: '#334155',
  loss: '#be123c'
}

export const BAND_LABELS = {
  '0_to_2km': '0 a 2 km',
  '2_to_5km': '2 a 5 km',
  '5_to_10km': '5 a 10 km',
  none: 'Sin distancia cargada'
}

export const TRANSPORT_COLORS = { revenue: '#059669', cost: '#eb6834' }

// Subir es en contra en un gasto: verde si baja, rojo si sube.
export const COST_DELTA = { up: '#be123c', down: '#0f766e', flat: '#9ca3af' }

export const CARD_CLASS = 'rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]'
