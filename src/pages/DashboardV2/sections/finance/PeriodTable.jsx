import InfoButton from '../../explain/InfoButton'
import { DASH, money, pctText } from '../../format'
import { changeText, pointLabel } from './financeText'

// Comparación de períodos, debajo del gráfico cuando manda el filtro de años y meses:
// un renglón por período, el más reciente arriba, cada uno contra su mismo mes del
// año anterior. Un gráfico de líneas no puede mostrar todas esas variaciones sin
// volverse un cartel. rows: periodTable() de financeView.
export default function PeriodTable({ rows }) {
  return (
    <div className="px-4 sm:px-6 pb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1">
          Comparación de períodos <InfoButton id="finPeriods" />
        </p>
        <p className="text-[10.5px] text-gray-300">cada período contra su mismo mes del año anterior</p>
      </div>
      <div className="rounded-xl border border-gray-100 overflow-x-auto scrollbar-thin">
        <div className="max-h-[236px] overflow-y-auto scrollbar-thin">
          <table className="w-full min-w-[520px] text-[11.5px] tabular-nums">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                <th scope="col" className="text-left font-semibold px-3 py-2">Período</th>
                <th scope="col" className="text-right font-semibold px-3 py-2 whitespace-nowrap">A ingresar al banco</th>
                <th scope="col" className="text-right font-semibold px-3 py-2">Costo</th>
                <th scope="col" className="text-right font-semibold px-3 py-2">Resultado</th>
                <th scope="col" className="text-right font-semibold px-3 py-2">Margen</th>
                <th scope="col" className="text-right font-semibold px-3 py-2 whitespace-nowrap">vs año anterior</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.year}-${r.month}`} className={i % 2 ? 'bg-gray-50/40' : ''}>
                  <th scope="row" className="px-3 py-1.5 text-left font-normal text-gray-700 whitespace-nowrap">{pointLabel(r, 'month')}</th>
                  <td className="px-3 py-1.5 text-right text-gray-600">{money(r.income)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{money(r.costs)}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${r.result >= 0 ? 'text-gray-900' : 'text-rose-600'}`}>{money(r.result)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{pctText(r.netPct, 0)}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    {!r.change ? (
                      <span className="text-gray-300">{DASH}</span>
                    ) : (
                      <span className={`font-semibold ${r.change.diff >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {changeText(r.change)}
                        <span className="ml-1 font-normal text-gray-400">vs {r.comp.year}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
