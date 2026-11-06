// Una fila del globo de un gráfico: la marca de la serie, su nombre y el valor ya
// formateado. El valor va en tinta, nunca en el color de la serie.
export default function TipRow({ color, label, value, square = false, valueClass = 'text-gray-900' }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={`w-1.5 h-1.5 shrink-0 ${square ? 'rounded-sm' : 'rounded-full'}`} style={{ background: color }} />
      <span className="text-gray-400 min-w-[7rem]">{label}</span>
      <span className={`ml-auto font-semibold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  )
}
