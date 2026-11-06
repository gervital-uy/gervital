import { change } from '../../../../services/dashboardV2/financeSeriesV2'
import { sameMonthBefore } from '../../../../services/dashboardV2/financeView'
import { longMonth } from './financeText'

// Lo que leen las fichas del gráfico principal (explain/docs/finance.js). El mes de
// la ficha es el que se ve: el elegido en Pesos y el último punto del período en
// Tendencia y Márgenes (con el filtro de años y meses pueden no coincidir).
//   headline: moneyHeadline(); trend: trendPoint() del período; margins:
//   marginPoints() del período; table: periodTable(); target: { value, persisted };
//   suggestion: suggestedTarget().
export function chartExplainContext({ view, selected, headline, trend, margins, table, target, suggestion }) {
  const focus = trend[trend.length - 1] || null
  const comp = focus ? sameMonthBefore(trend, focus) : null
  const focusMargin = margins[margins.length - 1] || null
  const focusName = focus ? longMonth(focus) : longMonth(selected)
  return {
    monthLabel: view === 'money' ? longMonth(selected) : focusName,
    chart: {
      money: headline && {
        ...headline,
        name: longMonth(selected),
        prevName: headline.prev ? longMonth(headline.prev) : null
      },
      trend: focus && {
        ...focus,
        name: focusName,
        comp: comp && { ...comp, name: longMonth(comp), change: change(focus.result, comp.result) },
        points: trend.length
      },
      margins: focusMargin && { ...focusMargin, name: longMonth(focusMargin), target: target.shown },
      target: {
        value: target.value,
        persisted: target.persisted,
        suggestion: suggestion && { ...suggestion, fromName: longMonth(suggestion.from), toName: longMonth(suggestion.to) }
      },
      periods: table.length ? { first: { ...table[0], name: longMonth(table[0]) }, count: table.length } : null
    }
  }
}
