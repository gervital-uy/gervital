import { useEffect, useRef } from 'react'

// Ventana mínima entre dos refrescos: al volver a la pestaña llegan juntos
// 'focus' y 'visibilitychange', y con uno alcanza.
const MIN_INTERVAL_MS = 2000

// Llama a onRefresh cuando la pestaña vuelve a estar visible o la ventana
// recupera el foco. Grupos y Transporte lo usan para enterarse de faltas y
// recuperos cargados en otra pantalla (la ficha del cliente) sin recargar.
export function useRefreshOnFocus(onRefresh) {
  const callbackRef = useRef(onRefresh)
  callbackRef.current = onRefresh

  useEffect(() => {
    let last = 0
    const handler = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - last < MIN_INTERVAL_MS) return
      last = now
      callbackRef.current()
    }
    window.addEventListener('focus', handler)
    document.addEventListener('visibilitychange', handler)
    return () => {
      window.removeEventListener('focus', handler)
      document.removeEventListener('visibilitychange', handler)
    }
  }, [])
}
