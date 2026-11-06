import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import Segmented from '../../ui/Segmented'
import { TIER_COLORS, UNKNOWN_COLOR, inkOn, mixScale } from '../../ui/colors'
import { pctText } from '../../format'
import { CARD } from './commercialText'

// Mapa de calor de la ocupación: día de semana × turno, sobre lo contratado. Es la
// misma ocupación de la tarjeta de arriba, abierta por casillero: el promedio de
// cada fila (ponderado por las veces que cae cada día en el mes) es la del turno.

// Semáforo en pastel: rojo el casillero vacío, verde el lleno. Los pasos son claros,
// así que el número de adentro siempre se lee; el color solo orienta.
const HEAT_STOPS = ['#d98a84', '#e8a98c', '#f3cf9d', '#e3e0a6', '#b9dca6', '#7fc593']
const HEAT_GRADIENT = `linear-gradient(90deg, ${HEAT_STOPS.join(', ')})`

export function heatColors(pct) {
  const bg = mixScale(HEAT_STOPS, (pct || 0) / 100)
  const ink = inkOn(bg)
  return { bg, ink, sub: ink === '#ffffff' ? 'rgba(255,255,255,0.75)' : 'rgba(15,23,42,0.58)' }
}

export const HEAT_VIEWS = [{ id: 'seats', label: 'Cupos' }, { id: 'tiers', label: 'Tiers' }]
const TIERS = ['A', 'B', 'C', 'D']
const TIER_PARTS = [...TIERS.map(t => ({ key: t, label: `Tier ${t}`, color: TIER_COLORS[t] })), { key: 'unknown', label: 'Sin tier', color: UNKNOWN_COLOR }]
// Un tramo lleva su número adentro solo si tiene ancho para mostrarlo.
const MIN_LABELED = 3
const COLS = '66px repeat(5, minmax(0, 1fr)) 70px'

const tierText = cell => TIER_PARTS.filter(p => cell.tiers[p.key]).map(p => `${p.label} ${cell.tiers[p.key]}`).join(' · ')
const freeText = (cell, capacity) => (cell.users > capacity ? `${cell.users - capacity} sobre el aforo` : `${cell.free} ${cell.free === 1 ? 'libre' : 'libres'}`)

function TierBar({ cell, capacity }) {
  // La barra llena es el aforo; si el casillero lo pasa, la escala es la gente.
  const scale = Math.max(capacity, cell.users)
  const parts = TIER_PARTS.map(p => ({ ...p, n: cell.tiers[p.key] || 0 })).filter(p => p.n > 0)
  return (
    <div className="w-full h-4 rounded-[4px] bg-gray-100 overflow-hidden flex">
      {parts.map((p, k) => (
        <div
          key={p.key}
          className="flex items-center justify-center"
          // Un hilo del color de la tarjeta entre tramos, para que dos vecinos no se lean como uno
          style={{ width: `${(p.n / scale) * 100}%`, background: p.color, boxShadow: k < parts.length - 1 ? 'inset -2px 0 0 #fff' : 'none' }}
        >
          {p.n >= MIN_LABELED && (
            <span className="text-[9.5px] font-semibold leading-none tabular-nums" style={{ color: inkOn(p.color) }}>{p.n}</span>
          )}
        </div>
      ))}
    </div>
  )
}

