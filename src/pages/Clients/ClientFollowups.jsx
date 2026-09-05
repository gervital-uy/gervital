import { useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { parseDateOnly } from '../../utils/date'
import { Plus, Edit, Trash } from 'iconoir-react'
import Button from '../../components/ui/Button'
import { deleteFollowup } from '../../services/api'
import FollowupModal, { motivationConfig, typeLabel } from './FollowupModal'

function fmtDate(d) {
  return d ? format(parseDateOnly(d), 'd MMM yyyy', { locale: es }) : '—'
}

// Bloque de texto simple (no renderiza si está vacío).
function TextBlock({ label, text }) {
  if (!text || !text.trim()) return null
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <p className="text-sm text-gray-800 whitespace-pre-line">{text}</p>
    </div>
  )
}

// Lista numerada de objetivos.
function ObjectivesBlock({ label, items }) {
  const filled = (items || []).filter(t => t && t.trim())
  if (!filled.length) return null
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <ol className="list-decimal pl-5 space-y-0.5">
        {filled.map((t, i) => <li key={i} className="text-sm text-gray-800">{t}</li>)}
      </ol>
    </div>
  )
}

// Estrategias con su objetivo específico asociado.
function StrategiesBlock({ strategies, specificObjectives }) {
  const filled = (strategies || []).filter(e => e.text && e.text.trim())
  if (!filled.length) return null
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Estrategias de intervención</p>
      <div className="space-y-2">
        {filled.map((e, i) => {
          const idx = e.objective === '' || e.objective === undefined || e.objective === null ? null : Number(e.objective)
          const objText = idx !== null ? (specificObjectives || [])[idx] : null
          return (
            <div key={i} className="border-l-2 border-indigo-300 pl-3">
              <p className="text-xs text-gray-500">
                <span className="font-semibold text-gray-600">{idx !== null ? `Obj. ${idx + 1}` : 'Sin asociar'}</span>
                {objText ? ` · ${objText}` : ''}
              </p>
              <p className="text-sm text-gray-800 whitespace-pre-line">{e.text}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ClientFollowups({ clientId, reports, professional, canMutate, onRefresh }) {
  const [modal, setModal] = useState(null) // { report? } | null

  const handleDelete = async (report) => {
    if (!window.confirm('¿Eliminar este informe? No se puede deshacer.')) return
    try { await deleteFollowup(report.id); await onRefresh() }
    catch (e) { window.alert(e.message) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Seguimiento y observaciones</h3>
          <p className="text-sm text-gray-500">Informes del equipo interdisciplinario</p>
        </div>
        {canMutate && (
          <Button size="sm" onClick={() => setModal({})}>
            <Plus className="w-4 h-4" /> Nuevo informe
          </Button>
        )}
      </div>

      {reports.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center rounded-xl border border-dashed border-gray-200">
          Todavía no hay informes. {canMutate ? 'Creá el primero con "Nuevo informe".' : ''}
        </p>
      ) : (
        <div className="space-y-3">
          {reports.map(r => {
            const mot = motivationConfig(r.motivation)
            return (
              <article key={r.id} className={`rounded-xl border border-gray-200 border-l-4 ${mot ? mot.border : 'border-l-gray-200'} p-4`}>
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{fmtDate(r.reportDate)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {[r.professional, r.discipline].filter(Boolean).join(' · ') || 'Sin profesional'}
                      {r.recipient ? ` · Recibe: ${r.recipient}` : ''}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600">{typeLabel(r.type)}</span>
                  {mot && (
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${mot.chip}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${mot.dot}`} />
                      {mot.label}
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-3">
                  <TextBlock label="Observaciones" text={r.observations} />
                  <ObjectivesBlock label="Objetivos generales" items={r.generalObjectives} />
                  <ObjectivesBlock label="Objetivos específicos" items={r.specificObjectives} />
                  <StrategiesBlock strategies={r.strategies} specificObjectives={r.specificObjectives} />
                  <TextBlock label="Acciones tomadas / Cambios relevantes" text={r.actions} />
                </div>

                {canMutate && (
                  <div className="flex items-center gap-1 mt-3 pt-3 border-t border-gray-100">
                    <button onClick={() => setModal({ report: r })} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 hover:text-indigo-600" title="Editar">
                      <Edit className="w-3.5 h-3.5" /> Editar
                    </button>
                    <button onClick={() => handleDelete(r)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 hover:text-red-600" title="Eliminar">
                      <Trash className="w-3.5 h-3.5" /> Eliminar
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      <FollowupModal
        isOpen={!!modal}
        onClose={() => setModal(null)}
        clientId={clientId}
        report={modal?.report}
        professional={professional}
        onSaved={async () => { setModal(null); await onRefresh() }}
      />
    </div>
  )
}
