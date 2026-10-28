import Card from '../../components/ui/Card'

// Pestaña todavía sin portar: lista las tarjetas que va a tener, en el orden en que
// las muestra la maqueta. Cada fase reemplaza el placeholder por la sección real.
export default function SectionPlaceholder({ cards }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {cards.map(card => (
        <Card key={card.title} className="border-dashed">
          <div className="flex flex-col items-center justify-center text-center px-6 py-8 min-h-[140px]">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{card.title}</span>
            <p className="text-sm text-gray-400 mt-2 max-w-xs">{card.hint}</p>
            <span className="mt-3 text-[11px] font-medium text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded-full">
              próximamente
            </span>
          </div>
        </Card>
      ))}
    </div>
  )
}
