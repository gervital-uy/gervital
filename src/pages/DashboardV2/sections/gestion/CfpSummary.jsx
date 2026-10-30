import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import { money, pctText, plural } from '../../format'

const LABEL = 'text-[10px] font-semibold uppercase tracking-wide text-gray-400'
const VALUE = 'text-[19px] leading-tight font-semibold tabular-nums mt-1'
const SUB = 'text-[11px] text-gray-400 mt-0.5'

// Progreso del mes: cuánto hay que cobrar y cuánto entró, o cuánto hay que facturar
// y cuánto falta emitir. Siempre sobre el padrón entero, no sobre el filtro.
export default function CfpSummary({ domain, collection: c, invoicing: f }) {
  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="px-5 py-4 flex flex-col gap-3">
        {domain === 'cobranza' ? (
          <>
            <div className="w-full grid grid-cols-1 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
              <div className="pb-4 sm:pb-0 sm:pr-5">
                <p className={`${LABEL} flex items-center gap-1`}>Previsto del mes <InfoButton id="cfp" /></p>
                <p className={`${VALUE} text-gray-900`}>{money(c.previsto)}</p>
                <p className={SUB}>con IVA · {plural(c.clientes, 'cliente', 'clientes')} del mes</p>
              </div>
              <div className="py-4 sm:py-0 sm:px-5">
                <p className={LABEL}>Cobrado</p>
                <p className={`${VALUE} text-emerald-700`}>
                  {money(c.cobrado)}
                  <span className="text-gray-300 font-normal"> · {pctText(c.pctCobro, 0)}</span>
                </p>
                <p className={SUB}>{c.alDia} de {c.clientes} clientes al día</p>
              </div>
              <div className="py-4 sm:py-0 sm:px-5">
                <p className={LABEL}>Pendiente</p>
                <p className={`${VALUE} ${c.pendiente > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
                  {money(c.pendiente)}
                  <span className="text-gray-300 font-normal"> · {pctText(c.pctPendiente, 0)}</span>
                </p>
                <p className={SUB}>
                  {c.pendientes === 1 ? '1 cliente por cobrar' : `${c.pendientes} clientes por cobrar`}
                  {c.vencidos > 0 && <span className="text-rose-500"> · {plural(c.vencidos, 'vencido', 'vencidos')}</span>}
                </p>
              </div>
              {/* Los paquetes ya están sumados en el previsto: van aparte porque son un
                  cobro de una sola vez que no se repite el mes siguiente. */}
              <div className="pt-4 sm:pt-0 sm:pl-5">
                <p className={LABEL}>Paquetes de promo</p>
                <p className={`${VALUE} ${c.paquetes > 0 ? 'text-gray-900' : 'text-gray-300'}`}>{money(c.paquetes)}</p>
                <p className={SUB}>
                  {c.paquetesCount === 0
                    ? 'ninguno este mes'
                    : `${plural(c.paquetesCount, 'paquete', 'paquetes')} · ya en el previsto`}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, c.pctCobro || 0)}%` }} />
              </div>
              <p className="text-[10.5px] text-gray-400">Ventana de pago: del 1 al 10 de cada mes</p>
            </div>
          </>
        ) : (
          <div className="w-full grid grid-cols-3 divide-x divide-gray-100">
            <div className="pr-5 sm:pr-7">
              <p className={`${LABEL} flex items-center gap-1`}>A facturar del mes <InfoButton id="cfp" /></p>
              <p className={`${VALUE} text-gray-900`}>{money(f.facturableTotal)}</p>
              <p className={SUB}>con IVA · {plural(f.clientes, 'cliente', 'clientes')}, altas incluidas</p>
            </div>
            <div className="px-5 sm:px-7">
              <p className={`${LABEL} flex items-center gap-1`}>IVA del mes <InfoButton id="ivaMes" /></p>
              <p className={`${VALUE} text-gray-900`}>{money(f.ivaDelMes)}</p>
              <p className={SUB}>lo emitido más lo que falta emitir</p>
            </div>
            <div className="pl-5 sm:pl-7">
              <p className={LABEL}>Sin emitir</p>
              <p className={`${VALUE} text-gray-900`}>
                {f.sinEmitir}
                <span className="text-gray-300 font-normal"> / {f.clientes}</span>
              </p>
              {/* Las que faltan, abiertas por motivo: lo que se puede emitir ya, lo
                  que espera el cobro y lo que está trabado por datos de la ficha. */}
              <p className={SUB}>
                {f.sinEmitir === 0 ? 'todo emitido' : [
                  `${f.listas} ${f.listas === 1 ? 'lista' : 'listas'}`,
                  f.esperandoCobro > 0 ? `${f.esperandoCobro} sin cobrar` : null,
                  f.trabadasFicha > 0 ? `${f.trabadasFicha} con datos faltantes` : null
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
