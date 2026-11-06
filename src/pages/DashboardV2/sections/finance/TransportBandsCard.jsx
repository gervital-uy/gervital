import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import LoadState from '../../ui/LoadState'
import { DASH, MINUS, formatDecimal, money, pctText, plural } from '../../format'
import { BAND_LABELS, CARD_CLASS, TRANSPORT_COLORS } from './cardsText'

const ROW = 'grid grid-cols-[minmax(118px,1fr)_minmax(0,3.2fr)_auto] gap-x-4 items-center'
const signed = v => (typeof v === 'number' ? `${v >= 0 ? '+' : MINUS}${money(Math.abs(v))}` : DASH)
const pctOf = (part, whole) => (whole > 0 && typeof part === 'number' ? pctText(Math.abs((part / whole) * 100), 0) : DASH)

// Dónde cae lo que cobra y lo que cuesta una banda, y la distancia entre los dos.
// Cada importe va del lado de afuera de su punto, para que se lean aunque empaten.
function Dumbbell({ revenue, cost, max, strong = false }) {
  const lo = Math.min(revenue, cost)
  const hi = Math.max(revenue, cost)
  const pLo = (lo / max) * 100
  const pHi = (hi / max) * 100
  const loIsRevenue = revenue <= cost
  const dot = strong ? 'w-[10px] h-[10px]' : 'w-[9px] h-[9px]'
  return (
    <div className="relative h-5 px-[78px]">
      <div className="relative h-full">
        <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-px ${strong ? 'bg-gray-200' : 'bg-gray-100'}`} />
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${pLo}%`, width: `${pHi - pLo}%`, height: strong ? 4 : 3, background: revenue >= cost ? TRANSPORT_COLORS.revenue : TRANSPORT_COLORS.cost, opacity: 0.35 }}
        />
        <span className={`absolute top-1/2 ${dot} rounded-full ring-2 ring-white -translate-x-1/2 -translate-y-1/2`} style={{ left: `${(cost / max) * 100}%`, background: TRANSPORT_COLORS.cost }} />
        <span className={`absolute top-1/2 ${dot} rounded-full ring-2 ring-white -translate-x-1/2 -translate-y-1/2`} style={{ left: `${(revenue / max) * 100}%`, background: TRANSPORT_COLORS.revenue }} />
        <span className={`absolute top-1/2 text-[11.5px] tabular-nums whitespace-nowrap ${strong ? 'font-semibold' : ''}`} style={{ left: `${pLo}%`, transform: 'translate(calc(-100% - 10px), -50%)', color: loIsRevenue ? TRANSPORT_COLORS.revenue : TRANSPORT_COLORS.cost }}>
          {money(lo)}
        </span>
        <span className={`absolute top-1/2 text-[11.5px] tabular-nums whitespace-nowrap ${strong ? 'font-semibold' : ''}`} style={{ left: `${pHi}%`, transform: 'translate(10px, -50%)', color: loIsRevenue ? TRANSPORT_COLORS.cost : TRANSPORT_COLORS.revenue }}>
          {money(hi)}
        </span>
      </div>
    </div>
  )
}

