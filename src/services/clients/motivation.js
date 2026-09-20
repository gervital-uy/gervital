// Motivación del cliente. Se registra en los informes de seguimiento
// (client_followup_reports.motivation) y la vigente es la del informe más reciente
// que la tenga cargada: un informe posterior sin motivación no pisa a la anterior.
// Colores alineados a la paleta de la app (alta=verde, media=ámbar, baja=rojo),
// igual criterio que los niveles cognitivos.
export const MOTIVATIONS = [
  { value: 'alta', label: 'Alta', hex: '#10b981', dot: 'bg-emerald-500', active: 'border-emerald-500 bg-emerald-500 text-white', chip: 'bg-emerald-50 text-emerald-700', border: 'border-l-emerald-500' },
  { value: 'media', label: 'Media', hex: '#f59e0b', dot: 'bg-amber-500', active: 'border-amber-500 bg-amber-500 text-white', chip: 'bg-amber-50 text-amber-700', border: 'border-l-amber-500' },
  { value: 'baja', label: 'Baja', hex: '#ef4444', dot: 'bg-red-500', active: 'border-red-500 bg-red-500 text-white', chip: 'bg-red-50 text-red-700', border: 'border-l-red-500' }
]

export const motivationConfig = (v) => MOTIVATIONS.find(m => m.value === v)

// Motivación vigente a partir de una lista de informes (objetos camelCase del
// followupService). Devuelve el valor ('alta' | 'media' | 'baja') o null.
export function latestMotivation(reports) {
  const withMotivation = (reports || []).filter(r => r.motivation)
  if (withMotivation.length === 0) return null
  const sorted = [...withMotivation].sort((a, b) =>
    (b.reportDate || '').localeCompare(a.reportDate || '') ||
    (b.createdAt || '').localeCompare(a.createdAt || '')
  )
  return sorted[0].motivation
}
