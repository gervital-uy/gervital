// Opciones excluyentes en una pastilla (la vista de un gráfico, el rango de meses).
// Copia de la de legacy (MonthlyFinanceChart no la exporta) con aria-pressed.
// `value` null deja ninguna marcada: el rango, cuando manda un filtro de años y meses.
export default function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex bg-gray-100 rounded-full p-0.5">
      {options.map(o => {
        const on = value != null && String(value) === String(o.id)
        return (
          <button
            key={String(o.id)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
              on ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
