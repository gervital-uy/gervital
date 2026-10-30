import { money, DASH } from '../format'

// El importe de una fila. `value` trae el signo de su contribución; con op '−' se
// muestra la magnitud porque el signo ya está en la columna del operador. Sin op
// (el total, la base) el signo se ve: un resultado negativo es "−$ 20.000", no
// "$ 20.000". Un dato que falta es '—', nunca $ 0.
export function formulaValueText({ value, text, op }) {
  if (text != null) return text
  if (typeof value !== 'number' || !Number.isFinite(value)) return DASH
  return money(op === '−' ? -value : value)
}

export default function FormulaRow({ label, value, text, op, info, strong }) {
  const tone = strong ? 'font-semibold text-gray-900' : info ? 'text-gray-400' : 'text-gray-600'
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${strong ? 'border-t border-gray-200 mt-1 pt-2.5' : ''}`}>
      <span className={`text-[13px] flex items-center gap-1.5 min-w-0 ${tone}`}>
        <span className="w-3 text-gray-300 text-center shrink-0" aria-hidden="true">{op || ''}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className={`text-[13px] tabular-nums shrink-0 ${strong ? 'font-semibold text-gray-900' : info ? 'text-gray-400' : 'text-gray-800'}`}>
        {formulaValueText({ value, text, op })}
      </span>
    </div>
  )
}
