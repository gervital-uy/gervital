import { useEffect, useRef, useState } from 'react'
import { MONTH_SHORT } from '../../../format'
import { longOfOrd } from './benefitsFormat'

function Chevron({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

// Selector de mes con flechas de año y una grilla de doce meses: el <input
// type="month"> nativo obliga a pelear con los segmentos para cambiar de año.
// value, min y max son ordinales (year * 12 + month).
export default function MonthPicker({ value, min, max, onChange, label }) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(() => Math.floor(value / 12))
  const box = useRef(null)

  useEffect(() => { setYear(Math.floor(value / 12)) }, [value])

  useEffect(() => {
    if (!open) return
    const outside = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const key = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const minYear = Math.floor(min / 12)
  const maxYear = Math.floor(max / 12)
  const shown = Math.min(maxYear, Math.max(minYear, year))

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={`${label}: ${longOfOrd(value)}`}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 w-[140px] justify-between rounded-lg border bg-white pl-2.5 pr-1.5 py-1 text-[11.5px] capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
          open ? 'border-emerald-500 text-gray-800' : 'border-gray-200 text-gray-700 hover:border-gray-300'
        }`}
      >
        {longOfOrd(value)}
        <Chevron className={`w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[220px] rounded-xl border border-gray-200 bg-white shadow-lg p-2">
          <div className="flex items-center justify-between px-1 pb-2">
            <button
              type="button"
              onClick={() => setYear(shown - 1)}
              disabled={shown - 1 < minYear}
              aria-label="Año anterior"
              className="w-6 h-6 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Chevron className="w-3.5 h-3.5 rotate-90" />
            </button>
            <span className="text-[12.5px] font-semibold text-gray-800 tabular-nums">{shown}</span>
            <button
              type="button"
              onClick={() => setYear(shown + 1)}
              disabled={shown + 1 > maxYear}
              aria-label="Año siguiente"
              className="w-6 h-6 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Chevron className="w-3.5 h-3.5 -rotate-90" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {MONTH_SHORT.map((name, m) => {
              const ord = shown * 12 + m
              const out = ord < min || ord > max
              const picked = ord === value
              return (
                <button
                  key={name}
                  type="button"
                  disabled={out}
                  aria-pressed={picked}
                  onClick={() => { onChange(ord); setOpen(false) }}
                  className={`py-1.5 rounded-md text-[11.5px] capitalize transition-colors ${
                    picked ? 'bg-emerald-600 text-white font-semibold' : out ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
