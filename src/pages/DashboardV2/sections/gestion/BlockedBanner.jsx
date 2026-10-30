// Aviso de facturas que no pueden emitirse, solo cuando hay alguna. "Ver solo las
// trabadas" es un modo de la tabla, no un filtro que se suma al estado: muestra
// exactamente las filas que cuenta el aviso.
export default function BlockedBanner({ invoicing: f, onlyBlocked, onToggle }) {
  const total = f.trabadasFicha + f.trabadasFacturador
  if (total === 0) return null
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-start gap-2 text-[13px] font-semibold text-amber-900 min-w-0">
          <svg className="w-4 h-4 mt-px shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4" /><path d="M12 17h.01" />
          </svg>
          <span>{total === 1 ? '1 factura no puede emitirse' : `${total} facturas no pueden emitirse`}</span>
        </p>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={onlyBlocked}
          className="shrink-0 text-[12px] font-semibold text-amber-800 hover:text-amber-900 rounded-lg border border-amber-300 bg-white/60 px-2.5 py-1 hover:bg-white transition-colors whitespace-nowrap"
        >
          {onlyBlocked ? 'Ver todas' : `Ver solo las trabadas (${total})`}
        </button>
      </div>

      <div className="pl-6 mt-1.5 flex flex-wrap items-center gap-1.5">
        {f.detalleTrabadas.map(t => (
          <span key={t} className="text-[11px] font-medium text-amber-900 bg-amber-100 rounded-full px-2 py-0.5 whitespace-nowrap">{t}</span>
        ))}
      </div>

      {/* Las dos colas de trabajo: la que se libera al corregir el dato y la que,
          corregida, sigue esperando el cobro. */}
      <p className="pl-6 mt-1.5 text-[11.5px] text-amber-800 leading-relaxed">
        {f.trabadasConCobro > 0 && <><span className="font-semibold text-amber-900">{f.trabadasConCobro}</span> {f.trabadasConCobro === 1 ? 'se emite' : 'se emiten'} en cuanto se corrige el dato. </>}
        {f.trabadasSinCobro > 0 && <><span className="font-semibold text-amber-900">{f.trabadasSinCobro}</span> {f.trabadasSinCobro === 1 ? 'espera' : 'esperan'} además el cobro de la cuota.</>}
      </p>

      {onlyBlocked && (
        <p className="pl-6 mt-1.5 text-[11.5px] font-semibold text-amber-900">
          Mostrando las {total} trabadas del mes, sin importar el estado. Cada fila dice su motivo.
        </p>
      )}

      <p className="pl-6 mt-1.5 text-[11.5px] text-amber-800 leading-relaxed">
        {f.trabadasFicha > 0 && <>Los datos que faltan se completan en la ficha del cliente. </>}
        {f.trabadasFacturador > 0 && <>Los rechazos del facturador se reintentan desde la ficha del cliente.</>}
      </p>
    </div>
  )
}