export default function OccupancyHeatmap({ occupancy, monthLabel, view, onView }) {
  const byTier = view === 'tiers'
  const { capacity, dates } = occupancy
  const weekdays = occupancy.shifts[0].cells

  return (
    <Card role="group" aria-label="Mapa de calor de ocupación" className={CARD}>
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
            <span className="truncate">Mapa de calor de ocupación</span>
            <InfoButton id={byTier ? 'heatmapTiers' : 'heatmapSeats'} />
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {byTier ? 'Quiénes ocupan cada casillero, por tier' : 'Lugares ocupados por día y turno'}
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-start sm:items-end gap-1.5">
          <Segmented options={HEAT_VIEWS} value={view} onChange={onView} label="Vista del mapa" />
          <span className="text-[11px] text-gray-400 sm:text-right whitespace-nowrap">
            <span className="capitalize">{monthLabel}</span> · aforo {capacity} por turno{occupancy.simulated ? ' (a prueba)' : ''}
          </span>
        </div>
      </div>

      {/* En el celular la grilla se desplaza dentro de la tarjeta, no la página */}
      <div className="px-5 pb-4 overflow-x-auto">
        {/* La vista por tier lleva dos números y una barra por celda: necesita más ancho */}
        <div className={byTier ? 'min-w-[600px]' : 'min-w-[480px]'}>
          <div className="grid gap-[4px] items-end" style={{ gridTemplateColumns: COLS }}>
            <span />
            {weekdays.map((c, k) => (
              <span key={c.weekday} className="pb-1.5 text-center">
                <span className="block text-[11.5px] font-medium text-gray-600">{c.label}</span>
                <span className="block text-[9.5px] text-gray-400 tabular-nums">{dates[k]} {dates[k] === 1 ? 'fecha' : 'fechas'}</span>
              </span>
            ))}
            <span className="pb-1.5 text-center text-[9.5px] font-semibold uppercase tracking-wide text-gray-400 leading-tight">Turno</span>
          </div>

          {occupancy.shifts.map(shift => (
            <div key={shift.key} className="grid gap-[4px] mt-[4px]" style={{ gridTemplateColumns: COLS }}>
              <div className="flex items-center">
                <span className="text-[13px] font-semibold text-gray-700 leading-none">{shift.label}</span>
              </div>
              {shift.cells.map(cell => {
                const title = `${shift.label}, ${cell.label.toLowerCase()}: ${cell.users} de ${capacity} lugares ocupados · ${freeText(cell, capacity)}${cell.users > 0 ? ` · ${tierText(cell)}` : ''}`
                if (byTier) {
                  return (
                    <div key={cell.weekday} className="h-[64px] rounded-lg border border-gray-100 bg-white px-2.5 flex flex-col justify-center gap-2" title={title}>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-[15px] font-semibold leading-none tabular-nums text-gray-900">{pctText(cell.pct, 0)}</span>
                        <span className="text-[10px] leading-none tabular-nums text-gray-400">{cell.users}/{capacity}</span>
                      </div>
                      <TierBar cell={cell} capacity={capacity} />
                    </div>
                  )
                }
                const color = heatColors(cell.pct)
                return (
                  <div key={cell.weekday} className="h-[64px] rounded-lg flex flex-col items-center justify-center" style={{ background: color.bg }} title={title}>
                    <span className="text-[16px] font-semibold leading-none tabular-nums" style={{ color: color.ink }}>{pctText(cell.pct, 0)}</span>
                    <span className="text-[10px] leading-none mt-1.5 tabular-nums" style={{ color: color.sub }}>{freeText(cell, capacity)}</span>
                  </div>
                )
              })}
              <div className="rounded-lg border border-gray-100 bg-gray-50/70 flex flex-col items-center justify-center">
                <span className="text-[15px] font-semibold leading-none tabular-nums text-gray-900">{pctText(shift.pct, 0)}</span>
                <span className="text-[9.5px] leading-none mt-1.5 text-gray-400">promedio</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 pb-4 min-h-[32px] flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        {byTier ? (
          <>
            <div className="flex items-center gap-3.5 flex-wrap">
              {TIER_PARTS.map(p => (
                <span key={p.key} className="flex items-center gap-1.5 text-[10.5px] text-gray-500">
                  <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: p.color }} />
                  {p.label}
                </span>
              ))}
              <span className="flex items-center gap-1.5 text-[10.5px] text-gray-400">
                <span className="w-2.5 h-2.5 rounded-[3px] bg-gray-100" />
                libre
              </span>
            </div>
            <span className="text-[10.5px] text-gray-400">La barra llena es el aforo · lo gris son los lugares libres</span>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 tabular-nums">0%</span>
            <span className="h-2 w-[132px] rounded-full border border-gray-100" style={{ background: HEAT_GRADIENT }} />
            <span className="text-[10px] text-gray-400 tabular-nums">100%</span>
            <span className="text-[10.5px] text-gray-400 ml-1">lugares ocupados sobre el aforo</span>
          </div>
        )}
      </div>
    </Card>
  )
}
