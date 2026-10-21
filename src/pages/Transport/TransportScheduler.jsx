import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { format, addDays, subDays, isWeekend, nextMonday, previousFriday } from 'date-fns'
import { es } from 'date-fns/locale'
import { NavArrowLeft, NavArrowRight, Refresh, Check, Calendar } from 'iconoir-react'
import {
  getTransportClients,
  filterClientsForShift,
  shiftMatchesSchedule,
  getArrangementForDate,
  saveTransportDay,
  findLastWeekdayArrangement,
  copyArrangementFromDate,
  buildDefaultFleet
} from '../../services/transport/transportService'
import { SHIFTS, DAY_NAMES, DAY_LABELS_ES } from '../../services/transport/transportConstants'
import { getAttendanceForDate } from '../../services/api'
import { classifyDay, indexAttendanceByClientId, ABSENT_STATUSES, RECOVERY_STATUS } from '../../services/attendance/dayRoster'
import { reconcileShifts, parkedIds, historicalRoster, withoutParked } from '../../services/transport/shiftRoster'
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus'
import { todayStr } from '../../utils/date'
import TransportMap from './TransportMap'
import CarAssignmentPanel from './CarAssignmentPanel'
import TransportWeekTable from './TransportWeekTable'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Toggle from '../../components/ui/Toggle'

function getDateStr(date) {
  return format(date, 'yyyy-MM-dd')
}

function skipWeekend(date, direction) {
  const next = direction === 'next' ? addDays(date, 1) : subDays(date, 1)
  if (isWeekend(next)) {
    return direction === 'next' ? nextMonday(next) : previousFriday(next)
  }
  return next
}

// Roster de cada turno para reconciliar los autos. En días pasados se conserva a
// quien ya figura ese día y no tiene falta registrada (ver historicalRoster),
// salvo con `historical: false`: un armado copiado de otra fecha ('Repetir') no
// es historia de este día.
function buildRoster(clients, dName, attMap, dStr, shiftsState, { historical = true } = {}) {
  const isPast = historical && dStr < todayStr()
  const absentIds = new Set()
  if (isPast) attMap.forEach((rec, id) => { if (ABSENT_STATUSES.includes(rec.status)) absentIds.add(id) })
  const knownIds = new Set(clients.map(c => c.id))
  const roster = {}
  for (const shift of SHIFTS) {
    const ids = filterClientsForShift(clients, shift.id, dName, attMap).map(c => c.id)
    roster[shift.id] = isPast ? historicalRoster(ids, shiftsState?.[shift.id], absentIds, knownIds) : ids
  }
  return roster
}

function buildEmptyShifts() {
  return {
    morning_arrive: { cars: buildDefaultFleet(), unassigned: [] },
    morning_leave: { cars: buildDefaultFleet(), unassigned: [] },
    afternoon_arrive: { cars: buildDefaultFleet(), unassigned: [] },
    afternoon_leave: { cars: buildDefaultFleet(), unassigned: [] }
  }
}

