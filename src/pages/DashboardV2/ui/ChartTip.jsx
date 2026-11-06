import { useLayoutEffect, useRef, useState } from 'react'

// Dónde va el globo de un gráfico: al lado del punto, hacia el centro de la caja (a
// la derecha en la mitad izquierda y al revés) y, si ahí no entra, sobre el punto,
// siempre dentro de la caja (del otro lado tampoco entraría: hay menos lugar). Un
// globo que se sale de la tarjeta en un teléfono corre la página de costado o queda
// cortado. anchor: x del punto; width: ancho del globo; box: ancho de la caja.
export function tipLeft(anchor, width, box, gap = 10) {
  const side = anchor <= box / 2 ? anchor + gap : anchor - gap - width
  if (side >= 0 && side + width <= box) return side
  return Math.max(0, Math.min(box - width, anchor - width / 2))
}

// El globo, posicionado con tipLeft. Se mide a sí mismo antes de pintarse (el ancho
// depende de los importes), así que nunca se ve en el lugar equivocado. Va dentro de
// un contenedor `relative` del ancho `box`.
export default function ChartTip({ anchor, box, top = 0, gap = 10, children }) {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const measured = ref.current?.offsetWidth || 0
    if (measured !== width) setWidth(measured)
  })
  return (
    <div ref={ref} className="absolute z-20 pointer-events-none" style={{ left: tipLeft(anchor, width, box, gap), top }}>
      {children}
    </div>
  )
}
