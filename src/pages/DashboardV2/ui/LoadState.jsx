// Lo que muestra un bloque mientras sus datos no están: cargando, error con
// reintento o vacío. Con datos, renderiza children(data). `state` es lo que
// devuelve useMonthData.
export default function LoadState({ state, isEmpty, emptyText = 'No hay datos para este mes.', loadingText = 'Cargando…', children }) {
  if (state.status === 'loading') {
    return <div role="status" className="flex items-center justify-center py-16 text-sm text-gray-400">{loadingText}</div>
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-center">
        <p className="text-gray-600">No se pudieron cargar los datos.</p>
        {state.error?.message && <p className="text-xs text-gray-400 max-w-md">{state.error.message}</p>}
        <button
          type="button"
          onClick={state.reload}
          className="mt-1 text-sm font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
        >
          Reintentar
        </button>
      </div>
    )
  }
  if (isEmpty?.(state.data)) {
    return <p className="py-16 text-center text-sm text-gray-400">{emptyText}</p>
  }
  return children(state.data)
}
