import InfoButton from '../../explain/InfoButton'
import MetricTabs from '../../ui/MetricTabs'
import { DIMENSION_TABS } from './commercialText'

// Encabezado de las tarjetas que se abren por Plan, Horario, Tier o Edad.
export default function DimensionHeader({ title, infoId, hint, dimension, onDimension }) {
  return (
    <div className="px-5 pt-5 pb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
          {title}
          <InfoButton id={infoId} />
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
      </div>
      <MetricTabs size="sm" options={DIMENSION_TABS} value={dimension} onChange={onDimension} label={`Dimensión de ${title.toLowerCase()}`} />
    </div>
  )
}
