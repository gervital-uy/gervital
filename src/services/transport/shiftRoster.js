// Reconciliación del armado de autos de un turno contra el roster del día
// (planificados sin falta + recuperos, ver attendance/dayRoster.js).
// Es la misma regla para la carga del día y para cuando cambia la asistencia con
// la pantalla abierta: quien deja de venir (falta, recupero anulado, cambio de
// plan, baja) sale del auto, y quien empieza a venir (recupero marcado, falta
// deshecha) aparece en "Sin asignar".
//
// "parked" recuerda de qué auto salió cada persona mientras el día no se guardó:
// si vuelve a venir (p. ej. se deshace la falta), vuelve a su auto y junto a sus
// vecinos de entonces en vez de caer en "Sin asignar". Es la misma idea no
// destructiva que Grupos, donde la fila de la asignación nunca se borra.
// Cada lugar es { carId, order, seq }: el orden del auto cuando salió y un número
// de salida, para que la última persona en salir sea la primera en volver.

// Inserta `id` junto al vecino anterior que siga en el auto según `order`; si no
// queda ninguno, antes del siguiente; si tampoco, al final.
function insertByNeighbours(memberIds, order, id) {
  const pos = order.indexOf(id)
  for (let i = pos - 1; i >= 0; i--) {
    const at = memberIds.indexOf(order[i])
    if (at !== -1) return [...memberIds.slice(0, at + 1), id, ...memberIds.slice(at + 1)]
  }
  for (let i = pos + 1; i < order.length; i++) {
    const at = memberIds.indexOf(order[i])
    if (at !== -1) return [...memberIds.slice(0, at), id, ...memberIds.slice(at)]
  }
  return [...memberIds, id]
}

/**
 * @param {{cars: Array<{id: string, seatCount: number, memberIds: string[]}>, unassigned: string[]}} shiftState
 * @param {string[]} rosterIds - ids presentes en el turno, en orden de roster
 * @param {Object<string, {carId: string, order: string[], seq: number}>} [parked] - salidos de un auto sin guardar
 * @returns {{state: object, parked: object, removedFromCars: string[]}} `state` y
 *   `parked` son los mismos objetos si no cambió nada
 */
export function reconcileShift(shiftState, rosterIds, parked = {}) {
  const roster = new Set(rosterIds)
  const removedFromCars = []
  const newlyParked = {}
  const seq = Object.values(parked).reduce((max, spot) => Math.max(max, spot.seq || 0), 0) + 1
  let carsChanged = false

  let cars = shiftState.cars.map(car => {
    const memberIds = car.memberIds || []
    if (memberIds.every(id => roster.has(id))) return car
    carsChanged = true
    memberIds.forEach(id => {
      if (roster.has(id)) return
      removedFromCars.push(id)
      newlyParked[id] = { carId: car.id, order: memberIds, seq }
    })
    return { ...car, memberIds: memberIds.filter(id => roster.has(id)) }
  })

  // Quien vuelve al roster y había salido de un auto vuelve a ese auto, si sigue
  // existiendo y tiene lugar. La última en salir vuelve primero.
  const assigned = new Set(cars.flatMap(c => c.memberIds || []))
  const returning = Object.entries(parked)
    .filter(([id]) => roster.has(id) && !assigned.has(id))
    .sort((a, b) => (b[1].seq || 0) - (a[1].seq || 0))
  for (const [id, spot] of returning) {
    const target = cars.find(c => c.id === spot.carId)
    if (!target || assigned.has(id)) continue
    if ((target.memberIds || []).length >= (target.seatCount ?? Infinity)) continue
    cars = cars.map(c => c === target ? { ...c, memberIds: insertByNeighbours(c.memberIds || [], spot.order || [], id) } : c)
    assigned.add(id)
    carsChanged = true
  }

  const prevUnassigned = shiftState.unassigned || []
  const kept = []
  for (const id of prevUnassigned) {
    if (roster.has(id) && !assigned.has(id) && !kept.includes(id)) kept.push(id)
  }
  const placed = new Set([...assigned, ...kept])
  const added = []
  for (const id of rosterIds) {
    if (placed.has(id)) continue
    placed.add(id)
    added.push(id)
  }
  const unassignedChanged = added.length > 0 || kept.length !== prevUnassigned.length

  // Sigue estacionado sólo quien todavía no viene; el que volvió (a su auto o a
  // "Sin asignar" porque su auto ya no está o está lleno) deja de estarlo.
  const nextParked = {}
  for (const [id, spot] of Object.entries(parked)) if (!roster.has(id)) nextParked[id] = spot
  Object.assign(nextParked, newlyParked)
  const parkedChanged = Object.keys(nextParked).length !== Object.keys(parked).length
    || Object.keys(newlyParked).length > 0

  const state = (!carsChanged && !unassignedChanged)
    ? shiftState
    : {
        ...shiftState,
        cars: carsChanged ? cars : shiftState.cars,
        unassigned: unassignedChanged ? [...kept, ...added] : prevUnassigned
      }
  return { state, parked: parkedChanged ? nextParked : parked, removedFromCars }
}

