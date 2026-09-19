import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

// Tooltip en hover renderizado en un portal con position fixed: aparece al
// instante (a diferencia del title nativo) y no lo recorta ningún ancestro con
// overflow, que es el caso de los chips dentro del panel de Transporte y del
// pool de Grupos.
//
// El wrapper usa display:contents para no meterse en el layout flex del padre;
// los eventos de mouse igual burbujean desde los hijos.
const MAX_WIDTH = 240
const HALF = MAX_WIDTH / 2

export default function Tooltip({ title, detail, children }) {
  const [pos, setPos] = useState(null)
  const anchorRef = useRef(null)

  if (!title) return children

  const show = () => {
    // OJO: el wrapper es display:contents, que no genera caja — medirlo a él
    // devuelve un rect en cero y el tooltip termina en la esquina de la
    // pantalla. Se mide el hijo, que es el elemento que realmente se ve.
    const rect = (anchorRef.current?.firstElementChild || anchorRef.current)?.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) return
    // Centrado sobre el ancla, clampeado para no salirse de la ventana.
    const x = Math.min(Math.max(rect.left + rect.width / 2, HALF + 8), window.innerWidth - HALF - 8)
    setPos({ x, y: rect.bottom + 6 })
  }

  return (
    <>
      <span ref={anchorRef} className="contents" onMouseEnter={show} onMouseLeave={() => setPos(null)}>
        {children}
      </span>
      {pos && createPortal(
        <div
          role="tooltip"
          style={{ left: pos.x, top: pos.y, maxWidth: MAX_WIDTH }}
          className="fixed z-50 -translate-x-1/2 px-2 py-1 rounded-md bg-gray-900 text-white text-xs leading-snug shadow-lg pointer-events-none"
        >
          <span className="font-medium">{title}</span>
          {detail && <span className="block text-gray-300 mt-0.5">{detail}</span>}
        </div>,
        document.body
      )}
    </>
  )
}
