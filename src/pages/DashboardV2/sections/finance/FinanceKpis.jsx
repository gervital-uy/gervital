import FinKpi from '../../ui/FinKpi'
import { money, pctText, plural } from '../../format'
import { packageEffect } from '../../../../services/dashboardV2/financeView'
import { compactMoney, longMonth, shortMonth } from './financeText'

// Lo que tiene que entrar − lo que cuesta operar = lo que queda, y el promedio que
// le saca el ruido al mes. Sin IVA, sobre "A ingresar al banco" y con los fijos
// mensualizados. q: financeQuadrantsV2().
export default function FinanceKpis({ q, open = false }) {
  if (!q) return null
  const prevNote = q.prev ? `Comparado con ${longMonth(q.prev)}.` : null
  const yoyLabel = q.yoyRef ? `vs ${shortMonth(q.yoyRef)}` : 'vs año anterior'
  const yoyNote = q.yoyRef ? `Comparado con ${longMonth(q.yoyRef)}.` : 'La serie arranca en junio de 2026: no hay año anterior.'
  const a = q.average
  const effect = packageEffect(q)
  const badge = effect && effect.net !== 0 ? {
    text: effect.net > 0 ? `paquetes +${compactMoney(effect.net)}` : `cubiertos ${compactMoney(effect.net)}`,
    suffix: effect.pct == null ? null : pctText(effect.pct, 0),
    detail: [
      effect.advance > 0 && `${plural(effect.packages, 'paquete de promo arranca', 'paquetes de promo arrancan')} este mes y ${effect.packages === 1 ? 'trae' : 'traen'} ${money(effect.advance)} de los meses que cubren.`,
      effect.covered > 0 && `${plural(effect.coveredMonths, 'mes ya está cubierto', 'meses ya están cubiertos')} por un paquete cobrado antes: su servicio (${money(effect.covered)}) no aporta acá.`,
      'Infla el mes en que arranca el paquete y adelgaza los que cubre, sin que el negocio cambie.'
    ].filter(Boolean).join(' ')
  } : null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-stretch">
      <FinKpi
        label="A ingresar al banco"
        infoId="finIncome"
        value={money(q.income)}
        hint={`Ya entró ${compactMoney(q.collected)} · falta ${compactMoney(q.pending)}`}
        badge={badge}
        deltas={[
          { change: q.deltas.incomeMoM, label: 'vs mes anterior', note: prevNote },
          { change: q.deltas.incomeYoY, label: yoyLabel, note: yoyNote }
        ]}
      />
      <FinKpi
        label="Total gastos"
        infoId="finExpenses"
        value={money(q.expenses)}
        secondary={`${pctText(q.expensesPct, 0)} de ingresos`}
        hint="Fijos mensualizados · con IVA"
        deltas={[
          { change: q.deltas.expensesMoM, label: 'vs mes anterior', note: prevNote, invert: true },
          { change: q.deltas.expensesYoY, label: yoyLabel, note: yoyNote, invert: true }
        ]}
      />
      <FinKpi
        label="Resultado del mes"
        infoId="finResult"
        value={money(q.result)}
        valueClass={q.result < 0 ? 'text-rose-600' : 'text-gray-900'}
        secondary={pctText(q.resultPct, 0)}
        secondaryStrong
        secondaryNote="margen"
        hint={open ? 'Antes de impuestos · mes en curso' : 'Antes de impuestos'}
        deltas={[
          { change: q.deltas.resultMoM, label: 'vs mes anterior', note: prevNote },
          { change: q.deltas.resultYoY, label: yoyLabel, note: yoyNote }
        ]}
      />
      <FinKpi
        label={`Margen promedio ${a.months} m`}
        infoId="finAverage"
        value={a.pct == null ? null : money(a.resultPerMonth)}
        valueClass={a.pct == null ? 'text-gray-400' : a.resultPerMonth < 0 ? 'text-rose-600' : 'text-gray-900'}
        secondary={a.pct == null ? null : pctText(a.pct, 0)}
        secondaryStrong
        secondaryNote="margen"
        hint="Por mes con ingresos"
        deltas={[
          { change: a.monthVsAveragePp, label: 'mes vs promedio', unit: 'pp' },
          { change: a.vsPrevWindowPp, label: `vs ${a.months} m anteriores`, unit: 'pp', note: a.vsPrevWindowPp == null ? 'Aparece cuando haya dos ventanas completas para comparar.' : null }
        ]}
      />
    </div>
  )
}
