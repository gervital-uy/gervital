import { useState, useEffect } from 'react'
import { Plus, Xmark } from 'iconoir-react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input, { Select, Textarea } from '../../components/ui/Input'
import { createFollowup, updateFollowup } from '../../services/api'
import { todayStr } from '../../utils/date'

export const FOLLOWUP_TYPES = [
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'objetivos', label: 'Objetivos' },
  { value: 'familiares', label: 'Reporte a familiares' }
]

// Motivación del cliente. Colores alineados a la paleta de la app (alta=verde,
// media=ámbar, baja=rojo), igual criterio que los niveles cognitivos.
export const MOTIVATIONS = [
  { value: 'alta', label: 'Alta', dot: 'bg-emerald-500', active: 'border-emerald-500 bg-emerald-500 text-white', chip: 'bg-emerald-50 text-emerald-700', border: 'border-l-emerald-500' },
  { value: 'media', label: 'Media', dot: 'bg-amber-500', active: 'border-amber-500 bg-amber-500 text-white', chip: 'bg-amber-50 text-amber-700', border: 'border-l-amber-500' },
  { value: 'baja', label: 'Baja', dot: 'bg-red-500', active: 'border-red-500 bg-red-500 text-white', chip: 'bg-red-50 text-red-700', border: 'border-l-red-500' }
]

export const motivationConfig = (v) => MOTIVATIONS.find(m => m.value === v)
export const typeLabel = (v) => FOLLOWUP_TYPES.find(t => t.value === v)?.label || v

const truncate = (s, n = 60) => (!s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s)

const emptyForm = (professional) => ({
  type: 'seguimiento',
  reportDate: todayStr(),
  professional: professional || '',
  discipline: '',
  motivation: '',
  observations: '',
  actions: '',
  recipient: '',
  generalObjectives: [''],
  specificObjectives: [''],
  strategies: []
})

const hasText = (arr) => (arr || []).some(t => t && t.trim())
const hasStrategyText = (arr) => (arr || []).some(e => e.text && e.text.trim())

