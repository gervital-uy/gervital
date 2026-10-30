import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Panel modal del dashboard v2: hoja que sube desde abajo en el celular y diálogo
// centrado desde `sm`. Lo usan la explicación de cada número, el cobro y la emisión.
// A diferencia del Modal general: Escape solo actúa con la hoja abierta y solo sobre
// la de más arriba, el foco entra al abrir, no se escapa con Tab y vuelve a donde
// estaba al cerrar, y el scroll del fondo se restaura a su valor anterior.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

// Hojas abiertas, de abajo hacia arriba: Escape y Tab los atiende solo la última.
const openStack = []
// Un solo bloqueo de scroll para todas: lo toma la primera que abre y lo suelta la
// última que cierra, en cualquier orden (dos hojas que se desmontan juntas
// liberan al revés de como abrieron).
let savedOverflow = ''

export default function Sheet({ open, onClose, labelledBy, label, maxWidth = 'sm:max-w-lg', children }) {
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const token = {}
    if (openStack.length === 0) {
      savedOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    openStack.push(token)
    const previousFocus = document.activeElement

    const panel = panelRef.current
    const focusables = () => Array.from(panel?.querySelectorAll(FOCUSABLE) || [])
    ;(focusables()[0] || panel)?.focus()

    const onKeyDown = e => {
      if (openStack[openStack.length - 1] !== token) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        e.preventDefault()
        panel?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      openStack.splice(openStack.indexOf(token), 1)
      if (openStack.length === 0) document.body.style.overflow = savedOverflow
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-gray-900/30" aria-hidden="true" onClick={() => onCloseRef.current?.()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
        className={`relative bg-white w-full ${maxWidth} rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[88vh] overflow-y-auto scrollbar-thin focus:outline-none`}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
