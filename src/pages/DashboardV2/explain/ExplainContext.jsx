import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import ExplainModal from './ExplainModal'
import { DOCS } from './docs'

const ExplainContext = createContext({ open: () => {}, ready: false })

export const useExplain = () => useContext(ExplainContext)

// Envuelve una sección: los botones "i" de adentro abren la explicación armada con
// el contexto (los números del mes) que la sección le pasa. Sin contexto, porque
// los datos están cargando o fallaron, los botones quedan desactivados.
export function ExplainProvider({ ctx, docs = DOCS, children }) {
  const [docId, setDocId] = useState(null)
  const ready = ctx != null

  // Si el mes cambia y los datos se recargan, la ficha abierta se cierra y no
  // vuelve a abrirse sola cuando llegan los números nuevos.
  useEffect(() => {
    if (!ready) setDocId(null)
  }, [ready])

  const value = useMemo(() => ({ open: setDocId, ready }), [ready])

  return (
    <ExplainContext.Provider value={value}>
      {children}
      <ExplainModal docId={docId} ctx={ctx} docs={docs} onClose={() => setDocId(null)} />
    </ExplainContext.Provider>
  )
}
