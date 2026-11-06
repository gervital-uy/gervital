import Card from '../../../../components/ui/Card'
import InfoButton from '../../explain/InfoButton'
import { money, pctText } from '../../format'
import { CARD_CLASS } from './cardsText'

// Caja e impuestos, con IVA: lo que el mes tiene que cobrar, cuánto entró, la caja
// real por fecha de pago y el IVA de ventas. Es otra pregunta que el resultado: no
// cuánto se ganó sino cuánta plata entró, así que va chica, en una franja.
export default function CashTaxesCard({ cash, open }) {
  const items = [
    { key: 'bank', label: 'A ingresar al banco', value: cash.bank, info: 'finCash', sub: open ? 'del mes, que todavía no cerró' : 'lo que el mes tiene que cobrar' },
    {
      key: 'collected',
      label: 'Ya entró',
      value: cash.collected,
      pct: cash.collectedPct,
      valueClass: cash.collectedPct >= 90 ? 'text-emerald-700' : cash.collectedPct >= 70 ? 'text-gray-900' : 'text-amber-600',
      sub: 'de las cuotas y paquetes del mes'
    },
    { key: 'pending', label: 'Falta cobrar', value: cash.pending, sub: 'de este mes, sin deuda vieja' },
    {
      key: 'cash',
      label: 'Caja del mes',
      value: cash.cash,
      sub: cash.cashOtherMonths > 0 ? `por fecha de pago · ${money(cash.cashOtherMonths)} de otros meses` : 'por fecha de pago'
    },
    { key: 'vat', label: 'IVA de ventas', value: cash.vat, info: 'finVat', sub: 'asistencia 22% · transporte 10%' }
  ]

  return (
    <Card className={CARD_CLASS}>
      <div className="px-4 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 text-center">
          Caja e impuestos
          <span className="ml-1.5 font-medium normal-case tracking-normal">· con IVA</span>
        </p>
        <div className="mt-3.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-4">
          {items.map((it, n) => (
            <div key={it.key} className={`text-center px-3 ${n > 0 ? 'lg:border-l lg:border-gray-100' : ''} ${it.key === 'vat' ? 'lg:border-gray-200' : ''}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center justify-center gap-1 whitespace-nowrap">
                {it.label}
                {it.info && <InfoButton id={it.info} />}
              </p>
              <p className="mt-1.5 flex items-baseline justify-center gap-1.5 whitespace-nowrap">
                <span className={`text-[16px] leading-none font-semibold tabular-nums tracking-tight ${it.valueClass || 'text-gray-900'}`}>{money(it.value)}</span>
                {it.pct != null && <span className="text-[11.5px] font-medium text-gray-400 tabular-nums">{pctText(it.pct, 0)}</span>}
              </p>
              <p className="mt-1 text-[10.5px] text-gray-400 leading-snug">{it.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
