import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import DeltaTag from '../../ui/DeltaTag'
import { DASH, money, pctText } from '../../format'
import { CARD_CLASS } from './cardsText'

function Line({ title, data }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[13px] font-semibold text-gray-700">{title}</span>
        <span className="ml-auto text-[11px] font-semibold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 tabular-nums">{pctText(data.sharePct, 0)} del ingreso</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-[22px] leading-none font-semibold tracking-tight tabular-nums text-gray-900">{money(data.revenue)}</p>
        <div className="grid grid-cols-[auto_auto] gap-x-1.5 shrink-0">
          <DeltaTag change={data.mom} label="vs mes anterior" />
          <DeltaTag change={data.yoy} label="vs año anterior" note={data.yoy ? null : 'Aparece desde junio de 2027.'} />
        </div>
      </div>
      {/* Las dos palancas de la línea: cuántos la usan y cuánto deja cada uno */}
      <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Clientes</p>
          <p className="text-[13.5px] font-semibold text-gray-800 tabular-nums mt-1">
            {data.penetrationPct != null ? `${data.clients} de ${data.base}` : data.clients}
            {data.penetrationPct != null && <span className="ml-1.5 text-[11px] font-normal text-gray-400">{pctText(data.penetrationPct, 0)}</span>}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Por cliente</p>
          <p className="text-[13.5px] font-semibold text-gray-800 tabular-nums mt-1">{data.perClient == null ? DASH : money(data.perClient)}</p>
        </div>
      </div>
    </div>
  )
}

// Asistencia y transporte por separado, sobre el servicio del mes: la caja no se
// puede partir por línea sin prorratear.
export default function RevenueLinesCard({ lines, monthLabel }) {
  return (
    <Card className={CARD_CLASS}>
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
          Ingreso por línea
          <InfoButton id="finLines" />
        </h3>
        <span className="text-xs text-gray-400"><span className="capitalize">{monthLabel}</span> · sin IVA · servicio del mes</span>
      </div>
      <div className="px-5 pb-5 flex flex-col sm:flex-row gap-6 sm:gap-8">
        <Line title="Asistencia" data={lines.attendance} />
        <div className="hidden sm:block w-px bg-gray-100 self-stretch" />
        <Line title="Transporte" data={lines.transport} />
      </div>
    </Card>
  )
}
