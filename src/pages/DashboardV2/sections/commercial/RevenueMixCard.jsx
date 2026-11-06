import Card from '../../../../components/ui/Card'
import BreakdownBars from '../../ui/BreakdownBars'
import { segmentColor } from '../../ui/colors'
import { CARD } from './commercialText'
import DimensionHeader from './DimensionHeader'

// Aporte al MRR por segmento, de mayor a menor (es una pregunta de ranking; la
// composición ya muestra el orden de la escala). La flecha es la brecha entre su
// parte de la plata y su parte de los clientes.
export default function RevenueMixCard({ rows, dimension, onDimension }) {
  return (
    <Card role="group" aria-label="Aporte a la facturación" className={CARD}>
      <DimensionHeader title="Aporte a la facturación" infoId="revenueMix" hint="Qué segmentos traen más MRR" dimension={dimension} onDimension={onDimension} />
      <div className="px-5 pb-5">
        {rows.length === 0
          ? <p className="text-sm text-gray-400 py-8 text-center">No hay clientes activos.</p>
          : <BreakdownBars rows={rows.map(r => ({ ...r, color: segmentColor(dimension, r.key) }))} money pctSuffix="" />}
        <p className="mt-4 pt-3 border-t border-gray-50 text-[11px] text-gray-400 leading-relaxed">
          ▲ aporta más plata que gente · ▼ más gente que plata. El número es la brecha entre los dos porcentajes.
        </p>
      </div>
    </Card>
  )
}
