// Fecha del depósito en la fila, con las dos vías: clic en el ícono para elegirla
// del almanaque, o escribirla sobre dd/mm/aaaa (ver .fecha-pago en index.css). Sin
// fecha la celda queda en ámbar: es lo que falta para poder marcar el cobro. Una
// fecha fuera del rango del mes queda en rojo.
export default function PaymentDateCell({ value, min, max, onChange, label, disabled, invalid }) {
  const tone = invalid
    ? { box: 'bg-rose-50 hover:bg-rose-100', icon: 'text-rose-500', text: 'text-rose-700' }
    : value
      ? { box: 'hover:bg-gray-100', icon: 'text-gray-400', text: 'text-gray-700' }
      : { box: 'bg-amber-50 hover:bg-amber-100', icon: 'text-amber-500', text: 'text-amber-700' }
  return (
    <div
      onClick={e => e.stopPropagation()}
      className={`relative mx-auto flex w-[112px] items-center rounded-md transition-colors ${tone.box}`}
    >
      <svg
        className={`pointer-events-none absolute left-[5px] w-3.5 h-3.5 ${tone.icon}`}
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M8 3v3M16 3v3M3 10h18" />
      </svg>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={`fecha-pago w-full border-0 bg-transparent py-1 pl-[26px] pr-1 text-[11.5px] tabular-nums leading-none focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-inset rounded-md disabled:opacity-50 ${tone.text}`}
      />
    </div>
  )
}
