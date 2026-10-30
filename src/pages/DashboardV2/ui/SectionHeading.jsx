// Encabezado de un bloque dentro de una pestaña (Cobranza, Facturación, Promociones).
export default function SectionHeading({ eyebrow, title, hint, right }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 pb-2">
      <div>
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{eyebrow}</p>}
        <h2 className="text-[17px] font-bold text-gray-900 mt-0.5">{title}</h2>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      {right}
    </div>
  )
}
