import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { TARGET_MAX, TARGET_MIN, clampTarget, parseTarget, serializeTarget } from '../../../../services/dashboardV2/financeView'

// La meta de margen neto, desde el propio gráfico. La define el centro (depende de qué
// tiene que cubrir ese margen: reposición de activos, deuda, retiros, el saldo de
// IRAE que no cubran los adelantos), así que arranca sin definir y nunca se inventa. Mientras el panel está abierto el gráfico
// muestra el valor que se está probando (`onPreview`); se guarda solo con Guardar.
// Cerrar sin guardar vuelve a la meta guardada.
//   status: 'loading' | 'ready' | 'error'. Con 'error' no se pudo leer la meta
//   guardada: el control solo simula (`onSimulate`), no escribe.
export default function MarginTargetControl({ value, status, suggestion, onPreview, onSave, onSimulate }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const box = useRef(null)
  const input = useRef(null)
  const titleId = useId()
  const persisted = status !== 'error'
  const draft = parseTarget(text)

  const close = useCallback(() => {
    setOpen(false)
    setError(null)
    onPreview(undefined)
  }, [onPreview])

  // Desmontarse descarta lo que se estaba probando: cambiar de vista con el teclado
  // (sin el clic afuera que cierra el panel) dejaría dibujada una meta que nadie
  // guardó. Con un ref, para no correr la limpieza cada vez que cambia onPreview.
  const previewRef = useRef(onPreview)
  previewRef.current = onPreview
  useEffect(() => () => previewRef.current(undefined), [])

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const outside = e => { if (box.current && !box.current.contains(e.target)) close() }
    const key = e => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open, close])

  const start = () => {
    if (open) return close()
    setText(serializeTarget(value))
    setError(null)
    setOpen(true)
    onPreview(value)
  }
  const edit = next => {
    setText(next)
    onPreview(parseTarget(next))
  }
  const nudge = delta => edit(String(clampTarget((draft ?? 0) + delta)))

  const confirm = async () => {
    if (!persisted) {
      onSimulate(draft)
      close()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      setOpen(false)
      onPreview(undefined)
    } catch (e) {
      setError(e?.message || 'No se pudo guardar la meta.')
    } finally {
      setSaving(false)
    }
  }

  const shown = status === 'loading' ? '…' : value == null ? 'sin definir' : `${value}%`
  const stepCls = 'w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors text-[14px] leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
  const optionCls = 'flex-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-200 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={start}
        disabled={status === 'loading'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`inline-flex items-center gap-1.5 text-[11px] rounded-lg px-2 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
          open ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
        }`}
      >
        <span className="w-4 border-t border-dashed border-gray-400 shrink-0" />
        <span className="font-medium">Meta neto</span>
        <span className="font-semibold tabular-nums text-gray-700">{shown}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-labelledby={titleId}
          className="absolute z-30 bottom-full mb-2 right-0 w-[264px] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white shadow-lg p-3"
        >
          <p id={titleId} className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Meta de margen neto</p>
          <p className="text-[10.5px] text-gray-400 leading-snug mt-1">
            La define el centro. El margen ya descuenta los impuestos cargados en Costos (el adelanto de IRAE incluido); no descuenta los retiros ni el saldo de IRAE que no cubran los adelantos: la meta tiene que dejarles lugar.
          </p>

          <div className="flex items-center gap-2 mt-2.5">
            <button type="button" onClick={() => nudge(-1)} className={stepCls} aria-label="Bajar un punto">−</button>
            <div className="flex-1 flex items-baseline justify-center gap-0.5 rounded-lg border border-gray-200 px-2 py-1">
              {/* De texto y no numérico: el input numérico dibuja sus propias flechas,
                  que duplicarían los botones de los costados. */}
              <input
                ref={input}
                type="text"
                inputMode="numeric"
                value={text}
                placeholder="—"
                aria-label={`Meta de margen neto, en %, de ${TARGET_MIN} a ${TARGET_MAX}`}
                onChange={e => edit(e.target.value.replace(/[^0-9-]/g, ''))}
                onBlur={() => setText(serializeTarget(draft))}
                className="w-12 text-center text-[15px] font-semibold tabular-nums text-gray-900 outline-none bg-transparent"
              />
              <span className="text-[12px] font-semibold text-gray-400">%</span>
            </div>
            <button type="button" onClick={() => nudge(1)} className={stepCls} aria-label="Subir un punto">+</button>
          </div>

          <div className="flex items-center gap-1 mt-2">
            {suggestion && (
              <button
                type="button"
                onClick={() => edit(String(suggestion.pct))}
                title={`El margen neto de los últimos ${suggestion.months} meses cerrados${suggestion.skipped?.length ? ' con el gasto completo' : ''}: una meta que sigue al propio desempeño`}
                className={optionCls}
              >
                {`Últimos ${suggestion.months} m · ${suggestion.pct}%`}
              </button>
            )}
            <button type="button" onClick={() => edit('')} className={optionCls}>Sin meta</button>
          </div>

          {!persisted && (
            <p className="text-[10.5px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 mt-2 leading-snug">
              No se pudo leer la meta guardada: acá solo se prueba en el gráfico, no se guarda.
            </p>
          )}
          {error && <p role="alert" className="text-[10.5px] text-rose-600 mt-2 leading-snug">{error}</p>}

          <div className="flex items-center justify-end gap-1.5 mt-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={close} className="text-[11.5px] font-medium text-gray-500 hover:bg-gray-50 rounded-lg px-2.5 py-1.5 transition-colors">
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={saving || (persisted && draft === value)}
              className="text-[11.5px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 rounded-lg px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
            >
              {saving ? 'Guardando…' : persisted ? 'Guardar' : 'Probar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