export default function TransportScheduler() {
  const [currentDate, setCurrentDate] = useState(() => {
    const today = new Date()
    return isWeekend(today) ? nextMonday(today) : today
  })
  const [activeShift, setActiveShift] = useState('morning_arrive')
  // Estado del día en un solo objeto para actualizarlo de forma atómica:
  // - shifts: autos y "sin asignar" de cada turno
  // - parked: quienes salieron de un auto porque dejaron de venir, con su lugar,
  //   mientras el día no se guardó (shiftId → clientId → lugar). Si vuelven a
  //   venir, vuelven a su auto.
  // - userEdits / savedEdits: contador de ediciones del usuario (DnD, autos,
  //   'Repetir') y cuántas ya se guardaron.
  const [day, setDay] = useState(() => ({ shifts: buildEmptyShifts(), parked: {}, userEdits: 0, savedEdits: 0 }))
  const { shifts, parked } = day
  const userDirty = day.userEdits !== day.savedEdits
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [allClients, setAllClients] = useState([])
  const [attendanceByClientId, setAttendanceByClientId] = useState(new Map())
  const [lastWeekdayAvailable, setLastWeekdayAvailable] = useState(false)
  const [showRepeatConfirm, setShowRepeatConfirm] = useState(false)
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(null)
  const [showSaveWarning, setShowSaveWarning] = useState(false)
  const [showWeek, setShowWeek] = useState(false)
  const [showAbsences, setShowAbsences] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  // Fecha cuyo armado está cargado en `day` (null mientras carga otra)
  const [loadedDateStr, setLoadedDateStr] = useState(null)

  const dateStr = getDateStr(currentDate)
  const isPastDay = dateStr < todayStr()
  // Quien salió de un auto en hoy o un día futuro deja la base desactualizada:
  // hay que guardar. En días pasados no, para no reescribir la historia.
  // Los que salieron de un armado copiado con 'Repetir' nunca estuvieron en la
  // base para este día: se recuerdan para devolverlos, pero no se avisan.
  const removedPending = useMemo(() => {
    if (isPastDay || loadedDateStr !== dateStr) return []
    const fromSaved = {}
    for (const [shiftId, entries] of Object.entries(parked)) {
      const kept = Object.fromEntries(Object.entries(entries).filter(([, spot]) => !spot.fromCopy))
      if (Object.keys(kept).length) fromSaved[shiftId] = kept
    }
    return parkedIds(fromSaved)
  }, [isPastDay, loadedDateStr, dateStr, parked])
  const isDirty = userDirty || removedPending.length > 0

  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const dayName = DAY_NAMES[currentDate.getDay()]
  const dayLabelEs = DAY_LABELS_ES[dayName] || dayName

  const clientsById = useMemo(() => {
    const map = new Map()
    allClients.forEach(c => map.set(c.id, c))
    return map
  }, [allClients])

  const shiftClassified = useMemo(() => {
    const matchesShift = c => shiftMatchesSchedule(activeShift, c.plan?.schedule)
    return classifyDay({ clients: allClients, dayName, matchesShift, attendanceByClientId })
  }, [allClients, activeShift, dayName, attendanceByClientId])

  const shiftClients = shiftClassified.present

  const recoveryIds = useMemo(() => {
    const ids = new Set()
    attendanceByClientId.forEach((rec, id) => { if (rec.status === RECOVERY_STATUS) ids.add(id) })
    return ids
  }, [attendanceByClientId])

  // Roster de cada turno del día: planificados sin falta + recuperos
  const rosterIdsByShift = useMemo(() => {
    const byShift = {}
    SHIFTS.forEach(s => {
      byShift[s.id] = filterClientsForShift(allClients, s.id, dayName, attendanceByClientId).map(c => c.id)
    })
    return byShift
  }, [allClients, dayName, attendanceByClientId])

  const totalDayClients = useMemo(
    () => new Set(Object.values(rosterIdsByShift).flat()).size,
    [rosterIdsByShift]
  )

  const shiftCounts = useMemo(() => {
    const counts = {}
    SHIFTS.forEach(s => { counts[s.id] = rosterIdsByShift[s.id].length })
    return counts
  }, [rosterIdsByShift])

  // A shift is "complete" when it has attendees and none are left unassigned
  const shiftComplete = useMemo(() => {
    const complete = {}
    SHIFTS.forEach(s => {
      const count = shiftCounts[s.id] || 0
      const unassigned = shifts[s.id]?.unassigned?.length ?? 0
      complete[s.id] = count > 0 && unassigned === 0
    })
    return complete
  }, [shiftCounts, shifts])

  // ── Load data ─────────────────────────────────────────────────────────────

  // Al navegar rápido entre días, una respuesta vieja puede llegar después de la
  // nueva: sólo se aplica la del último pedido.
  const dayRequestRef = useRef(0)
  const loadDay = useCallback(async (date) => {
    const requestId = ++dayRequestRef.current
    setLoading(true)
    setError(null)
    setLoadedDateStr(null)
    setDay(prev => ({ ...prev, parked: {}, userEdits: 0, savedEdits: 0 }))
    try {
      const dStr = getDateStr(date)
      const dName = DAY_NAMES[date.getDay()]

      const [clients, arrangement, lastWeekday, attendance] = await Promise.all([
        getTransportClients(),
        getArrangementForDate(dStr),
        findLastWeekdayArrangement(dStr),
        getAttendanceForDate(dStr)
      ])
      if (requestId !== dayRequestRef.current) return

      const attMap = indexAttendanceByClientId(attendance)

      // Lo guardado (o la flota por defecto) contra el roster del día: quien
      // dejó de venir sale del auto y quien viene sin auto queda sin asignar.
      const saved = {}
      for (const shift of SHIFTS) {
        saved[shift.id] = arrangement
          ? { cars: (arrangement.shifts[shift.id] || { cars: [] }).cars, unassigned: [] }
          : { cars: buildDefaultFleet(), unassigned: [] }
      }
      const roster = buildRoster(clients, dName, attMap, dStr, saved)
      const { shifts: reconciled, parked: removed } = reconcileShifts(saved, roster)

      setAllClients(clients)
      setAttendanceByClientId(attMap)
      setLastWeekdayAvailable(!!lastWeekday)
      setDay({ shifts: reconciled, parked: removed, userEdits: 0, savedEdits: 0 })
      setLoadedDateStr(dStr)
    } catch (err) {
      if (requestId !== dayRequestRef.current) return
      console.error('Error loading transport day:', err)
      setError('Error al cargar los datos de transporte')
    } finally {
      if (requestId === dayRequestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDay(currentDate)
  }, [currentDate, loadDay])

  // Faltas y recuperos se cargan desde la ficha del cliente: al volver a esta
  // pestaña se refrescan clientes y asistencia del día, sin tocar el armado.
  // El efecto de abajo se encarga de sacar o sumar gente en los autos.
  // Sólo se aplica la respuesta del último refresco, y nunca si mientras tanto
  // arrancó la carga de otro día.
  const loadedDateRef = useRef(loadedDateStr)
  loadedDateRef.current = loadedDateStr
  const refreshRequestRef = useRef(0)
  const refreshAppliedRef = useRef(0)
  useRefreshOnFocus(async () => {
    const dStr = loadedDateRef.current
    if (!dStr) return
    const requestId = ++refreshRequestRef.current
    const dayRequest = dayRequestRef.current
    try {
      const [clients, attendance] = await Promise.all([getTransportClients(), getAttendanceForDate(dStr)])
      // Se aplica si es más nueva que la última aplicada (una buena no se
      // descarta porque haya salido otro refresco después, que puede fallar).
      if (requestId < refreshAppliedRef.current || dayRequest !== dayRequestRef.current) return
      refreshAppliedRef.current = requestId
      setAllClients(clients)
      setAttendanceByClientId(indexAttendanceByClientId(attendance))
    } catch (err) {
      console.error('Error refreshing transport roster:', err)
    }
  })

  // Con el día ya cargado, cualquier cambio del roster (falta, recupero marcado
  // o anulado, cambio de plan, baja) se refleja en los autos al instante; quien
  // vuelve a venir vuelve a su auto. Trabaja sobre el estado previo (updater),
  // así nunca pisa un movimiento de DnD encolado.
  useEffect(() => {
    if (loading || loadedDateStr !== dateStr) return
    setDay(prev => {
      const roster = buildRoster(allClients, dayName, attendanceByClientId, dateStr, prev.shifts)
      const next = reconcileShifts(prev.shifts, roster, prev.parked)
      if (next.shifts === prev.shifts && next.parked === prev.parked) return prev
      return { ...prev, shifts: next.shifts, parked: next.parked }
    })
  }, [loading, loadedDateStr, dateStr, dayName, allClients, attendanceByClientId])

  // ── Navigation ────────────────────────────────────────────────────────────

  function navigateDay(direction) {
    const target = skipWeekend(currentDate, direction)
    if (isDirty) {
      setShowUnsavedConfirm(target)
    } else {
      setCurrentDate(target)
    }
  }

  function confirmNavigate() {
    const target = showUnsavedConfirm
    setShowUnsavedConfirm(null)
    setDay(prev => ({ ...prev, parked: {}, userEdits: 0, savedEdits: 0 }))
    setCurrentDate(target)
  }

  // ── Shift state change (ref to avoid stale closure during DnD) ─────────

  const activeShiftRef = useRef(activeShift)
  activeShiftRef.current = activeShift

  const handleShiftStateChange = useCallback((updater) => {
    setDay(prev => {
      const activeKey = activeShiftRef.current
      const newShiftState = typeof updater === 'function'
        ? updater(prev.shifts[activeKey])
        : updater
      return { ...prev, shifts: { ...prev.shifts, [activeKey]: newShiftState }, userEdits: prev.userEdits + 1 }
    })
  }, [])

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    const totalUnassigned = Object.values(shifts).reduce((sum, s) => sum + s.unassigned.length, 0)
    if (totalUnassigned > 0) {
      setShowSaveWarning(true)
      return
    }
    await doSave()
  }

  async function doSave() {
    setShowSaveWarning(false)
    setSaving(true)
    // Foto de lo que se guarda: al volver sólo se limpia eso. Lo que cambió
    // mientras tanto (un DnD, alguien que salió por un refresco) sigue pendiente,
    // y si se navegó a otro día no se toca nada.
    const saved = day
    const requestId = dayRequestRef.current
    try {
      await saveTransportDay(dateStr, saved.shifts)
      if (requestId === dayRequestRef.current) {
        // Si los autos cambiaron durante el guardado (un DnD o alguien que volvió
        // por un refresco), la pantalla ya no es lo guardado: sigue pendiente.
        setDay(prev => ({
          ...prev,
          parked: withoutParked(prev.parked, saved.parked),
          savedEdits: saved.userEdits,
          userEdits: prev.shifts === saved.shifts ? prev.userEdits : Math.max(prev.userEdits, saved.userEdits + 1)
        }))
      }
      setToast({ type: 'success', message: `Transporte del ${format(currentDate, "d 'de' MMMM", { locale: es })} guardado` })
      setTimeout(() => setToast(null), 3000)
    } catch (err) {
      console.error('Error saving transport day:', err)
      setToast({ type: 'error', message: 'Error al guardar. Intentá nuevamente.' })
      setTimeout(() => setToast(null), 5000)
    } finally {
      setSaving(false)
    }
  }

  // ── Repeat last weekday ───────────────────────────────────────────────────

  async function handleRepeatLastWeekday() {
    setShowRepeatConfirm(true)
  }

  async function confirmRepeat() {
    setShowRepeatConfirm(false)
    // Atado al día cargado: si mientras tanto se navega a otro día, se descarta.
    const requestId = dayRequestRef.current
    setLoading(true)
    try {
      const lastArrangement = await findLastWeekdayArrangement(dateStr)
      if (!lastArrangement || requestId !== dayRequestRef.current) return

      const sourceData = await copyArrangementFromDate(lastArrangement.date)
      if (!sourceData || requestId !== dayRequestRef.current) return

      // Se copian los autos del último mismo día de la semana y se ajustan al
      // roster de este día (no se copian ausentes ni recuperos de aquel día; si
      // después vuelven a venir, vuelven al auto copiado).
      const copied = {}
      for (const shift of SHIFTS) {
        const savedShift = sourceData.shifts[shift.id] || { cars: [] }
        copied[shift.id] = {
          cars: savedShift.cars.map(car => ({
            ...car,
            id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
          })),
          unassigned: []
        }
      }
      const roster = buildRoster(allClients, dayName, attendanceByClientId, dateStr, copied, { historical: false })
      const r = reconcileShifts(copied, roster)
      const parkedFromCopy = {}
      for (const [shiftId, entries] of Object.entries(r.parked)) {
        parkedFromCopy[shiftId] = Object.fromEntries(Object.entries(entries).map(([id, spot]) => [id, { ...spot, fromCopy: true }]))
      }
      setDay(prev => ({ ...prev, shifts: r.shifts, parked: parkedFromCopy, userEdits: prev.userEdits + 1 }))
    } catch (err) {
      console.error('Error repeating arrangement:', err)
    } finally {
      if (requestId === dayRequestRef.current) setLoading(false)
    }
  }

  // Estable: el modal semanal resetea su búsqueda cuando cambia onClose, y el
  // refresco por foco re-renderiza esta pantalla con el modal abierto.
  const closeWeek = useCallback(() => setShowWeek(false), [])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateDay('prev')}
            className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <NavArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base font-bold text-gray-900 capitalize">
              {format(currentDate, "EEEE d 'de' MMMM, yyyy", { locale: es })}
            </h1>
            <p className="text-xs text-gray-500">
              {totalDayClients} asistente{totalDayClients !== 1 ? 's' : ''} con transporte
            </p>
          </div>
          <button
            onClick={() => navigateDay('next')}
            className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <NavArrowRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRepeatLastWeekday}
            disabled={!lastWeekdayAvailable || loading || loadedDateStr !== dateStr}
            title={lastWeekdayAvailable ? undefined : `No hay datos previos para ${dayLabelEs}`}
          >
            <Refresh className="w-4 h-4" />
            Repetir último {dayLabelEs}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            loading={saving}
            disabled={loading || !isDirty || loadedDateStr !== dateStr}
          >
            Guardar día
          </Button>
        </div>
      </div>

      {/* Shift Tabs */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        <div className="flex">
        {SHIFTS.map(shift => {
          const complete = shiftComplete[shift.id]
          return (
            <button
              key={shift.id}
              onClick={() => setActiveShift(shift.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeShift === shift.id
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {shift.label} · {shift.time}
              <span className={`ml-2 inline-flex items-center gap-0.5 justify-center px-1.5 py-0.5 text-xs rounded-full ${
                complete
                  ? 'bg-green-100 text-green-700'
                  : activeShift === shift.id
                    ? 'bg-indigo-100 text-indigo-600'
                    : 'bg-gray-100 text-gray-500'
              }`}>
                {shiftCounts[shift.id] || 0}
                {complete && <Check className="w-3 h-3" strokeWidth={2.5} />}
              </span>
            </button>
          )
        })}
        </div>

        <div className="flex items-center gap-4">
          <Toggle
            id="toggle-absences-transport"
            checked={showAbsences}
            onChange={setShowAbsences}
            label="Mostrar faltas"
          />
          <button
            onClick={() => setShowWeek(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
          >
            <Calendar className="w-4 h-4" />
            Ver semana
          </button>
        </div>
      </div>

      {/* Quienes salieron de un auto por dejar de venir: falta guardar el día */}
      {removedPending.length > 0 && !loading && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 lg:px-8 py-2 text-sm text-amber-800">
          {(() => {
            const n = removedPending.length
            const names = removedPending.map(id => clientsById.get(id)).filter(Boolean).map(c => `${c.firstName} ${c.lastName}`)
            const who = names.length === n ? names.join(', ') : `${n} persona${n !== 1 ? 's' : ''}`
            return `${who} ${n !== 1 ? 'salieron' : 'salió'} de un auto porque ya no viaja${n !== 1 ? 'n' : ''} en ese turno (falta, recupero anulado o cambio de plan). Guardá el día para que quede registrado.`
          })()}
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
          <p className="text-sm">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => { setError(null); loadDay(currentDate) }}>
            Reintentar
          </Button>
        </div>
      ) : shiftClients.length === 0 && !(showAbsences && shiftClassified.absent.length > 0) ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          No hay asistentes con transporte para este turno
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <TransportMap
            shiftClients={shiftClients}
            shiftState={shifts[activeShift]}
          />
          <CarAssignmentPanel
            shiftState={shifts[activeShift]}
            onStateChange={handleShiftStateChange}
            clientsById={clientsById}
            recoveryIds={recoveryIds}
            absentClients={shiftClassified.absent}
            showAbsences={showAbsences}
          />
        </div>
      )}

      {/* Unsaved changes modal */}
      <Modal isOpen={!!showUnsavedConfirm} onClose={() => setShowUnsavedConfirm(null)} title="Cambios sin guardar" size="sm">
        <p className="text-gray-600 mb-6">Tenés cambios sin guardar. ¿Querés descartarlos?</p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setShowUnsavedConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={confirmNavigate}>Descartar</Button>
        </div>
      </Modal>

      {/* Repeat confirm modal */}
      <Modal isOpen={showRepeatConfirm} onClose={() => setShowRepeatConfirm(false)} title="Repetir configuración" size="sm">
        <p className="text-gray-600 mb-6">
          Esto reemplazará la configuración actual de todos los turnos del día. ¿Continuar?
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setShowRepeatConfirm(false)}>Cancelar</Button>
          <Button onClick={confirmRepeat}>Confirmar</Button>
        </div>
      </Modal>

      {/* Weekly overview */}
      <TransportWeekTable
        isOpen={showWeek}
        onClose={closeWeek}
        clients={allClients}
      />

      {/* Save with unassigned warning */}
      <Modal isOpen={showSaveWarning} onClose={() => setShowSaveWarning(false)} title="Asistentes sin asignar" size="sm">
        <p className="text-gray-600 mb-6">
          Hay asistentes sin asignar a un auto. ¿Guardar de todos modos?
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setShowSaveWarning(false)}>Cancelar</Button>
          <Button onClick={doSave}>Guardar</Button>
        </div>
      </Modal>
    </div>
  )
}
