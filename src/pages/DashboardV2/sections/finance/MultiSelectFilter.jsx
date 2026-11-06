import { useEffect, useId, useRef, useState } from 'react'

// Desplegable de selección múltiple, uno solo para años y para meses: mismo gesto y
// mismo aspecto. `active`: el filtro manda (si no, el período es una ventana de meses
// y el desplegable solo muestra su título). Con todo tildado, el primer clic aísla esa
// opción en vez de sacarla: es lo que espera quien abre el menú para ver un mes. Shift
// + clic aplica el mismo gesto a todo el tramo desde la última opción tocada.
// `disabled` (con `disabledReason`) deja el botón visible y explica por qué no se usa.
export default function MultiSelectFilter({
  title, unit, options, selection, onChange, active, columns = 1, width = 168, disabled = false, disabledReason
}) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const box = useRef(null)
  const last = useRef(null)
  const menuId = useId()
  const reasonId = useId()

  useEffect(() => {
    if (!open) return
    const outside = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const key = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const ids = options.map(o => o.id)
  const chosen = ids.filter(id => selection.includes(id))
  const all = chosen.length === ids.length
  const positions = chosen.map(id => ids.indexOf(id))
  const contiguous = positions.length > 1 && positions[positions.length - 1] - positions[0] === positions.length - 1
  const nameOf = id => options.find(o => o.id === id)?.label
  const marked = active && !all
  const summary = !active || all ? title
    : chosen.length === 0 ? 'Ninguno'
    : chosen.length === 1 ? nameOf(chosen[0])
    : contiguous ? `${nameOf(chosen[0])}–${nameOf(chosen[chosen.length - 1])}`
    : `${chosen.length} ${unit}`

  const toggle = (id, range) => {
    if (!active || all) {
      onChange([id])
    } else if (range && last.current != null && ids.includes(last.current)) {
      const a = ids.indexOf(last.current)
      const b = ids.indexOf(id)
      const stretch = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
      onChange(selection.includes(id) ? selection.filter(x => !stretch.includes(x)) : [...new Set([...selection, ...stretch])])
    } else {
      onChange(selection.includes(id) ? selection.filter(x => x !== id) : [...selection, id])
    }
    last.current = id
  }

  // En un teléfono el botón puede quedar cerca del borde derecho: el menú se abre
  // hacia la izquierda para no salirse de la pantalla.
  const openMenu = () => {
    const rect = box.current?.getBoundingClientRect()
    setAlignRight(!!rect && rect.left + width > window.innerWidth - 16)
    setOpen(o => !o)
  }

  return (
    <div className="relative" ref={box}>
      {/* El texto del botón es lo elegido ("oct", "Ninguno"): el nombre accesible
          lleva además el título, o un lector de pantalla no sabría de qué filtro es. */}
      <button
        type="button"
        onClick={openMenu}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={summary === title ? title : `${title}: ${summary}`}
        aria-describedby={disabled && disabledReason ? reasonId : undefined}
        title={disabled ? disabledReason : `${title}: se puede elegir más de uno`}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2.5 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
          disabled ? 'text-gray-300 cursor-not-allowed' : marked ? 'bg-gray-900 text-white' : active ? 'bg-gray-200 text-gray-700' : 'text-gray-500 hover:bg-gray-100'
        }`}
      >
        {summary}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {disabled && disabledReason && <span id={reasonId} className="sr-only">{disabledReason}</span>}

      {open && (
        <div
          id={menuId}
          role="group"
          aria-label={title}
          className={`absolute z-30 mt-1.5 rounded-xl border border-gray-200 bg-white shadow-lg p-1.5 max-w-[calc(100vw-2rem)] ${alignRight ? 'right-0' : 'left-0'}`}
          style={{ width }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 px-2 pt-1 pb-1">{title}</p>
          <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {options.map(o => {
              const on = active && selection.includes(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  onClick={e => toggle(o.id, e.shiftKey)}
                  className="w-full flex items-center gap-1.5 text-[12px] rounded-lg px-1.5 py-1.5 hover:bg-gray-50 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <span className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center shrink-0 ${on ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                    {on && (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  <span className={`truncate ${on ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>{o.label}</span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-1 mt-1 pt-1 border-t border-gray-100">
            <button type="button" onClick={() => onChange(ids)} className="flex-1 text-[11.5px] font-medium text-gray-600 hover:bg-gray-50 rounded-lg px-2 py-1.5 transition-colors">
              Todos
            </button>
            <button type="button" onClick={() => onChange([])} className="flex-1 text-[11.5px] font-medium text-gray-600 hover:bg-gray-50 rounded-lg px-2 py-1.5 transition-colors">
              Ninguno
            </button>
          </div>
          <p className="text-[10px] text-gray-300 px-2 pt-1 pb-0.5">Shift + clic para un tramo</p>
        </div>
      )}
    </div>
  )
}
