import { useEffect, useRef } from 'react'
import { plural } from '../../format'

// Resultado de la última acción de cobro: cuántos salieron y, si algo falló, quién y
// por qué (lo que falló sigue en la tabla con su fecha, para reintentar). Toma el
// foco al aparecer: el botón que lanzó la acción puede haber desaparecido, y así el
// aviso queda a la vista y lo lee el lector de pantalla.
export default function ActionOutcome({ outcome, refreshing, onDismiss }) {
  const { kind, ok, failed, name } = outcome
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [outcome])
  const success = kind === 'reverted'
    ? (ok ? `Se revirtió el cobro de ${name}.` : null)
    : (ok ? `${plural(ok, 'cobro registrado', 'cobros registrados')}.` : null)
  const tone = failed.length ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={failed.length ? 'alert' : 'status'}
      className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-[12.5px] focus:outline-none ${tone}`}
    >
      <div className="flex flex-col gap-1 min-w-0">
        {success && (
          <p className="font-semibold">
            {success}
            {refreshing && <span className="font-normal opacity-70"> Actualizando el padrón…</span>}
          </p>
        )}
        {failed.length > 0 && (
          <>
            <p className="font-semibold">
              {kind === 'reverted' ? 'No se pudo revertir el cobro.' : `${plural(failed.length, 'cobro no se registró', 'cobros no se registraron')}:`}
            </p>
            <ul className="flex flex-col gap-0.5">
              {failed.map(f => <li key={f.name}><span className="font-medium">{f.name}</span>: {f.error}</li>)}
            </ul>
          </>
        )}
      </div>
      <button type="button" onClick={onDismiss} aria-label="Cerrar el aviso" className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100">×</button>
    </div>
  )
}
