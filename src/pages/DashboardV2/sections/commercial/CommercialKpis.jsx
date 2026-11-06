import { formatCompact } from '../../../../utils/format'
import FinKpi from '../../ui/FinKpi'
import { formatDecimal, money, pctText, plural, MINUS } from '../../format'
import { monthsText, shortMonth } from './commercialText'

// Las seis cifras de la cartera, en dos filas de tres. month: commercialView.month(i);
// yearAgo: el mismo mes del año anterior (null mientras no exista).
export default function CommercialKpis({ month, yearAgo }) {
  const { counts, clients, churn, mrr, tenure } = month
  const churnWindow = churn.window
  const rate = mrr.window
  const yoyLabel = `vs ${shortMonth(month.year - 1, month.month)}`
  const span = monthsText(churnWindow.months)
  // Altas, bajas y MRR ganado o perdido son flujos: se comparan con el promedio de los
  // meses cerrados. El mes en curso no se compara: lleva unos días contra meses enteros.
  const versusAverage = (current, avg, avgMonths, extra = {}) => (month.partial
    ? { change: null, label: 'mes en curso', note: 'El mes todavía no terminó: compararlo con el promedio de meses completos lo haría ver peor o mejor de lo que es.', ...extra }
    : { change: avg == null ? null : { base: avg, diff: current - avg, pct: avg !== 0 ? ((current - avg) / avg) * 100 : null }, label: `vs promedio ${avgMonths} m`, ...extra })
  const averageHint = (avg, avgMonths) => (avg == null
    ? 'Todavía no hay meses cerrados para promediar'
    : `${money(avg)} por mes en promedio · ${monthsText(avgMonths)}${avgMonths < rate.months ? ` ${avgMonths === 1 ? 'cerrado' : 'cerrados'}` : ''}`)

  // El churn se juzga contra la ventana anterior del mismo largo; hasta que exista, gris.
  const churnTone = churnWindow.delta == null ? 'text-gray-900' : churnWindow.delta < -1 ? 'text-emerald-700' : churnWindow.delta > 1 ? 'text-rose-600' : 'text-gray-900'
  const tenureMonths = tenure.measured ? Number(tenure.avgMonths.toFixed(1)) : null
  const tenureBefore = yearAgo?.tenure.measured ? Number(yearAgo.tenure.avgMonths.toFixed(1)) : null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
      <FinKpi
        label="Clientes activos"
        infoId="activeClients"
        value={String(clients.active)}
        deltas={[
          { change: clients.mom, label: 'vs mes anterior', unit: 'n' },
          { change: clients.yoy, label: yoyLabel, unit: 'n' }
        ]}
        hint={`${plural(counts.altas, 'alta', 'altas')} y ${plural(counts.bajas, 'baja', 'bajas')} sobre una base de ${counts.opening}`}
      />
      <FinKpi
        label="MRR contratado"
        infoId="mrr"
        value={money(mrr.closing.total)}
        valueClass="text-emerald-700"
        deltas={[
          { change: mrr.mom, label: 'vs mes anterior' },
          { change: mrr.yoy, label: yoyLabel }
        ]}
        hint="Plan más transporte, con descuentos y sin IVA"
      />
      <FinKpi
        label="Churn 12 meses"
        infoId="churn"
        value={pctText(churnWindow.churn, 0)}
        valueClass={churnTone}
        secondary={`${plural(counts.bajas, 'baja', 'bajas')} este mes`}
        deltas={[
          { change: churnWindow.delta == null ? null : { base: churnWindow.prev.churn, diff: churnWindow.delta, pct: churnWindow.delta }, label: `vs ${churnWindow.months} m anteriores`, unit: 'pp', invert: true },
          { ...versusAverage(counts.bajas, churnWindow.avgBajas, churnWindow.avgMonths), label: month.partial ? 'bajas: mes en curso' : 'bajas vs promedio', unit: 'n', invert: true }
        ]}
        hint={`${plural(churnWindow.bajas, 'baja', 'bajas')} sobre ${Math.round(churnWindow.baseMedia)} de cartera media · ${span}`}
      />
      <FinKpi
        label="MRR ganado"
        infoId="mrrFlow"
        value={mrr.gained.total > 0 ? `+${money(mrr.gained.total)}` : money(0)}
        valueClass={mrr.gained.total > 0 ? 'text-emerald-700' : 'text-gray-900'}
        secondary={`${rate.months} m ${formatCompact(rate.gained)}`}
        deltas={[versusAverage(mrr.gained.total, rate.avgGained, rate.avgMonths)]}
        hint={averageHint(rate.avgGained, rate.avgMonths)}
      />
      <FinKpi
        label="MRR perdido"
        infoId="mrrFlow"
        value={mrr.lost.total > 0 ? money(-mrr.lost.total) : money(0)}
        valueClass={mrr.lost.total > 0 ? 'text-rose-600' : 'text-gray-900'}
        secondary={`${rate.months} m ${formatCompact(rate.lost)}`}
        deltas={[versusAverage(mrr.lost.total, rate.avgLost, rate.avgMonths, { invert: true })]}
        hint={`Neto ${rate.net >= 0 ? '+' : MINUS}${formatCompact(Math.abs(rate.net))} · ${monthsText(rate.months)}`}
      />
      {/* La permanencia promedia solo a quienes la plataforma vio entrar: a los
          heredados no se les inventa antigüedad, se dicen aparte. */}
      <FinKpi
        label="Permanencia media"
        infoId="tenure"
        value={tenureMonths == null ? null : `${formatDecimal(tenureMonths)} m`}
        secondary={tenure.inherited
          ? `${tenure.inherited} sin alta registrada`
          : tenure.closedAvgMonths == null ? null : `bajas ${formatDecimal(tenure.closedAvgMonths)} m`}
        deltas={[{
          change: tenureMonths == null || tenureBefore == null ? null : { base: tenureBefore, diff: Number((tenureMonths - tenureBefore).toFixed(1)), pct: null },
          label: yoyLabel,
          unit: 'n'
        }]}
        hint={tenure.measured
          ? `Promedia ${tenure.measured} de ${clients.active} activos`
          : 'Ningún activo tiene alta registrada'}
      />
    </div>
  )
}
