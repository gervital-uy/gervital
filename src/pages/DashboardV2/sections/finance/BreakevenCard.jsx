import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import { formatCompact } from '../../../../utils/format'
import { DASH, MINUS, money, plural } from '../../format'
import { useElementWidth } from '../../ui/useElementWidth'
import { CARD_CLASS } from './cardsText'

// Utilidad-volumen: el resultado contra la cantidad de usuarios. Arranca en menos
// los costos fijos, sube con el aporte de cada usuario y cruza el cero en el
// equilibrio. Dónde cruza y dónde está hoy el centro se ven juntos.
function ProfitVolumeChart({ fixedCosts, contribution, users, breakeven, result }) {
  const [ref, w] = useElementWidth()
  const H = 132
  const pad = { t: 16, b: 26, l: 4, r: 4 }
  const be = Math.ceil(breakeven)
  const maxU = Math.max(5, Math.ceil((Math.max(users, be) * 1.3) / 5) * 5)
  const yTop = contribution * maxU - fixedCosts
  const yBot = -fixedCosts
  const x = u => pad.l + (u / maxU) * Math.max(0, w - pad.l - pad.r)
  const y = v => pad.t + (1 - (v - yBot) / ((yTop - yBot) || 1)) * (H - pad.t - pad.b)
  const above = users >= breakeven
  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={H} className="block overflow-visible" role="img" aria-label={`Resultado según la cantidad de usuarios: equilibrio en ${be}, hoy ${users}.`}>
        <polygon points={`${x(0)},${y(0)} ${x(breakeven)},${y(0)} ${x(0)},${y(yBot)}`} fill="rgba(244,63,94,0.10)" />
        <polygon points={`${x(breakeven)},${y(0)} ${x(maxU)},${y(0)} ${x(maxU)},${y(yTop)}`} fill="rgba(16,185,129,0.12)" />
        <line x1={x(0)} y1={y(0)} x2={x(maxU)} y2={y(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={x(0)} y1={y(yBot)} x2={x(maxU)} y2={y(yTop)} stroke="#334155" strokeWidth="2" strokeLinecap="round" />
        <line x1={x(breakeven)} y1={y(0)} x2={x(breakeven)} y2={H - pad.b + 4} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
        <circle cx={x(breakeven)} cy={y(0)} r="4" fill="#fff" stroke="#334155" strokeWidth="2" />
        <text x={x(breakeven)} y={H - pad.b + 17} textAnchor="middle" fill="#6b7280" fontSize="10.5" fontWeight="600">{be} equilibrio</text>
        <line x1={x(users)} y1={y(result)} x2={x(users)} y2={y(0)} stroke={above ? '#059669' : '#e11d48'} strokeWidth="1" strokeDasharray="3 3" />
        <circle cx={x(users)} cy={y(result)} r="4.5" fill={above ? '#059669' : '#e11d48'} />
        <text x={x(users)} y={y(result) - 9} textAnchor="middle" fill={above ? '#047857' : '#e11d48'} fontSize="11" fontWeight="700">
          {users} hoy · {result < 0 ? MINUS : ''}{formatCompact(Math.abs(result))}
        </text>
        <text x={x(0)} y={H - pad.b + 17} textAnchor="start" fill="#9ca3af" fontSize="10">0 usuarios</text>
        <text x={x(0) + 2} y={y(yBot) - 6} textAnchor="start" fill="#9ca3af" fontSize="10">{MINUS}{formatCompact(fixedCosts)} de costos fijos</text>
      </svg>
    </div>
  )
}

function Stat({ label, value, formula, valueClass = 'text-gray-900', strong = false }) {
  return (
    <div className={strong ? 'rounded-xl bg-gray-50 px-3 py-2.5' : 'px-3 py-2.5'}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-[19px] leading-none font-semibold tracking-tight tabular-nums mt-1.5 ${valueClass}`}>{value}</p>
      <p className="text-[10.5px] text-gray-400 mt-1.5 leading-snug">{formula}</p>
    </div>
  )
}

// Cuánto deja cada usuario y cuántos hacen falta para cubrir los costos fijos
// (breakevenV2): ingreso del servicio del mes, sin IVA.
export default function BreakevenCard({ breakeven: b, monthLabel }) {
  const be = b.breakevenUsers == null ? null : Math.ceil(b.breakevenUsers)
  const diff = be == null ? 0 : Math.abs(b.users - be)
  const above = be != null && b.users >= be

  return (
    <Card className={CARD_CLASS}>
      <div className="px-5 pt-5 pb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
            Por usuario y punto de equilibrio
            <InfoButton id="finBreakeven" />
          </h3>
          <p className="text-xs text-gray-400 mt-0.5"><span className="capitalize">{monthLabel}</span> · servicio del mes sin IVA · gastos del mes</p>
        </div>
        <span className="text-[12.5px] text-gray-500 tabular-nums shrink-0">{plural(b.users, 'usuario facturado', 'usuarios facturados')}</span>
      </div>

      {b.users === 0 ? (
        <p className="px-5 pb-6 text-sm text-gray-400">Sin usuarios facturados en el mes: no hay por quién dividir.</p>
      ) : (
        <>
          <div className="px-4 pb-3 grid grid-cols-2 lg:grid-cols-4 gap-x-1 gap-y-2">
            <Stat label="Ingreso por usuario" value={money(b.revenuePerUser)} formula={`servicio del mes ÷ ${b.users}`} />
            <Stat label="Costo por usuario" value={money(b.costPerUser)} formula={`gastos del mes ÷ ${b.users}`} />
            <Stat label="Margen por usuario" value={money(b.marginPerUser)} valueClass={b.marginPerUser < 0 ? 'text-rose-600' : 'text-gray-900'} formula="ingreso − costo por usuario" />
            <Stat strong label="Aporte de un usuario más" value={money(b.contributionPerUser)} formula={`ingreso − ${money(b.variablePerUser)} de gasto variable`} />
          </div>

          <div className="px-5 pb-5 pt-3 border-t border-gray-100">
            {be == null ? (
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-[12.5px] text-amber-800">
                Con estos números no hay punto de equilibrio: lo que deja cada usuario no alcanza a cubrir el gasto variable por usuario.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-[13px] font-medium text-gray-600">Punto de equilibrio</span>
                  <span className="text-[13px] text-gray-500 tabular-nums">
                    <span className="font-semibold text-gray-900">{plural(be, 'usuario', 'usuarios')}</span>
                    <span className="text-gray-400"> · {b.breakevenRevenue == null ? DASH : money(b.breakevenRevenue)} de servicio</span>
                  </span>
                </div>
                <ProfitVolumeChart fixedCosts={b.fixedCosts} contribution={b.contributionPerUser} users={b.users} breakeven={b.breakevenUsers} result={b.result} />
                <p className={`mt-1 text-[12.5px] font-medium ${above ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {above ? `${plural(diff, 'usuario', 'usuarios')} por encima del equilibrio` : `Faltan ${plural(diff, 'usuario', 'usuarios')} para cubrir los costos`}
                  {above && <span className="font-normal text-gray-400"> · es lo que se puede perder antes de entrar en pérdida</span>}
                </p>
              </>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
