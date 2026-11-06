import { useState } from 'react'
import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import { DEFAULT_SHIFT_CAPACITY, SHIFT_CAPACITY_RANGE } from '../../../../services/dashboardV2/occupancy'
import { formatDecimal, money, pctText } from '../../format'
import { CARD } from './commercialText'

// Un cuadrito por lugar del turno: los llenos son los ocupados en un día promedio y
// los vacíos, los que quedan libres. Con un aforo chico se cuentan con el ojo; el
// rango del aforo (hasta 60) es el que entra en el celular sin volverse una raya.
function ShiftSeats({ shift, capacity }) {
  const sold = Math.round(shift.perDay)
  const filled = Math.min(capacity, sold)
  const over = sold - capacity
  return (
    // En el celular los cuadritos van en su propio renglón: al lado del rótulo no entran
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5">
      <span className="w-[52px] shrink-0 text-[12px] font-semibold text-gray-500">{shift.label}</span>
      <span className="w-[40px] shrink-0 text-[16px] font-semibold tabular-nums text-gray-900 text-right">{pctText(shift.pct, 0)}</span>
      <div
        className={`order-last sm:order-none basis-full sm:basis-auto sm:flex-1 min-w-0 grid ${capacity > 40 ? 'gap-px' : 'gap-[3px]'}`}
        style={{ gridTemplateColumns: `repeat(${capacity}, minmax(0, 1fr))` }}
        title={`${formatDecimal(shift.perDay)} de ${capacity} lugares ocupados en un día promedio`}
      >
        {Array.from({ length: capacity }, (_, k) => (
          <span key={k} className={`aspect-square rounded-[2px] ${k < filled ? 'bg-emerald-500' : 'bg-gray-200'}`} />
        ))}
      </div>
      <span className="ml-auto sm:ml-0 w-[86px] shrink-0 text-right text-[11.5px] text-gray-400 tabular-nums leading-tight">
        {over > 0
          ? <span className="text-rose-600"><span className="font-semibold">{over}</span> sobre el aforo</span>
          : <><span className="font-semibold text-gray-700">{Math.round(shift.free)}</span> libres/día</>}
      </span>
    </div>
  )
}

const { min: MIN, max: MAX } = SHIFT_CAPACITY_RANGE
const clamp = v => Math.max(MIN, Math.min(MAX, v))

// El aforo por turno: el único parámetro del tablero. Cambiarlo acá solo prueba
// valores (la tarjeta y el mapa de calor se recalculan); guardarlo es otra acción.
// El campo es de texto: un input numérico dibuja sus propias flechitas, que
// duplicarían los botones. Se valida al salir del campo, no mientras se tipea.
// disabled: mientras se guarda, para que el resultado no pise un valor nuevo a prueba.
function CapacityControl({ value, onChange, disabled = false }) {
  const [draft, setDraft] = useState(null)
  const step = d => { setDraft(null); onChange(clamp(value + d)) }
  const commit = () => {
    const v = parseInt(draft, 10)
    if (!Number.isNaN(v)) onChange(clamp(v))
    setDraft(null)
  }
  const stepButton = (d, text, label) => (
    <button
      type="button"
      onClick={() => step(d)}
      disabled={disabled || (d < 0 ? value <= MIN : value >= MAX)}
      aria-label={label}
      className="w-6 h-6 shrink-0 rounded-md border border-gray-200 bg-white text-gray-500 text-[13px] leading-none flex items-center justify-center transition-colors hover:border-gray-300 hover:text-gray-900 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      {text}
    </button>
  )
  return (
    <div className="shrink-0 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2" title="Lugares por turno. Recalcula esta tarjeta y el mapa de calor.">
      <p className="text-[9.5px] font-semibold uppercase tracking-wide text-indigo-700 text-center">Aforo por turno</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        {stepButton(-1, '−', 'Bajar el aforo')}
        <input
          type="text"
          inputMode="numeric"
          value={draft ?? String(value)}
          onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, String(MAX).length))}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          aria-label="Aforo por turno"
          disabled={disabled}
          className="w-[50px] disabled:opacity-50 text-center text-[17px] leading-none font-semibold tabular-nums text-gray-900 bg-white border border-gray-200 rounded-md py-1 focus:outline-none focus:border-indigo-400"
        />
        {stepButton(1, '+', 'Subir el aforo')}
      </div>
    </div>
  )
}

