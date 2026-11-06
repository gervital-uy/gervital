// Interruptor de vistas de una tarjeta (Cupos / Tiers, Mensual / Trimestral).
// Distinto de MetricTabs a propósito: este cambia cómo se dibuja el mismo dato,
// aquel cambia la dimensión del desglose. options: [{ id, label }].
export default function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex bg-gray-100 rounded-full p-0.5">
      {options.map(o => {
        const active = String(value) === String(o.id)
        return (
          <button
            key={String(o.id)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
              active ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
