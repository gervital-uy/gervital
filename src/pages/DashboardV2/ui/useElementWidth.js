import { useLayoutEffect, useState } from 'react'

// El ancho de un contenedor, para los gráficos SVG que se dibujan en píxeles. Se
// engancha con un ref de callback (el nodo puede montarse después, al cambiar de
// vista) y sigue cada cambio de tamaño. Mientras no hay medida (o en jsdom, que mide
// 0) devuelve `fallback`: un gráfico angosto un instante es mejor que una tarjeta vacía.
//   const [ref, width] = useElementWidth()  →  <div ref={ref}>…</div>
export function useElementWidth(fallback = 640) {
  const [node, setNode] = useState(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    if (!node) return
    if (node.clientWidth) setWidth(node.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const measured = entries[0]?.contentRect.width
      if (measured > 0) setWidth(measured)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  return [setNode, width > 0 ? width : fallback]
}
