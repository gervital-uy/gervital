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
        {domain === 'collection' ? (
          <>
            <div className="w-full grid grid-cols-1 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
              <div className="pb-4 sm:pb-0 sm:pr-5">
                <p className={`${LABEL} flex items-center gap-1`}>Previsto del mes <InfoButton id="cfp" /></p>
                <p className={`${VALUE} text-gray-900`}>{money(c.expected)}</p>
                <p className={SUB}>con IVA · {plural(c.clients, 'cliente', 'clientes')} del mes</p>
              </div>
              <div className="py-4 sm:py-0 sm:px-5">
                <p className={LABEL}>Cobrado</p>
                <p className={`${VALUE} text-emerald-700`}>
                  {money(c.collected)}
                  <span className="text-gray-300 font-normal"> · {pctText(c.collectedPct, 0)}</span>
                </p>
                <p className={SUB}>{c.upToDate} de {c.clients} clientes al día</p>
              </div>
              <div className="py-4 sm:py-0 sm:px-5">
                <p className={LABEL}>Pendiente</p>
                <p className={`${VALUE} ${c.outstanding > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
                  {money(c.outstanding)}
                  <span className="text-gray-300 font-normal"> · {pctText(c.outstandingPct, 0)}</span>
                </p>
                <p className={SUB}>
                  {c.dueCount === 1 ? '1 cliente por cobrar' : `${c.dueCount} clientes por cobrar`}
                  {c.overdueCount > 0 && <span className="text-rose-500"> · {plural(c.overdueCount, 'vencido', 'vencidos')}</span>}
                </p>
              </div>
              {/* Los paquetes ya están sumados en el previsto: van aparte porque son un
                  cobro de una sola vez que no se repite el mes siguiente. */}
              <div className="pt-4 sm:pt-0 sm:pl-5">
                <p className={LABEL}>Paquetes de promo</p>
                <p className={`${VALUE} ${c.packages > 0 ? 'text-gray-900' : 'text-gray-300'}`}>{money(c.packages)}</p>
                <p className={SUB}>
                  {c.packageCount === 0
                    ? 'ninguno este mes'
                    : `${plural(c.packageCount, 'paquete', 'paquetes')} · ya en el previsto`}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, c.collectedPct || 0)}%` }} />
              </div>
              <p className="text-[10.5px] text-gray-400">Ventana de pago: del 1 al 10 de cada mes</p>
            </div>
          </>
        ) : (
          <div className="w-full grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
            <div className="pb-4 sm:pb-0 sm:pr-7">
              <p className={`${LABEL} flex items-center gap-1`}>A facturar del mes <InfoButton id="cfp" /></p>
              <p className={`${VALUE} text-gray-900`}>{money(f.billable)}</p>
              <p className={SUB}>con IVA · {plural(f.clients, 'cliente', 'clientes')}, altas incluidas</p>
            </div>
            <div className="py-4 sm:py-0 sm:px-7">
              <p className={`${LABEL} flex items-center gap-1`}>IVA del mes <InfoButton id="monthVat" /></p>
              <p className={`${VALUE} text-gray-900`}>{money(f.vat)}</p>
              <p className={SUB}>lo emitido más lo que falta emitir</p>
            </div>
            <div className="pt-4 sm:pt-0 sm:pl-7">
              <p className={LABEL}>Sin emitir</p>
              <p className={`${VALUE} text-gray-900`}>
                {f.notIssued}
                <span className="text-gray-300 font-normal"> / {f.clients}</span>
              </p>
              {/* Las que faltan, en grupos que no se pisan: lo que se puede emitir ya,
                  lo que espera el cobro, lo trabado por la ficha y lo rechazado. */}
              <p className={SUB}>
                {f.notIssued === 0 ? 'todo emitido' : [
                  `${f.ready} ${f.ready === 1 ? 'lista' : 'listas'}`,
                  f.awaitingPayment > 0 ? `${f.awaitingPayment} sin cobrar` : null,
                  f.missingRecordData > 0 ? `${f.missingRecordData} con datos faltantes` : null,
                  f.rejected > 0 ? `${f.rejected} ${f.rejected === 1 ? 'rechazada' : 'rechazadas'} por Biller` : null
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
