import { AGE_RANGES, UNKNOWN_SEGMENT } from '../../../services/dashboardV2/commercialView'

// Colores de los desgloses del dashboard v2, compartidos entre pestañas: una clave
// tiene el mismo color en todo el tablero ("2× semana" es el mismo tono en
// Composición, en Aporte y en Asistencia).
//
// Plan, horario y edad son escalas, no categorías: van en una rampa de un solo tono,
// de claro a oscuro, y el oscuro es siempre "más". Es una sola rampa para todas las
// dimensiones (se mira una por vez). El tier conserva sus colores propios.
export const SCALE_RAMP = ['#a0adff', '#828df4', '#676fd5', '#4e54af', '#383d83']
export const TIER_COLORS = { A: '#008300', B: '#2a78d6', C: '#eda100', D: '#e34948' }
export const UNKNOWN_COLOR = '#cbd5e1'

const DIMENSION_COLORS = {
  frequency: Object.fromEntries([1, 2, 3, 4, 5].map((f, i) => [f, SCALE_RAMP[i]])),
  // Tres valores en una escala de cinco: los extremos y el medio, para que abran todo el rango
  schedule: Object.fromEntries(['morning', 'afternoon', 'full_day'].map((k, i) => [k, SCALE_RAMP[i * 2]])),
  cognitiveLevel: TIER_COLORS,
  age: Object.fromEntries(AGE_RANGES.map((r, i) => [r.key, SCALE_RAMP[i]]))
}

export const segmentColor = (dimension, key) => (key === UNKNOWN_SEGMENT ? UNKNOWN_COLOR : DIMENSION_COLORS[dimension]?.[key] || UNKNOWN_COLOR)

// Contraste WCAG: la tinta que va encima de un relleno se elige midiendo, no a ojo.
const channels = hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16))

export function luminance(hex) {
  const [r, g, b] = channels(hex).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// La tinta (oscura o blanca) con más contraste sobre un fondo.
export const inkOn = (background, dark = '#0f172a') => (contrast(dark, background) >= contrast('#ffffff', background) ? dark : '#ffffff')

const toHex = rgb => `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`

// Interpola una escala de colores en t ∈ [0, 1].
export function mixScale(stops, t) {
  const pos = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(pos))
  const a = channels(stops[i])
  const b = channels(stops[i + 1])
  return toHex(a.map((v, k) => v + (b[k] - v) * (pos - i)))
}
