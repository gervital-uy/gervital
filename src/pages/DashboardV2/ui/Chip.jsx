// Estado de una fila (cobrado, pendiente, cubierto por promo...). `meta` = { label, cls }.
export default function Chip({ meta }) {
  if (!meta) return null
  return <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
}
