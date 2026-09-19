// Elección de si una falta justificada se cobra. El default siempre es cobrable
// (ver migración 084): que se descuente es una concesión, no el caso base.
const OPTIONS = [
  { value: true, label: 'Cobrable + recupero', hint: 'Se cobra el día y suma 1 día de recupero' },
  { value: false, label: 'No cobrable', hint: 'No se cobra el día, sin recupero' }
]

export default function AbsenceChargeableChoice({ value, onChange, disabled }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">Tipo de falta justificada</label>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map(opt => {
          const selected = value === opt.value
          return (
            <button
              key={String(opt.value)}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(opt.value)}
              className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                selected
                  ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-300'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="text-sm font-medium text-gray-900">{opt.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{opt.hint}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
