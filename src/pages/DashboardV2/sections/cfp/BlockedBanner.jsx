// Un número resaltado con su texto en singular o plural.
const n = (count, one, many) => <><span className="font-semibold text-amber-900">{count}</span> {count === 1 ? one : many}</>

// Aviso de facturas trabadas, solo cuando hay alguna: las que frena un dato de la
// ficha y las que Biller rechazó. "Ver solo las trabadas" es un modo de la tabla, no
// un filtro que se suma al estado: muestra exactamente las filas que cuenta el aviso.
export default function BlockedBanner({ invoicing: f, onlyBlocked, onToggle }) {
  const total = f.blockedRecord + f.blockedBiller
  if (total === 0) return null
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-start gap-2 text-[13px] font-semibold text-amber-900 min-w-0">
          <svg className="w-4 h-4 mt-px shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4" /><path d="M12 17h.01" />
          </svg>
          <span>{total === 1 ? '1 factura trabada' : `${total} facturas trabadas`}</span>
        </p>
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 text-[12px] font-semibold text-amber-800 hover:text-amber-900 rounded-lg border border-amber-300 bg-white/60 px-2.5 py-1 hover:bg-white transition-colors whitespace-nowrap"
        >
          {onlyBlocked ? 'Salir de las trabadas' : `Ver solo las trabadas (${total})`}
        </button>
      </div>

      <div className="pl-6 mt-1.5 flex flex-wrap items-center gap-1.5">
        {f.blockedReasons.map(t => (
          <span key={t} className="text-[11px] font-medium text-amber-900 bg-amber-100 rounded-full px-2 py-0.5 whitespace-nowrap">{t}</span>
        ))}
      </div>

      {/* Las colas de trabajo: lo que se libera al corregir la ficha (y lo que,
          corregido, sigue esperando el cobro) y los rechazos de Biller. */}
      {f.blockedRecord > 0 && (
        <p className="pl-6 mt-1.5 text-[11.5px] text-amber-800 leading-relaxed">
          {f.blockedRecordCollected > 0 && <>{n(f.blockedRecordCollected, 'se emite', 'se emiten')} en cuanto se corrige el dato. </>}
          {f.blockedRecordUncollected > 0 && <>{n(f.blockedRecordUncollected, 'espera', 'esperan')} además el cobro de la cuota. </>}
          Los datos se corrigen en la ficha del cliente.
        </p>
      )}
      {f.blockedBiller > 0 && (
        <p className="pl-6 mt-1.5 text-[11.5px] text-amber-800 leading-relaxed">
          {f.rejected > 0 && <>{n(f.rejected, 'rechazada por Biller se reintenta', 'rechazadas por Biller se reintentan')} con el botón Reintentar de su fila. </>}
          {f.rejectedUncollected > 0 && <>{n(f.rejectedUncollected, 'rechazada espera', 'rechazadas esperan')} antes el cobro de la cuota.</>}
        </p>
      )}

      {onlyBlocked && (
        <p className="pl-6 mt-1.5 text-[11.5px] font-semibold text-amber-900">
          Mostrando las {total} trabadas del mes, sin importar el estado. Cada fila dice su motivo.
        </p>
      )}

    </div>
  )
}
