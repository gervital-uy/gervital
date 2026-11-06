// Selector de la dimensión de un desglose (Plan, Horario, Tier, Edad). Copia del de
// legacy (charts/MetricTabs.jsx) con `size`: 'sm' es la versión compacta, para
// cuando el selector convive con el título en una tarjeta de media pantalla.
// options: [{ value, label }]; quien llama guarda el valor elegido.
export default function MetricTabs({ options, value, onChange, size = 'md', label }) {
  const sm = size === 'sm'
  return (
    <div role="group" aria-label={label} className={`inline-flex bg-gray-100 rounded-lg ${sm ? 'p-[2px]' : 'p-[3px]'}`}>
      {options.map(o => {
        const active = String(value) === String(o.value)
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`font-semibold rounded-md whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              sm ? 'text-[11.5px] px-2 py-[3px]' : 'text-[12.5px] px-3 py-1'
            } ${active ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
