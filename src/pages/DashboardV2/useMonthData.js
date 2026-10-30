import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// Datos de un mes con estado de carga y error, y un caché compartido entre
// pestañas: volver a una pestaña o a un mes ya visto no vuelve a pedir nada.
// Después de una escritura (un cobro, una factura) `invalidate(key)` borra lo
// cacheado y lo que esté en pantalla se recarga sin perder los datos viejos
// mientras tanto (`refreshing`).
//
// Uso: const padron = useMonthData('padron', loadPadron, selected)
//   → { status: 'loading' | 'ready' | 'error', data, error, refreshing, reload }
// `key` identifica al loader: dos loaders distintos no pueden compartir key.

const MonthDataContext = createContext(null)

export function MonthDataProvider({ children }) {
  const entriesRef = useRef(new Map())
  const [version, setVersion] = useState(0)

  const invalidate = useCallback(key => {
    const entries = entriesRef.current
    for (const cacheKey of [...entries.keys()]) {
      if (key == null || cacheKey.startsWith(`${key}|`)) entries.delete(cacheKey)
    }
    setVersion(v => v + 1)
  }, [])

  const value = useMemo(() => ({ entries: entriesRef.current, version, invalidate }), [version, invalidate])
  return <MonthDataContext.Provider value={value}>{children}</MonthDataContext.Provider>
}

// Para invalidar después de escribir. Sin provider no hay nada compartido que limpiar.
export const useInvalidateMonthData = () => useContext(MonthDataContext)?.invalidate || (() => {})

const stateFromCache = (entry, cacheKey) => (entry?.status === 'ready'
  ? { key: cacheKey, status: 'ready', data: entry.data, error: null, refreshing: false }
  : { key: cacheKey, status: 'loading', data: null, error: null, refreshing: false })

export function useMonthData(key, loader, { year, month }) {
  const shared = useContext(MonthDataContext)
  const localRef = useRef(null)
  if (!shared && !localRef.current) localRef.current = new Map()
  const entries = shared?.entries || localRef.current
  const version = shared?.version ?? 0

  const cacheKey = `${key}|${year}-${month}`
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState(() => stateFromCache(entries.get(cacheKey), cacheKey))

  useEffect(() => {
    let cancelled = false
    let entry = entries.get(cacheKey)
    if (entry?.status === 'ready') {
      setState(stateFromCache(entry, cacheKey))
      return
    }
    if (!entry) {
      const promise = Promise.resolve().then(() => loader({ year, month }))
      entry = { status: 'loading', promise }
      const pending = entry
      entries.set(cacheKey, pending)
      promise.then(
        data => { if (entries.get(cacheKey) === pending) entries.set(cacheKey, { status: 'ready', data }) },
        () => { if (entries.get(cacheKey) === pending) entries.delete(cacheKey) }
      )
    }
    setState(prev => (prev.key === cacheKey && prev.status === 'ready'
      ? { ...prev, refreshing: true }
      : { key: cacheKey, status: 'loading', data: null, error: null, refreshing: false }))
    entry.promise.then(
      data => { if (!cancelled) setState({ key: cacheKey, status: 'ready', data, error: null, refreshing: false }) },
      error => { if (!cancelled) setState({ key: cacheKey, status: 'error', data: null, error, refreshing: false }) }
    )
    return () => { cancelled = true }
  // `loader` queda afuera a propósito: cambia de identidad en cada render y `key`
  // ya lo identifica.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, cacheKey, version, nonce])

  const reload = useCallback(() => {
    entries.delete(cacheKey)
    setNonce(n => n + 1)
  }, [entries, cacheKey])

  // Al cambiar de mes, el estado guardado es del mes anterior hasta que corre el
  // efecto: nunca mostrar esos números con la etiqueta del mes nuevo.
  const current = state.key === cacheKey ? state : stateFromCache(entries.get(cacheKey), cacheKey)
  const { key: _ignored, ...visible } = current
  return { ...visible, reload }
}
