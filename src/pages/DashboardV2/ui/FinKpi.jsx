import Card from '../../../components/ui/Card'
import InfoButton from '../explain/InfoButton'
import DeltaTag from './DeltaTag'
import { DASH } from '../format'

// KPI con variaciones al costado (Comercial y Finanzas). `value` y `secondary` llegan
// formateados. deltas: [{ change, label, unit, invert, note }] (ver DeltaTag).
// secondaryStrong: el secundario es un dato de fondo, no una nota, y va al mismo
// tamaño que el principal. badge: { text, suffix, detail } en el pie, al lado de hint.
export default function FinKpi({ label, infoId, value, secondary, secondaryStrong = false, secondaryNote, valueClass = 'text-gray-900', hint, deltas = [], badge }) {
  return (
    <Card role="group" aria-label={label} className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)] h-full">
      <div className="px-4 py-3.5 flex flex-col h-full">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1">
          {label}
          {infoId && <InfoButton id={infoId} />}
        </p>

        <div className="mt-2 mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-2 whitespace-nowrap min-w-0">
            <span className={`text-[21px] leading-none font-semibold tracking-tight tabular-nums ${valueClass}`}>{value ?? DASH}</span>
            {secondary && (secondaryStrong ? (
              <>
                <span className="w-px h-5 bg-gray-200 shrink-0" />
                <span className="flex items-baseline gap-1">
                  {secondaryNote && <span className="text-[10.5px] font-medium text-gray-400">{secondaryNote}</span>}
                  <span className={`text-[21px] leading-none font-semibold tracking-tight tabular-nums ${valueClass}`}>{secondary}</span>
                </span>
              </>
            ) : (
              <span className="text-[12.5px] font-medium text-gray-400 truncate">· {secondary}</span>
            ))}
          </div>
          {deltas.length > 0 && (
            // Rótulo y número alineados entre filas
            <div className="grid grid-cols-[auto_auto] gap-x-1.5 shrink-0">
              {deltas.map((d, i) => <DeltaTag key={i} {...d} />)}
            </div>
          )}
        </div>

        {/* El pie va abajo de todo: en una fila de tarjetas de distinto alto las notas quedan alineadas */}
        {(hint || badge) && (
          <div className="mt-auto pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
            <p className="text-[10.5px] text-gray-400 leading-snug">{hint}</p>
            {badge && (
              <span
                className="shrink-0 inline-flex items-baseline gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 whitespace-nowrap tabular-nums"
                title={badge.detail}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 self-center shrink-0" />
                {badge.text}
                {badge.suffix && <span className="font-medium text-indigo-700/60">· {badge.suffix}</span>}
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