export default function FollowupModal({ isOpen, onClose, clientId, report, professional, onSaved }) {
  const isEditing = !!report
  const [form, setForm] = useState(emptyForm(professional))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    if (report) {
      setForm({
        ...emptyForm(professional),
        ...report,
        motivation: report.motivation || '',
        generalObjectives: report.generalObjectives?.length ? [...report.generalObjectives] : [''],
        specificObjectives: report.specificObjectives?.length ? [...report.specificObjectives] : [''],
        strategies: report.strategies ? report.strategies.map(r => ({ ...r })) : []
      })
    } else {
      setForm(emptyForm(professional))
    }
  }, [isOpen, report, professional])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Listas dinámicas de objetivos
  const addObjetivo = (field) => setForm(f => ({ ...f, [field]: [...f[field], ''] }))
  const updateObjetivo = (field, idx, value) => setForm(f => {
    const arr = [...f[field]]
    arr[idx] = value
    return { ...f, [field]: arr }
  })
  const removeObjetivo = (field, idx) => setForm(f => ({ ...f, [field]: f[field].filter((_, i) => i !== idx) }))

  // Estrategias
  const addEstrategia = () => setForm(f => ({ ...f, strategies: [...f.strategies, { objective: '', text: '' }] }))
  const updateEstrategia = (idx, key, value) => setForm(f => ({
    ...f,
    strategies: f.strategies.map((row, i) => (i === idx ? { ...row, [key]: value } : row))
  }))
  const removeEstrategia = (idx) => setForm(f => ({ ...f, strategies: f.strategies.filter((_, i) => i !== idx) }))

  const isObjetivos = form.type === 'objetivos'
  const isFamiliares = form.type === 'familiares'

  const filled = isObjetivos
    ? (hasText(form.generalObjectives) || hasText(form.specificObjectives) || hasStrategyText(form.strategies))
    : (form.observations?.trim() || form.actions?.trim() || form.professional?.trim() || form.discipline?.trim())

  const specificOptions = form.specificObjectives
    .map((text, idx) => ({ idx, text }))
    .filter(o => o.text && o.text.trim())

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      // Normalizamos según tipo para no persistir campos de otro tipo.
      const base = {
        type: form.type,
        reportDate: form.reportDate,
        motivation: form.motivation || null
      }
      const payload = isObjetivos
        ? {
            ...base,
            professional: null, discipline: null, observations: null, actions: null, recipient: null,
            generalObjectives: form.generalObjectives.filter(t => t && t.trim()),
            specificObjectives: form.specificObjectives.filter(t => t && t.trim()),
            strategies: form.strategies.filter(e => e.text && e.text.trim())
          }
        : {
            ...base,
            professional: form.professional?.trim() || null,
            discipline: form.discipline?.trim() || null,
            observations: form.observations?.trim() || null,
            actions: form.actions?.trim() || null,
            recipient: isFamiliares ? (form.recipient?.trim() || null) : null,
            generalObjectives: [], specificObjectives: [], strategies: []
          }
      if (isEditing) await updateFollowup(report.id, payload)
      else await createFollowup(clientId, payload)
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? 'Editar informe' : 'Nuevo informe'} size="lg">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {/* Tipo de registro */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de registro</label>
          <div className="flex flex-wrap gap-2">
            {FOLLOWUP_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => set('type', t.value)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  form.type === t.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Fecha + Motivación */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
            <input
              type="date"
              value={form.reportDate}
              onChange={e => set('reportDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Motivación del cliente</label>
            <div className="flex flex-wrap gap-2">
              {MOTIVATIONS.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => set('motivation', form.motivation === m.value ? '' : m.value)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    form.motivation === m.value ? m.active : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${form.motivation === m.value ? 'bg-white' : m.dot}`} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Campos por tipo */}
        {!isObjetivos && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Profesional" value={form.professional} onChange={e => set('professional', e.target.value)} placeholder="Nombre del profesional" />
              <Input label="Disciplina" value={form.discipline} onChange={e => set('discipline', e.target.value)} placeholder="Ej.: Fonoaudiología, Kinesiología…" />
            </div>
            {isFamiliares && (
              <Input label="Destinatario del reporte" value={form.recipient} onChange={e => set('recipient', e.target.value)} placeholder="Familiar o referente que recibe el reporte" />
            )}
            <Textarea label="Observaciones" value={form.observations} onChange={e => set('observations', e.target.value)} placeholder="Observaciones de la sesión…" rows={4} />
            <Textarea label="Acciones tomadas / Cambios relevantes" value={form.actions} onChange={e => set('actions', e.target.value)} placeholder="Qué se hizo y qué cambió respecto a la sesión anterior…" rows={3} />
          </>
        )}

        {isObjetivos && (
          <div className="space-y-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
            {/* Objetivos generales */}
            <ObjectiveList
              title="Objetivos generales"
              items={form.generalObjectives}
              onAdd={() => addObjetivo('generalObjectives')}
              onUpdate={(idx, v) => updateObjetivo('generalObjectives', idx, v)}
              onRemove={idx => removeObjetivo('generalObjectives', idx)}
            />
            {/* Objetivos específicos */}
            <ObjectiveList
              title="Objetivos específicos"
              items={form.specificObjectives}
              onAdd={() => addObjetivo('specificObjectives')}
              onUpdate={(idx, v) => updateObjetivo('specificObjectives', idx, v)}
              onRemove={idx => removeObjetivo('specificObjectives', idx)}
            />
            {/* Estrategias */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Estrategias de intervención</label>
              </div>
              <p className="text-xs text-gray-500 mb-2">Vinculá cada estrategia con su objetivo específico.</p>
              <div className="space-y-3">
                {form.strategies.map((row, idx) => (
                  <div key={idx} className="relative rounded-lg border border-gray-200 bg-white p-3 pr-10 space-y-2">
                    <Select
                      value={row.objective ?? ''}
                      onChange={e => updateEstrategia(idx, 'objective', e.target.value)}
                      options={
                        specificOptions.length === 0
                          ? [{ value: '', label: 'Todavía no hay objetivos específicos' }]
                          : [{ value: '', label: 'Sin objetivo asociado' }, ...specificOptions.map(o => ({ value: String(o.idx), label: `Objetivo ${o.idx + 1}: ${truncate(o.text)}` }))]
                      }
                    />
                    <Textarea value={row.text} onChange={e => updateEstrategia(idx, 'text', e.target.value)} placeholder="Estrategia de intervención para este objetivo…" rows={2} />
                    <button
                      type="button"
                      onClick={() => removeEstrategia(idx)}
                      className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 rounded-lg hover:bg-gray-100"
                      aria-label="Eliminar estrategia"
                    >
                      <Xmark className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addEstrategia}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                >
                  <Plus className="w-4 h-4" /> Agregar estrategia
                </button>
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={handleSave} loading={saving} disabled={!filled}>{isEditing ? 'Guardar cambios' : 'Guardar informe'}</Button>
      </div>
    </Modal>
  )
}

// Lista dinámica numerada de objetivos (texto libre).
function ObjectiveList({ title, items, onAdd, onUpdate, onRemove }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{title}</label>
      <div className="space-y-2">
        {items.map((text, idx) => (
          <div key={idx} className="flex items-start gap-2">
            <span className="flex-shrink-0 mt-1.5 w-6 h-6 rounded-full bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center">{idx + 1}</span>
            <textarea
              rows={2}
              value={text}
              onChange={e => onUpdate(idx, e.target.value)}
              placeholder={`${title.slice(0, -1)} ${idx + 1}…`}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {items.length > 1 && (
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="flex-shrink-0 mt-1 p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-gray-100"
                aria-label="Eliminar"
              >
                <Xmark className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
        >
          <Plus className="w-4 h-4" /> Agregar objetivo
        </button>
      </div>
    </div>
  )
}
