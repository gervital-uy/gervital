import { VAT, monthBounds, netOfGross } from './padron'
import { isDriver, providersForMonth } from './financeSeriesV2'

// Economía del transporte de un mes, por banda de distancia: lo que cobra el
// transporte (solo la línea de transporte, nunca la asistencia) contra lo que
// cuestan los choferes. Lógica pura; las lecturas están en financeQueries.js.
// month es 0-indexed.
//
// Ingreso: la línea de transporte del panel del mes (devengado), sin el 10% de IVA,
// en la banda de la ficha de cada cliente.
//
// Costo: el monto mensual de los prestadores con rol de chofer que cuentan en el
// mes (con created_at como inicio, B6). No hay costo por chofer ni pago por tramo en
// la base (B12), así que el costo del mes se reparte en partes iguales entre los
// tramos (un auto con al menos un pasajero en un turno de un día), y el de cada
// tramo en partes iguales entre sus pasajeros, cada parte a la banda del pasajero.
// Los costos del vehículo propio (categoría Vehículo) no entran.
//
// Tramos, pasajeros y asientos salen de la programación diaria (transport_*);
// los viajes, de transport_trip_counts (viajes por cliente y día, 0 a 2).

export const DISTANCE_BANDS = ['0_to_2km', '2_to_5km', '5_to_10km']
// Cliente sin distancia cargada en la ficha.
export const NO_BAND = 'none'

const num = v => (v == null || v === '' ? 0 : Number(v) || 0)

const emptyBand = band => ({
  band,
  revenueGross: 0,
  revenueNet: 0,
  clients: 0,
  riders: 0,
  trips: 0,
  passengers: 0,
  cost: 0,
  unbilledTrips: 0
})

// panel: filas de get_month_collection_panel. clients: [{ id, distanceRange }].
// cars: [{ date, shift, seatCount, clientIds }]. tripCounts: [{ clientId, date,
// tripCount }]. providers: como los lee financeQueries (con createdAt/updatedAt).
// today ('YYYY-MM-DD', opcional): marca el mes en curso, que tiene el costo y el
// ingreso del mes entero pero solo los viajes que ya pasaron.
export function buildTransportEconomics({ year, month, panel, clients, cars, tripCounts, providers, today = null }) {
  const { first, last } = monthBounds(year, month)
  const inMonth = iso => {
    const day = String(iso || '').slice(0, 10)
    return day >= first && day <= last
  }
  const bandById = new Map((clients || []).map(c => [c.id, DISTANCE_BANDS.includes(c.distanceRange) ? c.distanceRange : NO_BAND]))
  const bandOf = id => bandById.get(id) || NO_BAND
  const bands = new Map()
  const rowOf = band => {
    if (!bands.has(band)) bands.set(band, emptyBand(band))
    return bands.get(band)
  }

  // Lo que cobra cada banda.
  const billed = new Set()
  for (const p of panel || []) {
    const gross = num(p.transport_gross)
    if (gross <= 0) continue
    billed.add(p.client_id)
    const row = rowOf(bandOf(p.client_id))
    row.revenueGross += gross
    row.revenueNet += netOfGross(gross, VAT.transport)
    row.clients++
  }

  // Viajes por cliente. Quien viajó sin transporte cobrado en el mes queda marcado.
  const tripsById = new Map()
  for (const t of tripCounts || []) {
    if (!inMonth(t.date)) continue
    tripsById.set(t.clientId, (tripsById.get(t.clientId) || 0) + num(t.tripCount))
  }
  let unbilledClients = 0
  for (const [id, trips] of tripsById) {
    if (trips <= 0) continue
    const row = rowOf(bandOf(id))
    row.trips += trips
    row.riders++
    if (!billed.has(id)) {
      row.unbilledTrips += trips
      unbilledClients++
    }
  }

  // Tramos y el reparto del costo.
  const legs = (cars || []).filter(c => inMonth(c.date) && (c.clientIds || []).length > 0)
  const drivers = providersForMonth(providers, year, month).filter(isDriver)
  const driverCost = drivers.reduce((s, p) => s + num(p.monthlyAmount), 0)
  const costKnown = drivers.length > 0
  const costPerLeg = costKnown && legs.length > 0 ? driverCost / legs.length : null
  let passengers = 0
  let seats = 0
  for (const leg of legs) {
    seats += num(leg.seatCount)
    for (const id of leg.clientIds) {
      passengers++
      const row = rowOf(bandOf(id))
      row.passengers++
      if (costPerLeg != null) row.cost += costPerLeg / leg.clientIds.length
    }
  }

  const ordered = [...DISTANCE_BANDS, NO_BAND]
    .filter(b => bands.has(b))
    .map(b => {
      const row = bands.get(b)
      const cost = costKnown ? row.cost : null
      const margin = cost == null ? null : row.revenueNet - cost
      return { ...row, cost, margin, marginPct: margin != null && row.revenueNet > 0 ? (margin / row.revenueNet) * 100 : null }
    })

  const revenueGross = ordered.reduce((s, b) => s + b.revenueGross, 0)
  const revenueNet = ordered.reduce((s, b) => s + b.revenueNet, 0)
  const trips = ordered.reduce((s, b) => s + b.trips, 0)
  const days = new Set(legs.map(l => String(l.date).slice(0, 10))).size
  const margin = costKnown ? revenueNet - driverCost : null

  return {
    year,
    month,
    open: !!today && today >= first && today <= last,
    bands: ordered,
    revenueGross,
    revenueNet,
    cost: costKnown ? driverCost : null,
    margin,
    marginPct: margin != null && revenueNet > 0 ? (margin / revenueNet) * 100 : null,
    costKnown,
    drivers: drivers.map(d => ({ id: d.id, name: d.name, monthlyAmount: num(d.monthlyAmount) })),
    // Costo que no se pudo repartir: hay choferes pero no hay tramos programados.
    unallocatedCost: costKnown && legs.length === 0 ? driverCost : 0,
    legs: legs.length,
    seats,
    passengers,
    occupancyPct: seats > 0 ? (passengers / seats) * 100 : null,
    trips,
    days,
    legsPerDay: days > 0 ? legs.length / days : null,
    costPerLeg,
    costPerTrip: costKnown && trips > 0 ? driverCost / trips : null,
    billedClients: billed.size,
    riders: tripsById.size ? [...tripsById.values()].filter(n => n > 0).length : 0,
    unbilledClients,
    unbilledTrips: ordered.reduce((s, b) => s + b.unbilledTrips, 0)
  }
}
