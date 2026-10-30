import { useExplain } from './ExplainContext'

// La "i" al lado de cada número. Desactivada hasta que la sección tiene datos.
export default function InfoButton({ id, className = '' }) {
  const { open, ready } = useExplain()
  return (
    <button
      type="button"
      disabled={!ready}
      onClick={e => { e.stopPropagation(); open(id) }}
      aria-label="Cómo se calcula"
      aria-haspopup="dialog"
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-300 text-[9px] font-bold leading-none text-gray-400 enabled:hover:border-emerald-500 enabled:hover:text-emerald-600 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 transition-colors shrink-0 ${className}`}
    >
      i
    </button>
  )
}
