import { useId, useMemo } from 'react'
import Sheet from '../ui/Sheet'
import FormulaRow from './FormulaRow'
import { buildDoc } from './docs/validate'

// Ficha de un número: qué mide, cómo se compone, de dónde sale y qué tener en cuenta.
export default function ExplainModal({ docId, ctx, docs, onClose }) {
  const titleId = useId()
  const doc = useMemo(() => (docId && ctx ? buildDoc(docs, docId, ctx) : null), [docs, docId, ctx])
  const hasFormula = doc && (doc.rows?.length > 0 || doc.total)

  return (
    <Sheet open={!!doc} onClose={onClose} labelledBy={titleId}>
      {doc && (
        <>
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-gray-100 sticky top-0 bg-white">
            <div>
              <h3 id={titleId} className="text-[15px] font-semibold text-gray-900">{doc.title}</h3>
              {ctx.monthLabel && <p className="text-xs text-gray-400 mt-0.5 capitalize">{ctx.monthLabel}</p>}
              {doc.unit?.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 mt-2">
                  {doc.unit.map(u => (
                    <span key={u} className="text-[10.5px] font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{u}</span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-5">
            <p className="text-[13.5px] leading-relaxed text-gray-700">{doc.what}</p>

            {hasFormula && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Cómo se compone</p>
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-2">
                  {(doc.rows || []).map((row, i) => <FormulaRow key={i} {...row} />)}
                  {doc.total && <FormulaRow {...doc.total} strong />}
                </div>
              </div>
            )}

            {doc.source && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">De dónde sale el dato</p>
                <p className="text-[13px] leading-relaxed text-gray-600">{doc.source}</p>
              </div>
            )}

            {doc.caveat && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 mb-1">Ojo con esto</p>
                <p className="text-[12.5px] leading-relaxed text-amber-900">{doc.caveat}</p>
              </div>
            )}
          </div>
        </>
      )}
    </Sheet>
  )
}