function Body({ t }) {
  const bands = t.bands.filter(b => b.revenueNet > 0 || b.passengers > 0 || b.trips > 0)
  const max = bands.reduce((m, b) => Math.max(m, b.revenueNet, b.cost || 0), 0) * 1.04 || 1
  return (
    <>
      <div className="px-5 pb-1 flex items-center gap-5 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: TRANSPORT_COLORS.revenue }} />Cobra</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: TRANSPORT_COLORS.cost }} />Cuesta</span>
      </div>

      <div className="px-5 pb-2 overflow-x-auto">
        <div className="min-w-[560px]">
          {bands.map(b => (
            <div key={b.band} className={`${ROW} py-3 border-b border-gray-50 last:border-b-0`}>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-gray-800 leading-tight">{BAND_LABELS[b.band]}</p>
                <p className="text-[11px] text-gray-400 tabular-nums mt-0.5">{plural(b.riders, 'cliente', 'clientes')} · {plural(b.trips, 'viaje', 'viajes')}</p>
              </div>
              {b.cost == null ? <p className="text-[11px] text-gray-400 px-[78px]">Cobra {money(b.revenueNet)}</p> : <Dumbbell revenue={b.revenueNet} cost={b.cost} max={max} />}
              <div className="text-right tabular-nums whitespace-nowrap min-w-[104px]">
                <span className={`text-[13.5px] font-semibold ${b.margin == null ? 'text-gray-300' : b.margin >= 0 ? 'text-teal-700' : 'text-rose-600'}`}>{signed(b.margin)}</span>
                <span className="text-[11px] text-gray-400 ml-1.5">{pctOf(b.margin, b.revenueNet)}</span>
              </div>
            </div>
          ))}

          <div className={`${ROW} pt-3 mt-0.5 border-t border-gray-200`}>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-gray-900 leading-tight">Total</p>
              <p className="text-[11px] text-gray-400 tabular-nums mt-0.5">{plural(t.riders, 'cliente', 'clientes')} · {plural(t.trips, 'viaje', 'viajes')}</p>
            </div>
            {t.cost == null ? <span /> : <Dumbbell revenue={t.revenueNet} cost={t.cost} max={Math.max(t.revenueNet, t.cost) * 1.04 || 1} strong />}
            <div className="text-right tabular-nums whitespace-nowrap min-w-[104px]">
              <span className={`text-[14px] font-semibold ${t.margin == null ? 'text-gray-300' : t.margin >= 0 ? 'text-teal-700' : 'text-rose-600'}`}>{signed(t.margin)}</span>
              <span className="text-[11px] font-medium text-gray-500 ml-1.5">{pctOf(t.margin, t.revenueNet)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Las palancas: el costo no depende de la distancia sino de cuántos tramos se
          hacen y de cuán llenos van */}
      <div className="px-5 py-3.5 mt-1 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { k: 'Ocupación de los autos', v: pctText(t.occupancyPct, 0), s: `${t.passengers} pasajeros sobre ${t.seats} asientos` },
          { k: 'Tramos del mes', v: String(t.legs), s: t.legsPerDay == null ? 'sin tramos programados' : `${formatDecimal(t.legsPerDay)} por día con transporte` },
          { k: 'Costo por viaje', v: t.costPerTrip == null ? DASH : money(t.costPerTrip), s: t.costPerLeg == null ? 'sin choferes cargados en Prestadores' : `${money(t.costPerLeg)} por tramo` }
        ].map(x => (
          <div key={x.k}>
            <p className="text-[10.5px] font-medium text-gray-400 uppercase tracking-wide">{x.k}</p>
            <p className="text-[15px] font-semibold text-gray-900 tabular-nums mt-0.5">{x.v}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{x.s}</p>
          </div>
        ))}
      </div>
    </>
  )
}

// Si lo que cobra el transporte cubre lo que cuesta, banda por banda. `state` es el
// de las fuentes de transporte del mes (useMonthData) y `transport`, la economía ya
// armada (buildTransportEconomics) cuando están.
export default function TransportBandsCard({ state, transport, monthLabel }) {
  const t = transport
  return (
    <Card className={CARD_CLASS}>
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
            Transporte por banda de distancia
            {t && <InfoButton id="finTransport" />}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            <span className="capitalize">{monthLabel}</span>
            {t ? ` · ${plural(t.billedClients, 'cliente', 'clientes')} con transporte en la cuota · ${plural(t.legs, 'tramo', 'tramos')}` : ''} · sin IVA
          </p>
        </div>
        {t && (
          <div className="text-right shrink-0">
            <p className="text-[11px] text-gray-400">Margen del transporte</p>
            <p className={`text-2xl font-semibold tracking-tight tabular-nums ${t.margin == null ? 'text-gray-300' : t.margin >= 0 ? 'text-gray-900' : 'text-rose-600'}`}>{signed(t.margin)}</p>
            <p className="text-[11px] text-gray-400 tabular-nums">{money(t.revenueNet)} {MINUS} {t.cost == null ? DASH : money(t.cost)} · {pctOf(t.margin, t.revenueNet)}</p>
          </div>
        )}
      </div>
      <LoadState state={state} loadingText="Cargando la programación de transporte del mes…">
        {() => (t && (t.legs > 0 || t.revenueNet > 0)
          ? <Body t={t} />
          : <p className="px-5 pb-8 pt-2 text-center text-sm text-gray-400">No hay transporte en las cuotas ni tramos programados en este mes.</p>)}
      </LoadState>
    </Card>
  )
}
