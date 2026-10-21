import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { format, addDays, subDays, isToday, differenceInCalendarDays, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { NavArrowLeft, NavArrowRight, Calendar } from 'iconoir-react'
import { getClients, getAttendanceForDate } from '../../services/api'
import { classifyDay, buildDayRoster, indexAttendanceByClientId, keepClientsInSlots, ABSENT_STATUSES, RECOVERY_STATUS } from '../../services/attendance/dayRoster'
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus'
import {
  getTimeSlotsForDate,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot,
  createActivity,
  updateActivity,
  deleteActivity,
  assignClientToActivity,
  removeClientFromActivity,
  cleanupOldGroups
} from '../../services/groups/groupService'
import {
  saveReferenceGroup,
  applyReferenceGroup,
  getReferenceGroupInfo
} from '../../services/groups/referenceGroupService'
import TimeSlotCard from './TimeSlotCard'
import ClientPool from './ClientPool'
import { PoolClientChip } from './ClientChip'
import TemplateModal from './TemplateModal'
import GroupsWeekTable from './GroupsWeekTable'
import Button from '../../components/ui/Button'

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function dateToStr(d) {
  return format(d, 'yyyy-MM-dd')
}

// ── DailyGroups (main) ───────────────────────────────────────────────────────

export default function DailyGroups() {
  // Estado y no memo: si la pestaña queda abierta de un día para el otro, el
  // refresco por foco lo actualiza (readOnly, 'Hoy' y la ventana de ±14 días).
  const [today, setToday] = useState(() => startOfDay(new Date()))
  const cleanupDone = useRef(false)
  // Temp ids for optimistic inserts, reconciled with the server id on success
  const tempIdRef = useRef(0)
  const nextTempId = () => `temp-${++tempIdRef.current}`

  const [selectedDate, setSelectedDate] = useState(today)
  const [activeShift, setActiveShift] = useState('afternoon')
  const [loading, setLoading] = useState(true)
  const [allClients, setAllClients] = useState([])
  // 'loading' | 'ok' | 'error'. Sólo 'ok' cuenta como roster confiable: un fallo
  // no puede pasar por "no viene nadie".
  const [clientsStatus, setClientsStatus] = useState('loading')
  const [attendanceByClientId, setAttendanceByClientId] = useState(new Map())
  // Fecha a la que corresponde attendanceByClientId: hasta que coincide con la
  // fecha elegida, el roster del día no es confiable y no se filtran los grupos.
  const [attendanceDate, setAttendanceDate] = useState(null)
  // Fecha cuya carga de asistencia falló (sin datos buenos para mostrar)
  const [attendanceError, setAttendanceError] = useState(null)
  const [timeSlots, setTimeSlots] = useState([])
  // A qué día|turno corresponden los timeSlots cargados, y cuál falló al cargar.
  // Mientras no coincide con la selección, los horarios no son confiables.
  const [slotsKey, setSlotsKey] = useState(null)
  const [slotsError, setSlotsError] = useState(null)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [showWeek, setShowWeek] = useState(false)
  const [referenceInfo, setReferenceInfo] = useState({ exists: false, updatedAt: null })
  const [refBusy, setRefBusy] = useState(false)

  // DnD state
  const [draggedClient, setDraggedClient] = useState(null)
  const [invalidDropSlotIds, setInvalidDropSlotIds] = useState(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  // Editable si el día es hoy o futuro; solo lectura si ya pasó
  const readOnly = differenceInCalendarDays(today, selectedDate) > 0
  const dateStr = dateToStr(selectedDate)
  const dayName = DAY_NAMES[selectedDate.getDay()]
  const isWeekend = dayName === 'saturday' || dayName === 'sunday'

  // ── Derived data ──────────────────────────────────────────────────────────

  const clientsById = useMemo(() => {
    const map = new Map()
    allClients.forEach(c => map.set(c.id, c))
    return map
  }, [allClients])

  const dayClassified = useMemo(() => {
    const matchesShift = c => activeShift === 'morning'
      ? (c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day')
      : (c.plan?.schedule === 'afternoon' || c.plan?.schedule === 'full_day')
    return classifyDay({ clients: allClients, dayName, matchesShift, attendanceByClientId })
  }, [allClients, dayName, activeShift, attendanceByClientId])

  const shiftClients = dayClassified.present
  const rosterReady = clientsStatus === 'ok' && attendanceDate === dateStr
  const rosterError = clientsStatus === 'error' || attendanceError === dateStr
  const currentSlotsKey = `${dateStr}|${activeShift}`
  const slotsReady = !loading && slotsKey === currentSlotsKey && slotsError !== currentSlotsKey

  // Only the day's present roster can appear inside a time slot. An assignment
  // can outlive presence (assigned while present, then a falta, a recupero
  // anulado, a plan change or a baja), so the rendered slots keep only present
  // clients without touching the stored assignment: undoing the change brings
  // the client back to the same activity.
  // Días pasados (solo lectura): clients_full trae el plan del mes ACTUAL, así
  // que la lista blanca podría esconder a quien sí vino con el plan de entonces.
  // En el histórico sólo se saca a quien tiene una falta registrada ese día.
  const allowedIds = useMemo(() => {
    if (!rosterReady) return null
    if (readOnly) {
      const ids = new Set(timeSlots.flatMap(s => s.activities.flatMap(a => a.clientIds)))
      attendanceByClientId.forEach((rec, id) => { if (ABSENT_STATUSES.includes(rec.status)) ids.delete(id) })
      return ids
    }
    return new Set(shiftClients.map(c => c.id))
  }, [rosterReady, readOnly, timeSlots, attendanceByClientId, shiftClients])
  const displaySlots = useMemo(
    () => keepClientsInSlots(timeSlots, allowedIds),
    [timeSlots, allowedIds]
  )

  // Meal counts: global to the day, independent of the active shift tab.
  // Desayuno = mañana + día completo · Almuerzo = solo día completo · Merienda = tarde + día completo.
  const mealCounts = useMemo(() => {
    const countFor = (matchesShift) =>
      buildDayRoster({ clients: allClients, dayName, matchesShift, attendanceByClientId }).length
    return {
      breakfast: countFor(c => c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day'),
      lunch: countFor(c => c.plan?.schedule === 'full_day'),
      snack: countFor(c => c.plan?.schedule === 'afternoon' || c.plan?.schedule === 'full_day')
    }
  }, [allClients, dayName, attendanceByClientId])

  const recoveryIds = useMemo(() => {
    const ids = new Set()
    attendanceByClientId.forEach((rec, id) => { if (rec.status === RECOVERY_STATUS) ids.add(id) })
    return ids
  }, [attendanceByClientId])

  // Clients assigned to every time slot of the active shift
  const clientsInAllSlots = useMemo(() => {
    const result = new Set()
    if (!slotsReady || displaySlots.length === 0) return result
    const slotSets = displaySlots.map(slot => {
      const ids = new Set()
      slot.activities.forEach(a => a.clientIds.forEach(id => ids.add(id)))
      return ids
    })
    for (const id of slotSets[0]) {
      if (slotSets.every(s => s.has(id))) result.add(id)
    }
    return result
  }, [slotsReady, displaySlots])

  // ── Navigation helpers ────────────────────────────────────────────────────

  const canGoBack = differenceInCalendarDays(today, selectedDate) < 14
  const canGoForward = differenceInCalendarDays(selectedDate, today) < 14

  function goBack() {
    if (canGoBack) setSelectedDate(prev => subDays(prev, 1))
  }

  function goForward() {
    if (canGoForward) setSelectedDate(prev => addDays(prev, 1))
  }

  function goToday() {
    setSelectedDate(today)
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  // Al navegar rápido entre días o turnos, una respuesta vieja puede llegar
  // después de la nueva: sólo se aplica la del último pedido, y una recarga
  // pedida para un día/turno que ya no está seleccionado (p. ej. al volver de
  // 'Aplicar grupo de referencia' después de cambiar de turno) se ignora.
  const selectionRef = useRef({ dateStr, shift: activeShift })
  selectionRef.current = { dateStr, shift: activeShift }
  const slotsRequestRef = useRef(0)
  const slotsKeyRef = useRef(null)
  const loadSlots = useCallback(async (dStr, shift, { silent = false } = {}) => {
    const sel = selectionRef.current
    if (dStr !== sel.dateStr || shift !== sel.shift) return
    const key = `${dStr}|${shift}`
    const requestId = ++slotsRequestRef.current
    if (!silent) setLoading(true)
    try {
      const slots = await getTimeSlotsForDate(dStr, shift)
      if (requestId !== slotsRequestRef.current) return
      setTimeSlots(slots)
      setSlotsKey(key)
      setSlotsError(null)
      slotsKeyRef.current = key
    } catch (err) {
      console.error('Error loading time slots:', err)
      // Si falla, se muestra el error en vez de horarios que pueden ya no existir
      // (las recargas silenciosas vienen después de aplicar una plantilla o la
      // referencia, que borran y recrean los horarios) o de un día vacío que
      // dejaría aplicar la referencia sin confirmar y pisar los grupos.
      if (requestId === slotsRequestRef.current) setSlotsError(key)
    } finally {
      // El último pedido baja el spinner aunque sea silencioso: puede haber
      // reemplazado a uno no silencioso que ya no lo va a bajar.
      if (requestId === slotsRequestRef.current) setLoading(false)
    }
  }, [])

  // Reference-group info for the current (weekday, shift)
  useEffect(() => {
    if (isWeekend) { setReferenceInfo({ exists: false, updatedAt: null }); return }
    let alive = true
    getReferenceGroupInfo(dayName, activeShift)
      .then(info => { if (alive) setReferenceInfo(info) })
      .catch(() => { if (alive) setReferenceInfo({ exists: false, updatedAt: null }) })
    return () => { alive = false }
  }, [dayName, activeShift, isWeekend])

  const handleSaveReference = async () => {
    if (referenceInfo.exists && !window.confirm('Ya existe un grupo de referencia para este día y turno. ¿Sobrescribir con la configuración actual?')) return
    setRefBusy(true)
    try {
      await saveReferenceGroup(dateStr, activeShift, dayName)
      const info = await getReferenceGroupInfo(dayName, activeShift)
      setReferenceInfo(info)
    } catch (e) {
      alert('Error al guardar el grupo de referencia: ' + e.message)
    } finally {
      setRefBusy(false)
    }
  }

  const handleApplyReference = async () => {
    if (!referenceInfo.exists) return
    if (timeSlots.length > 0 && !window.confirm('Esto reemplaza todos los grupos y asignaciones de hoy con el grupo de referencia. ¿Continuar?')) return
    setRefBusy(true)
    try {
      const presentIds = shiftClients.map(c => c.id)
      await applyReferenceGroup(dayName, activeShift, dateStr, presentIds)
      await loadSlots(dateStr, activeShift, { silent: true })
    } catch (e) {
      alert('Error al aplicar el grupo de referencia: ' + e.message)
    } finally {
      setRefBusy(false)
    }
  }

  // Se aplica una respuesta si es más nueva que la última aplicada: una buena
  // no se descarta porque haya salido otro pedido después (que puede fallar).
  const clientsRequestRef = useRef(0)
  const clientsAppliedRef = useRef(0)
  const clientsOkRef = useRef(false)
  const loadClients = useCallback(async () => {
    const requestId = ++clientsRequestRef.current
    try {
      const clients = await getClients()
      if (requestId < clientsAppliedRef.current) return
      clientsAppliedRef.current = requestId
      clientsOkRef.current = true
      setAllClients(clients)
      setClientsStatus('ok')
    } catch (err) {
      console.error('Error loading clients:', err)
      // Un refresco que falla conserva los clientes ya cargados
      if (!clientsOkRef.current && requestId === clientsRequestRef.current) setClientsStatus('error')
    }
  }, [])

  // Initial load: cleanup + load clients
  useEffect(() => {
    async function init() {
      if (!cleanupDone.current) {
        cleanupDone.current = true
        await cleanupOldGroups(dateToStr(today)).catch(() => {})
      }
      await loadClients()
    }
    init()
  }, [today, loadClients])

  // Actual attendance for a date (to reflect absences/recoveries). Only the
  // latest request lands, so a slow response for a previous day can't overwrite
  // the current one. If it fails, good data already loaded for that date is
  // kept (a failed refresh); with nothing to show, the day is flagged as error.
  const attendanceRequestRef = useRef(0)
  const attendanceAppliedRef = useRef(0)
  // Fecha con asistencia buena ya aplicada (se actualiza al aplicar, no al render)
  const goodAttendanceDateRef = useRef(null)
  const loadAttendance = useCallback(async (dStr) => {
    const requestId = ++attendanceRequestRef.current
    try {
      const map = indexAttendanceByClientId(await getAttendanceForDate(dStr))
      if (requestId < attendanceAppliedRef.current || dStr !== selectionRef.current.dateStr) return
      attendanceAppliedRef.current = requestId
      goodAttendanceDateRef.current = dStr
      setAttendanceByClientId(map)
      setAttendanceDate(dStr)
      setAttendanceError(null)
    } catch (err) {
      console.error('Error loading attendance:', err)
      if (requestId !== attendanceRequestRef.current || dStr !== selectionRef.current.dateStr) return
      if (goodAttendanceDateRef.current !== dStr) setAttendanceError(dStr)
    }
  }, [])

  // Changing the date drops the previous day's attendance right away, so its
  // absences can't leak into the new day while the new one loads.
  useEffect(() => {
    goodAttendanceDateRef.current = null
    setAttendanceByClientId(new Map())
    setAttendanceDate(null)
    setAttendanceError(null)
    loadAttendance(dateStr)
  }, [dateStr, loadAttendance])

  const retryRoster = () => {
    if (clientsStatus !== 'ok') loadClients()
    loadAttendance(dateStr)
  }

  // Faltas y recuperos se cargan desde la ficha del cliente: al volver a esta
  // pestaña se refrescan clientes y asistencia (sin vaciar nada mientras tanto).
  useRefreshOnFocus(() => {
    const now = startOfDay(new Date())
    if (now.getTime() !== today.getTime()) {
      // La pestaña quedó abierta de un día para otro: si estaba en "hoy", pasa
      // al nuevo hoy (el cambio de fecha recarga todo).
      if (selectedDate.getTime() === today.getTime()) setSelectedDate(now)
      setToday(now)
      setShowTemplateModal(false)
    }
    loadClients()
    loadAttendance(dateStr)
  })

  // Load slots when date or shift changes
  useEffect(() => {
    loadSlots(dateStr, activeShift)
  }, [dateStr, activeShift, loadSlots])

  // Estable: el modal semanal resetea su búsqueda cuando cambia onClose, y el
  // refresco por foco re-renderiza esta pantalla con el modal abierto.
  const closeWeek = useCallback(() => setShowWeek(false), [])

  // ── Slot CRUD handlers ────────────────────────────────────────────────────

  // Deshace un cambio optimista sólo si la pantalla sigue en el mismo día|turno:
  // si mientras tanto se cambió de turno o de día, el snapshot es de otro lado.
  function rollbackSlots(snapshot, snapshotKey) {
    if (slotsKeyRef.current === snapshotKey) setTimeSlots(snapshot)
  }

  async function handleAddSlot() {
    const position = timeSlots.length
    const defaultTime = activeShift === 'morning' ? '09:00' : '15:00'
    const name = `Horario ${position + 1}`
    const tempId = nextTempId()
    const snapshot = timeSlots
    const snapshotKey = slotsKeyRef.current
    // Optimistic: mostramos el horario al instante, reconciliamos el id real al volver
    setTimeSlots(prev => [...prev, { id: tempId, date: dateStr, shift: activeShift, name, time: defaultTime, position, activities: [] }])
    try {
      const realId = await createTimeSlot(dateStr, activeShift, { name, time: defaultTime, position })
      setTimeSlots(prev => prev.map(s => s.id === tempId ? { ...s, id: realId } : s))
    } catch (err) {
      console.error('Error creating time slot:', err)
      rollbackSlots(snapshot, snapshotKey)
    }
  }

  async function handleUpdateSlot(slotId, fields) {
    const snapshot = timeSlots
    const snapshotKey = slotsKeyRef.current
    setTimeSlots(prev => prev.map(s => s.id === slotId ? { ...s, ...fields } : s))
    try {
      await updateTimeSlot(slotId, fields)
    } catch (err) {
      console.error('Error updating time slot:', err)
      rollbackSlots(snapshot, snapshotKey)
    }
  }

  async function handleDeleteSlot(slotId) {
    const snapshot = timeSlots
    const snapshotKey = slotsKeyRef.current
    setTimeSlots(prev => prev.filter(s => s.id !== slotId))
    try {
      await deleteTimeSlot(slotId)
    } catch (err) {
      console.error('Error deleting time slot:', err)
      rollbackSlots(snapshot, snapshotKey)
    }
  }

  // ── Activity CRUD handlers ────────────────────────────────────────────────

  async function handleAddActivity(slotId) {
    const slot = timeSlots.find(s => s.id === slotId)
    const position = slot ? slot.activities.length : 0
    const name = 'Nueva actividad'
    const tempId = nextTempId()
    const snapshot = timeSlots
    const snapshotKey = slotsKeyRef.current
    setTimeSlots(prev => prev.map(s =>
      s.id !== slotId ? s : { ...s, activities: [...s.activities, { id: tempId, name, responsible: null, position, clientIds: [] }] }
    ))
    try {
      const realId = await createActivity(slotId, { name, responsible: null, position })
      setTimeSlots(prev => prev.map(s =>
        s.id !== slotId ? s : { ...s, activities: s.activities.map(a => a.id === tempId ? { ...a, id: realId } : a) }
      ))
    } catch (err) {
      console.error('Error creating activity:', err)
      rollbackSlots(snapshot, snapshotKey)
    }
  }

  async function handleUpdateActivity(activityId, fields) {
    const snapshot = timeSlots
    const snapshotKey = slotsKeyRef.current
    setTimeSlots(prev => prev.map(s => ({
      ...s,
      activities: s.activities.map(a => a.id === activityId ? { ...a, ...fields } : a)
    })))
    try {
      await updateActivity(activityId, fields)
    } catch (err) {
      console.error('Error updating activity:', err)
      rollbackSlots(snapshot, snapshotKey)
    }
  }

  async function handleDeleteActivity(activityId) {
    const snapshot = timeSlots
    const snapshotKey = slotsKeyRef.current
    setTimeSlots(prev => prev.map(s => ({
      ...s,
      activities: s.activities.filter(a => a.id !== activityId)
    })))
    try {
      await deleteActivity(activityId)
    } catch (err) {
      console.error('Error deleting activity:', err)
      rollbackSlots(snapshot, snapshotKey)
    }
  }

  // ── Client assignment handlers ────────────────────────────────────────────

  async function handleRemoveClient(activityId, clientId) {
    // Optimistic: drop the chip immediately, restore snapshot if the delete fails
    const snapshot = timeSlots
    const snapshotKey = slotsKeyRef.current
    setTimeSlots(prev => prev.map(slot => ({
      ...slot,
      activities: slot.activities.map(a =>
        a.id !== activityId ? a : { ...a, clientIds: a.clientIds.filter(id => id !== clientId) }
      )
    })))
    try {
      await removeClientFromActivity(activityId, clientId)
    } catch (err) {
      console.error('Error removing client:', err)
      rollbackSlots(snapshot, snapshotKey)
    }
  }

  // ── DnD handlers ──────────────────────────────────────────────────────────

  function handleDragStart({ active }) {
    if (readOnly) return
    const data = active.data.current
    if (data?.type !== 'pool-client' && data?.type !== 'assigned-client') return

    setDraggedClient(data.client)

    // Slots where this client already has an assignment are invalid drop targets
    // (a client can only be in one activity per time slot). When moving an existing
    // assignment, the source slot stays valid — we vacate the source activity first.
    const ids = new Set()
    for (const slot of timeSlots) {
      if (data.type === 'assigned-client' && slot.id === data.sourceSlotId) continue
      for (const activity of slot.activities) {
        if (activity.clientIds.includes(data.client.id)) {
          ids.add(slot.id)
          break
        }
      }
    }
    setInvalidDropSlotIds(ids)
  }

  function handleDragEnd({ active, over }) {
    if (readOnly) return
    const client = draggedClient
    const activeType = active.data.current?.type
    setDraggedClient(null)
    setInvalidDropSlotIds(new Set())

    if (!over || !client) return

    const overData = over.data.current
    if (overData?.type !== 'activity') return

    const { activityId, slotId } = overData

    if (activeType === 'assigned-client') {
      const { sourceActivityId } = active.data.current
      if (sourceActivityId === activityId) return // dropped back on the same activity

      // Validate: client must not already be in another activity of the target slot
      const targetSlot = timeSlots.find(s => s.id === slotId)
      if (targetSlot) {
        const alreadyInSlot = targetSlot.activities.some(a =>
          a.id !== sourceActivityId && a.clientIds.includes(client.id)
        )
        if (alreadyInSlot) return
      }

      // Optimistic move: remove from source activity, add to target
      const snapshot = timeSlots
      const snapshotKey = slotsKeyRef.current
      setTimeSlots(prev => prev.map(slot => ({
        ...slot,
        activities: slot.activities.map(a => {
          if (a.id === sourceActivityId) return { ...a, clientIds: a.clientIds.filter(id => id !== client.id) }
          if (a.id === activityId) return { ...a, clientIds: [...a.clientIds, client.id] }
          return a
        })
      })))

      // Vaciar el origen ANTES de asignar el destino: el trigger
      // enforce_one_activity_per_slot rechaza el insert si el cliente sigue
      // asignado a otra actividad del mismo horario (por eso no van en paralelo)
      removeClientFromActivity(sourceActivityId, client.id)
        .then(() => assignClientToActivity(activityId, client.id))
        .catch(err => {
          console.error('Error moving client:', err)
          rollbackSlots(snapshot, snapshotKey)
        })
      return
    }

    if (activeType !== 'pool-client') return

    // Validate: client must not already be in another activity of the same time slot
    const targetSlot = timeSlots.find(s => s.id === slotId)
    if (targetSlot) {
      const alreadyInSlot = targetSlot.activities.some(a => a.clientIds.includes(client.id))
      if (alreadyInSlot) return
    }

    // Optimistic: show the chip immediately, roll back if the insert fails
    setTimeSlots(prev => prev.map(slot =>
      slot.id !== slotId ? slot : {
        ...slot,
        activities: slot.activities.map(a =>
          a.id !== activityId ? a : { ...a, clientIds: [...a.clientIds, client.id] }
        )
      }
    ))

    assignClientToActivity(activityId, client.id)
      .catch(err => {
        console.error('Error assigning client:', err)
        setTimeSlots(prev => prev.map(slot =>
          slot.id !== slotId ? slot : {
            ...slot,
            activities: slot.activities.map(a =>
              a.id !== activityId ? a : { ...a, clientIds: a.clientIds.filter(id => id !== client.id) }
            )
          }
        ))
      })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const formattedDate = format(selectedDate, "EEEE d 'de' MMMM, yyyy", { locale: es })

  // Toolbar arriba de la columna de horarios: switch de turno (izq) + agregar horario (der)
  const shiftToolbar = (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { key: 'morning', label: 'Mañana' },
          { key: 'afternoon', label: 'Tarde' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveShift(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeShift === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {!readOnly && !isWeekend && (
        <button
          onClick={handleAddSlot}
          disabled={!slotsReady || !rosterReady}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + Agregar horario
        </button>
      )}
    </div>
  )

  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Grupos del día</h1>
            <p className="text-sm text-gray-500 mt-0.5 capitalize">{formattedDate}</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setShowWeek(true)}
          >
            <Calendar className="w-4 h-4" />
            Ver semana
          </Button>
        </div>
        <div className="flex items-center gap-3">
          {!readOnly && (
            <Button
              variant="secondary"
              onClick={() => setShowTemplateModal(true)}
              disabled={!slotsReady || !rosterReady}
            >
              Plantillas
            </Button>
          )}
          {!readOnly && !isWeekend && (
            <>
              <Button
                variant="secondary"
                onClick={handleSaveReference}
                disabled={refBusy}
                title={referenceInfo.updatedAt ? `Última actualización: ${format(new Date(referenceInfo.updatedAt), "d MMM yyyy HH:mm", { locale: es })}` : 'Sin referencia guardada'}
              >
                Guardar grupo de referencia
              </Button>
              <Button
                variant="secondary"
                onClick={handleApplyReference}
                disabled={refBusy || !referenceInfo.exists || !rosterReady || !slotsReady}
              >
                Aplicar grupo de referencia
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Day navigation */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={goBack}
          disabled={!canGoBack}
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Día anterior"
        >
          <NavArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={goToday}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            isToday(selectedDate)
              ? 'bg-indigo-600 text-white'
              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Calendar className="w-4 h-4" />
          Hoy
        </button>
        <button
          onClick={goForward}
          disabled={!canGoForward}
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Día siguiente"
        >
          <NavArrowRight className="w-4 h-4" />
        </button>
        {readOnly && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg font-medium">
            Solo lectura
          </span>
        )}
        {/* Meal counts: global to the day, en un solo container con divisores */}
        {!isWeekend && (
          <div className="flex items-center ml-2 bg-white border border-gray-200 rounded-lg divide-x divide-gray-200">
            <MealCountBadge label="Desayuno" count={rosterReady ? mealCounts.breakfast : '—'} />
            <MealCountBadge label="Almuerzo" count={rosterReady ? mealCounts.lunch : '—'} />
            <MealCountBadge label="Merienda" count={rosterReady ? mealCounts.snack : '—'} />
          </div>
        )}
      </div>

      {/* Main content */}
      {isWeekend ? (
        <>
          {shiftToolbar}
          <div className="text-center py-16 text-gray-400">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-base font-medium">No hay asistentes programados para este día</p>
            <p className="text-sm mt-1">El club no opera los fines de semana</p>
          </div>
        </>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-0 min-h-[60vh]">
            {/* Time slots area: toolbar arriba + contenido */}
            <div className="flex-1 min-w-0 pr-4">
              {shiftToolbar}
              {rosterError ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-gray-500">
                  No se pudieron cargar los asistentes del día.
                  <Button variant="secondary" size="sm" onClick={retryRoster}>Reintentar</Button>
                </div>
              ) : slotsError === currentSlotsKey && !loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-gray-500">
                  No se pudieron cargar los horarios del día.
                  <Button variant="secondary" size="sm" onClick={() => loadSlots(dateStr, activeShift)}>Reintentar</Button>
                </div>
              ) : loading || !rosterReady || slotsKey !== currentSlotsKey ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
                </div>
              ) : timeSlots.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">
                  {readOnly
                    ? 'No hubo horarios programados para este día'
                    : 'No hay horarios. Agregá uno o aplicá una plantilla.'}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {displaySlots.map(slot => (
                    <TimeSlotCard
                      key={slot.id}
                      slot={slot}
                      clientsById={clientsById}
                      onRemoveClient={handleRemoveClient}
                      onUpdateSlot={handleUpdateSlot}
                      onDeleteSlot={handleDeleteSlot}
                      onAddActivity={handleAddActivity}
                      onUpdateActivity={handleUpdateActivity}
                      onDeleteActivity={handleDeleteActivity}
                      readOnly={readOnly}
                      invalidDropSlotIds={invalidDropSlotIds}
                      draggedClientId={draggedClient?.id || null}
                      recoveryIds={recoveryIds}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Client pool sidebar (sube al tope, en línea con la toolbar) */}
            <ClientPool
              loading={!rosterReady || !slotsReady}
              error={rosterError || slotsError === currentSlotsKey}
              readOnly={readOnly}
              clients={shiftClients}
              clientsInAllSlots={clientsInAllSlots}
              recoveryIds={recoveryIds}
              absentClients={dayClassified.absent}
            />
          </div>

          {/* Drag overlay */}
          <DragOverlay dropAnimation={null}>
            {draggedClient && (
              <div className="opacity-90 pointer-events-none">
                <PoolClientChip client={draggedClient} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Template modal */}
      <TemplateModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        activeShift={activeShift}
        dateStr={dateStr}
        hasExistingData={slotsReady ? timeSlots.length > 0 : true}
        onApplied={() => loadSlots(dateStr, activeShift, { silent: true })}
      />

      <GroupsWeekTable
        isOpen={showWeek}
        onClose={closeWeek}
        clients={allClients}
      />
    </div>
  )
}

// Compact counter for one of the day's meals (just the number, not the roster).
function MealCountBadge({ label, count }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-base font-semibold text-gray-900 tabular-nums">{count}</span>
    </div>
  )
}