// Qué aforo se está usando y qué se puede hacer con él: probar no guarda; guardar
// es un botón aparte, solo para quien puede escribir la configuración del centro.
// save: { status: 'idle' | 'saving' | 'saved' | 'error', value, error }
function CapacityStatus({ occupancy, savedCapacity, isDefault, canSave, save, onSave, onDiscard }) {
  const simulated = occupancy.simulated
  if (!simulated && !isDefault && save.status === 'idle') return null
  const settled = save.status === 'saving' || save.status === 'saved'
  const button = 'text-[11.5px] font-semibold rounded-md px-2.5 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400'
  return (
    <div className="px-5 py-2.5 border-t border-indigo-50 bg-indigo-50/40 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <p className="text-[11.5px] text-gray-600" role="status">
        {save.status === 'saving' ? 'Guardando el aforo…'
          : save.status === 'saved' ? `Aforo guardado: ${save.value} lugares por turno.`
          : save.status === 'error' ? <span className="text-rose-600">No se pudo guardar el aforo: {save.error}</span>
          : simulated ? <>Probando <span className="font-semibold">{occupancy.capacity}</span> lugares por turno: no está guardado. {isDefault ? `Sin aforo guardado se usan ${savedCapacity}.` : `El guardado es ${savedCapacity}.`}</>
          : `Sin aforo guardado: se usan ${DEFAULT_SHIFT_CAPACITY} lugares por turno por defecto.`}
      </p>
      {!settled && (simulated || isDefault) && (
        <div className="flex items-center gap-2">
          {simulated && (
            <button type="button" onClick={onDiscard} className={`${button} text-gray-500 hover:text-gray-800`}>
              Volver a {savedCapacity}
            </button>
          )}
          {canSave && (
            <button type="button" onClick={() => onSave(occupancy.capacity)} className={`${button} bg-indigo-600 text-white hover:bg-indigo-700`}>
              Guardar {occupancy.capacity} como aforo
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Ocupación de la capacidad: qué parte de los lugares de cada turno está ocupada y
// cuánto MRR rinde cada lugar. occupancy: la del aforo guardado o la de uno a prueba.
export default function OccupancyCard({ occupancy, monthLabel, savedCapacity, isDefault, canSave, save, onTry, onSave, onDiscard }) {
  const general = occupancy.delta
  return (
    <Card role="group" aria-label="Ocupación y rendimiento por lugar" className={CARD}>
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
            Ocupación y rendimiento por lugar
            <InfoButton id="occupancy" />
          </h3>
          <span className="block text-xs text-gray-400 mt-0.5">
            <span className="capitalize">{monthLabel}</span> · {occupancy.workdays} días hábiles
          </span>
        </div>
        <CapacityControl value={occupancy.capacity} onChange={onTry} disabled={save.status === 'saving'} />
      </div>

      <div className="px-5 pb-4 flex flex-col gap-3">
        {occupancy.shifts.map(shift => <ShiftSeats key={shift.key} shift={shift} capacity={occupancy.capacity} />)}
      </div>

      <div className="px-5 py-3.5 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
        <div className="pb-3 sm:pb-0 sm:pr-5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Ocupación general</p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[17px] leading-none font-semibold tabular-nums text-gray-900">{pctText(occupancy.pct, 0)}</span>
            {general != null && Math.abs(general) >= 0.5 && (
              <span className={`text-[11px] font-semibold tabular-nums ${general >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                {general >= 0 ? '↑' : '↓'}{formatDecimal(Math.abs(general), 0)} pp
              </span>
            )}
          </p>
          <p className="text-[10.5px] text-gray-400 mt-1">de {occupancy.seatsMonth.toLocaleString('es-UY')} lugares-turno del mes</p>
        </div>
        <div className="py-3 sm:py-0 sm:px-5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Por lugar disponible</p>
          <p className="mt-1 text-[17px] leading-none font-semibold tabular-nums text-gray-900">{money(occupancy.revenuePerSeat)}</p>
          <p className="text-[10.5px] text-gray-400 mt-1">MRR ÷ todos los lugares</p>
        </div>
        <div className="pt-3 sm:pt-0 sm:pl-5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Por lugar vendido</p>
          <p className="mt-1 text-[17px] leading-none font-semibold tabular-nums text-gray-900">{money(occupancy.revenuePerSoldSeat)}</p>
          <p className="text-[10.5px] text-gray-400 mt-1">precio efectivo del lugar</p>
        </div>
      </div>

      <CapacityStatus
        occupancy={occupancy}
        savedCapacity={savedCapacity}
        isDefault={isDefault}
        canSave={canSave}
        save={save}
        onSave={onSave}
        onDiscard={onDiscard}
      />
    </Card>
  )
}
