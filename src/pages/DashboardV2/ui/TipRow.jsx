// Una fila del globo de un gráfico: color, rótulo y valor ya formateado.
export default function TipRow({ color, label, value }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-gray-400 w-24">{label}</span>
      <span className="text-gray-900 font-semibold tabular-nums">{value}</span>
    </div>
  )
}