/**
 * Reconcilia todos los turnos del día. Un turno sin roster calculado se deja
 * como está (no se vacía).
 * @param {Object<string, object>} shifts - shiftId → estado del turno
 * @param {Object<string, string[]>} rosterIdsByShift - shiftId → ids presentes
 * @param {Object<string, object>} [parkedByShift] - shiftId → parked del turno
 * @returns {{shifts: object, parked: object, removedFromCars: string[]}} `shifts`
 *   y `parked` son los mismos objetos si no cambió nada; `removedFromCars` sin
 *   repetidos entre turnos
 */
export function reconcileShifts(shifts, rosterIdsByShift, parkedByShift = {}) {
  let shiftsChanged = false
  let parkedChanged = false
  const removed = new Set()
  const nextShifts = {}
  const nextParked = {}
  for (const key of Object.keys(shifts)) {
    const rosterIds = rosterIdsByShift[key]
    const prevParked = parkedByShift[key] || {}
    if (!rosterIds) {
      nextShifts[key] = shifts[key]
      if (Object.keys(prevParked).length) nextParked[key] = prevParked
      continue
    }
    const r = reconcileShift(shifts[key], rosterIds, prevParked)
    nextShifts[key] = r.state
    if (r.state !== shifts[key]) shiftsChanged = true
    if (r.parked !== prevParked) parkedChanged = true
    if (Object.keys(r.parked).length) nextParked[key] = r.parked
    r.removedFromCars.forEach(id => removed.add(id))
  }
  return {
    shifts: shiftsChanged ? nextShifts : shifts,
    parked: parkedChanged ? nextParked : parkedByShift,
    removedFromCars: [...removed]
  }
}

/** Ids estacionados en cualquier turno, sin repetidos. */
export function parkedIds(parkedByShift) {
  return [...new Set(Object.values(parkedByShift || {}).flatMap(p => Object.keys(p)))]
}

/**
 * Roster para un día PASADO: el plan de clients_full es el del mes actual, así
 * que sacar de los autos a quien hoy no está en el roster reescribiría viajes que
 * sí ocurrieron. En el histórico se conserva a quien ya figura ese día (en un auto
 * o sin asignar) salvo que tenga una falta registrada; el roster del día se suma
 * igual (recuperos). Los de un auto se conservan aunque hoy estén de baja o sin
 * transporte (su viaje ocurrió y guardar no debe borrarlo); de "sin asignar" sólo
 * los clientes conocidos, porque no se guardan y no se podrían mostrar.
 * @param {string[]} rosterIds
 * @param {{cars: Array<{memberIds: string[]}>, unassigned?: string[]}} shiftState
 * @param {Set<string>} absentIds - con record de falta ese día
 * @param {Set<string>} knownIds - clientes con transporte cargados
 * @returns {string[]}
 */
export function historicalRoster(rosterIds, shiftState, absentIds, knownIds) {
  const ids = [...rosterIds]
  const seen = new Set(ids)
  const inCars = (shiftState?.cars || []).flatMap(car => car.memberIds || [])
  const unassigned = (shiftState?.unassigned || []).filter(id => knownIds.has(id))
  for (const id of [...inCars, ...unassigned]) {
    if (seen.has(id) || absentIds.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * Saca de `parked` las entradas que ya se guardaron (mismo lugar), dejando las
 * que se estacionaron después.
 */
export function withoutParked(parkedByShift, savedByShift) {
  const next = {}
  for (const [shiftId, entries] of Object.entries(parkedByShift || {})) {
    const saved = savedByShift?.[shiftId] || {}
    const rest = {}
    for (const [id, spot] of Object.entries(entries)) if (saved[id] !== spot) rest[id] = spot
    if (Object.keys(rest).length) next[shiftId] = rest
  }
  return next
}
