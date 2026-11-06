import {
  isCommercialClient, cleanPeriods, clientStretches, buildTimeline, monthRange, shiftMonth, churnWindow,
  monthChurn, tenureStats, flowSeries, sameMonthSeries, exitsByReason, cohortRetention, monthIndexOf, occupantsOn,
  ENTRY_INHERITED, ENTRY_NEW, ENTRY_RETURN
} from './activityTimeline'

const TODAY = '2026-11-06'

const client = (id, over = {}) => ({
  id,
  firstName: id.toUpperCase(),
  lastName: 'X',
  clientType: 'regular',
  startDate: '2026-06-01',
  deactivationDate: null,
  trialStartedAt: null,
  trialConvertedAt: null,
  ...over
})
const period = (clientId, fromDate, toDate = null, reason = 'other') => ({ clientId, fromDate, toDate, reason })

// Jun–nov 2026, con todo lo que la línea de tiempo tiene que resolver:
//   h1  heredado que sigue
//   h2  heredado que se va en junio
//   h3  heredado en pausa temporal (jun→sep), reingresa y se va de nuevo en noviembre
//   n1  alta de julio
//   n2  alta de agosto, con una baja deshecha al día siguiente y dos bajas superpuestas en octubre
//   f1  alta programada para después de hoy
//   f2  heredado con una baja programada para después de hoy
//   t1  vino a prueba y no se quedó (sigue como trial)
//   t2  regular que se dio de baja en la prueba, antes de convertirse
//   c1  sin cargo (charity)
const SOURCES = {
  clients: [
    client('h1'),
    client('h2', { deactivationDate: '2026-06-10' }),
    client('h3', { deactivationDate: '2026-11-02' }),
    client('n1', { startDate: '2026-07-15' }),
    client('n2', { startDate: '2026-08-05', deactivationDate: '2026-10-07' }),
    client('f1', { startDate: '2026-11-20' }),
    client('f2', { deactivationDate: '2026-11-25' }),
    client('t1', { clientType: 'trial', startDate: '2026-08-10', deactivationDate: '2026-08-15', trialStartedAt: '2026-08-10' }),
    client('t2', { startDate: '2026-09-01', deactivationDate: '2026-09-10', trialStartedAt: '2026-09-01' }),
    client('c1', { clientType: 'charity', startDate: '2026-07-01' })
  ],
  periods: [
    period('h2', '2026-06-10', null, 'health_decline'),
    period('h3', '2026-06-26', '2026-09-29', 'other'),
    period('h3', '2026-11-02', null, 'transient'),
    period('n2', '2026-08-20', '2026-08-21', 'other'),
    period('n2', '2026-10-07', '2026-10-08', 'adaptation_motivation'),
    period('n2', '2026-10-07', null, 'logistical_family'),
    period('f2', '2026-11-25', null, 'financial'),
    period('t1', '2026-08-15', null, 'adaptation_motivation'),
    period('t2', '2026-09-10', null, 'adaptation_motivation')
  ],
  followups: [
    { clientId: 'h3', stage: 'temporary_pause', deactivationDate: '2026-06-26' },
    { clientId: 'h2', stage: 'lost', deactivationDate: '2026-06-10' }
  ]
}

const REASONS = [
  { key: 'health_decline', label: 'Deterioro de salud', color: '#dc2626', sortOrder: 3 },
  { key: 'other', label: 'Otro / sin especificar', color: '#94a3b8', sortOrder: 8 },
  { key: 'logistical_family', label: 'Motivo logístico-familiar', color: '#0891b2', sortOrder: 6 }
]

const timeline = buildTimeline(SOURCES, { today: TODAY })
const counts = timeline.months.map(m => m.counts)
const ids = refs => refs.map(r => r.person.id).sort()

describe('la cartera', () => {
  test('solo regulares; quien no se quedó tras la prueba no cuenta', () => {
    expect(isCommercialClient(client('a'))).toBe(true)
    expect(isCommercialClient(client('a', { clientType: 'trial' }))).toBe(false)
    expect(isCommercialClient(client('a', { clientType: 'charity' }))).toBe(false)
    // Baja durante la prueba (se convirtió después de la baja, o nunca)
    expect(isCommercialClient(client('a', { trialStartedAt: '2026-09-01', deactivationDate: '2026-09-10' }))).toBe(false)
    expect(isCommercialClient(client('a', { trialStartedAt: '2026-09-01', trialConvertedAt: '2026-09-12', deactivationDate: '2026-09-10' }))).toBe(false)
    // Se convirtió y después se fue: es una baja de la cartera
    expect(isCommercialClient(client('a', { trialStartedAt: '2026-09-01', trialConvertedAt: '2026-09-05', deactivationDate: '2026-10-01' }))).toBe(true)
    expect(timeline.people.map(p => p.id).sort()).toEqual(['f1', 'f2', 'h1', 'h2', 'h3', 'n1', 'n2'])
  })
})

describe('cleanPeriods', () => {
  test('descarta las reversiones de un día y une los superpuestos', () => {
    expect(cleanPeriods([
      { fromDate: '2026-10-07', toDate: '2026-10-08', reason: 'a' },
      { fromDate: '2026-10-07', toDate: null, reason: 'b' }
    ])).toEqual([{ fromDate: '2026-10-07', toDate: null, reason: 'b' }])
    expect(cleanPeriods([{ fromDate: '2026-08-27', toDate: '2026-08-28', reason: 'other' }])).toEqual([])
    // Fechas al revés: dato roto, se descarta
    expect(cleanPeriods([{ fromDate: '2026-08-27', toDate: '2026-08-20' }])).toEqual([])
  })

  test('une los que se tocan y conserva el motivo del que abre la baja', () => {
    expect(cleanPeriods([
      { fromDate: '2026-09-10', toDate: '2026-10-01', reason: 'b' },
      { fromDate: '2026-08-01', toDate: '2026-09-10', reason: 'a' },
      { fromDate: '2026-09-20', toDate: '2026-09-25', reason: 'c' }
    ])).toEqual([{ fromDate: '2026-08-01', toDate: '2026-10-01', reason: 'a' }])
    // A igual inicio gana el que dura más (abierto = el más largo)
    expect(cleanPeriods([
      { fromDate: '2026-08-01', toDate: '2026-08-20', reason: 'corto' },
      { fromDate: '2026-08-01', toDate: '2026-09-20', reason: 'largo' }
    ])).toEqual([{ fromDate: '2026-08-01', toDate: '2026-09-20', reason: 'largo' }])
    // Separados por al menos un día activo: dos bajas
    expect(cleanPeriods([
      { fromDate: '2026-08-01', toDate: '2026-08-10', reason: 'a' },
      { fromDate: '2026-08-11', toDate: null, reason: 'b' }
    ])).toHaveLength(2)
  })
})

describe('clientStretches', () => {
  test('un heredado sin bajas es un solo tramo abierto', () => {
    expect(clientStretches(client('a'), [])).toEqual([{ from: '2026-06-01', to: null, entry: ENTRY_INHERITED, exit: null }])
  })

  test('baja, reingreso y la pausa como etiqueta de la baja que la contiene', () => {
    const s = clientStretches(client('a'), [period('a', '2026-06-26', '2026-09-29', 'other'), period('a', '2026-11-02', null, 'x')], ['2026-07-01'])
    expect(s).toEqual([
      { from: '2026-06-01', to: '2026-06-26', entry: ENTRY_INHERITED, exit: { date: '2026-06-26', reason: 'other', pause: true } },
      { from: '2026-09-29', to: '2026-11-02', entry: ENTRY_RETURN, exit: { date: '2026-11-02', reason: 'x', pause: false } }
    ])
  })

  test('un alta registrada no es heredada; un período que tapa el inicio corre la primera alta', () => {
    expect(clientStretches(client('a', { startDate: '2026-08-04' }), [])[0].entry).toBe(ENTRY_NEW)
    const s = clientStretches(client('a'), [period('a', '2026-05-20', '2026-07-01')])
    expect(s).toEqual([{ from: '2026-07-01', to: null, entry: ENTRY_NEW, exit: null }])
    // Una baja anterior al inicio no toca nada; una abierta desde antes, deja sin tramos
    expect(clientStretches(client('a', { startDate: '2026-08-04' }), [period('a', '2026-07-31', '2026-08-03')])).toHaveLength(1)
    expect(clientStretches(client('a', { startDate: '2026-08-13' }), [period('a', '2026-08-10')])).toEqual([])
    expect(clientStretches(client('a', { startDate: null }), [])).toEqual([])
  })

  test('sin motivo, la baja queda como "other"', () => {
    expect(clientStretches(client('a'), [{ fromDate: '2026-07-01', toDate: null, reason: null }])[0].exit.reason).toBe('other')
  })
})

describe('quién ocupa un lugar', () => {
  test('además de la cartera, los no facturables y los que están a prueba', () => {
    // 12 de agosto: t1 está a prueba y c1 es sin cargo; ninguno es de la cartera
    expect(occupantsOn(timeline.occupants, '2026-08-12').map(o => o.id).sort()).toEqual(['c1', 'f2', 'h1', 'n1', 'n2', 't1'])
    expect(ids(timeline.months[2].active)).not.toContain('t1')
    // Las bajas y reingresos salen de los mismos períodos: h3 vuelve el 29 de septiembre
    expect(occupantsOn(timeline.occupants, '2026-09-29').map(o => o.id)).toContain('h3')
    expect(occupantsOn(timeline.occupants, '2026-08-16').map(o => o.id)).not.toContain('t1')
  })

  test('la prueba de quien se quedó ocupa antes de su fecha de ingreso', () => {
    const v1 = client('v1', { startDate: '2026-10-01', trialStartedAt: '2026-09-21', trialConvertedAt: '2026-09-30' })
    const t = buildTimeline({ clients: [v1], periods: [], followups: [] }, { today: TODAY })
    // La cartera lo cuenta desde octubre; el lugar lo ocupa desde la prueba
    expect(t.months[3].counts.closing).toBe(0)
    expect(occupantsOn(t.occupants, '2026-09-30').map(o => o.id)).toEqual(['v1'])
    expect(occupantsOn(t.occupants, '2026-09-20')).toEqual([])
  })
})

describe('meses', () => {
  test('del lanzamiento al mes de hoy', () => {
    expect(monthRange('2026-11-06')).toHaveLength(6)
    expect(monthRange('2027-01-02').slice(-2)).toEqual([{ year: 2026, month: 11 }, { year: 2027, month: 0 }])
    expect(monthRange('2026-05-30')).toEqual([])
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
    expect(monthIndexOf(timeline, 2026, 9)).toBe(4)
    expect(monthIndexOf(timeline, 2026, 0)).toBe(-1)
  })

  test('base inicial + altas − bajas = activos, todos los meses', () => {
    expect(counts.map(c => [c.opening, c.altas, c.bajas, c.closing])).toEqual([
      [4, 0, 2, 2], // jun: los heredados son la base, no altas
      [2, 1, 0, 3], // jul: alta de n1
      [3, 1, 0, 4], // ago: alta de n2 (su baja deshecha al día siguiente no cuenta)
      [4, 1, 0, 5], // sep: el reingreso de h3 es un alta; t2 no se quedó tras la prueba
      [5, 0, 1, 4], // oct: las dos bajas superpuestas de n2 son una
      [4, 0, 1, 3] //  nov (hasta hoy): baja de h3; lo programado no cuenta
    ])
    for (const c of counts) expect(c.opening + c.altas - c.bajas).toBe(c.closing)
  })

  test('detalle de altas, reingresos, heredados y pausas', () => {
    expect(counts[0]).toMatchObject({ inherited: 4, pauses: 1 })
    expect(counts[3]).toMatchObject({ newAltas: 0, returns: 1 })
    expect(counts[1]).toMatchObject({ newAltas: 1, returns: 0, inherited: 0 })
    expect(ids(timeline.months[0].exits)).toEqual(['h2', 'h3'])
    expect(ids(timeline.months[5].active)).toEqual(['f2', 'h1', 'n1'])
  })

  test('el mes en curso se corta en hoy; los cerrados, en su último día', () => {
    expect(timeline.months[5]).toMatchObject({ cut: TODAY, partial: true })
    expect(timeline.months[4]).toMatchObject({ cut: '2026-10-31', partial: false })
    // Cuando llega el día, lo programado entra
    const later = buildTimeline(SOURCES, { today: '2026-11-30' }).months[5].counts
    expect(later).toMatchObject({ altas: 1, bajas: 2, closing: 3 })
  })
})

describe('churn, permanencia y flujo', () => {
  test('churn del mes y de la ventana, recortada al lanzamiento', () => {
    expect(monthChurn(timeline.months[0])).toBeCloseTo(50)
    const w = churnWindow(timeline.months, 5, 12)
    expect(w).toMatchObject({ months: 6, bajas: 4, prev: null, delta: null })
    expect(w.baseMedia).toBeCloseTo(21 / 6)
    expect(w.churn).toBeCloseTo((4 / 3.5) * 100)
    // Con una ventana corta, la anterior del mismo largo ya entra entera
    const short = churnWindow(timeline.months, 5, 3)
    expect(short).toMatchObject({ months: 3, bajas: 2 })
    // jun–ago: las dos bajas de junio sobre (2 + 3 + 4) / 3
    expect(short.prev.bajas).toBe(2)
    expect(short.prev.churn).toBeCloseTo((2 / 3) * 100)
    expect(short.delta).toBeCloseTo(short.churn - short.prev.churn)
    expect(monthChurn({ counts: { opening: 0, bajas: 0 } })).toBeNull()
  })

  test('el promedio de bajas por mes usa solo los meses cerrados', () => {
    // Jun–oct cerrados con 3 bajas; noviembre (en curso) no entra al promedio
    expect(churnWindow(timeline.months, 5, 12)).toMatchObject({ avgMonths: 5, avgBajas: 3 / 5 })
    // En un mes cerrado, el mes entra en su propio promedio
    expect(churnWindow(timeline.months, 4, 12)).toMatchObject({ avgMonths: 5, avgBajas: 3 / 5 })
    // Con solo el mes en curso no hay promedio
    expect(churnWindow(timeline.months.slice(5), 0, 12)).toMatchObject({ avgMonths: 0, avgBajas: null })
  })

  test('permanencia desde la última alta; los heredados aparte', () => {
    const t = tenureStats(timeline, 5)
    // n1: 15-jul → 6-nov = 115 días
    expect(t).toMatchObject({ measured: 1, inherited: 2 })
    expect(t.avgMonths).toBeCloseTo(115 / 30.4375)
    // Vida de los tramos cerrados con alta registrada: n2 (5-ago → 7-oct) y el reingreso de h3 (29-sep → 2-nov)
    expect(t.closedMeasured).toBe(2)
    expect(t.closedAvgMonths).toBeCloseTo(((63 + 34) / 2) / 30.4375)
    expect(tenureStats(timeline, 0)).toMatchObject({ measured: 0, avgMonths: null, closedAvgMonths: null })
  })

  test('altas contra bajas, y el mismo mes en cada año con el centro operando', () => {
    const flow = flowSeries(timeline.months, 5, 4)
    expect(flow.map(f => [f.month, f.altas, f.bajas, f.net, f.closing])).toEqual([[7, 1, 0, 1, 4], [8, 1, 0, 1, 5], [9, 0, 1, -1, 4], [10, 0, 1, -1, 3]])
    expect(flowSeries(timeline.months, 1, 12)).toHaveLength(2)
    expect(sameMonthSeries(timeline.months, 9, 5).map(f => f.year)).toEqual([2026])
    expect(sameMonthSeries(timeline.months, 2, 5)).toEqual([])
  })
})

describe('bajas por motivo', () => {
  test('con los nombres del catálogo, la pausa contada y la ventana anterior', () => {
    const all = exitsByReason(timeline.months, 5, null, REASONS)
    expect(all).toMatchObject({ months: 6, requested: null, total: 4, pauses: 1, prev: null })
    expect(all.rows.map(r => [r.key, r.label, r.value, r.pauses])).toEqual([
      ['health_decline', 'Deterioro de salud', 1, 0],
      ['logistical_family', 'Motivo logístico-familiar', 1, 0],
      ['other', 'Otro / sin especificar', 1, 1],
      // Un motivo que ya no está en el catálogo se muestra con su clave
      ['transient', 'transient', 1, 0]
    ])
    const last3 = exitsByReason(timeline.months, 5, 3, REASONS)
    expect(last3.total).toBe(2)
    expect(last3.prev.map(r => r.key)).toEqual(['health_decline', 'other'])
    expect(exitsByReason(timeline.months, 5, 6, REASONS).prev).toBeNull()
  })
})

describe('cohortes', () => {
  test('por mes: cada tramo en la cohorte de su alta', () => {
    const c = cohortRetention(timeline, 5, 'month')
    expect(c.rows.map(r => [r.key, r.size])).toEqual([['2026-06', 0], ['2026-07', 1], ['2026-08', 1], ['2026-09', 1], ['2026-10', 0], ['2026-11', 0]])
    const aug = c.rows[2]
    expect(aug.cells.map(x => x.active)).toEqual([1, 1, 0, 0])
    expect(aug.cells[2]).toMatchObject({ period: '2026-10', lostInStep: 1, lostTotal: 1, pct: 0 })
    expect(aug.members).toEqual([{ clientId: 'n2', firstName: 'N2', lastName: 'X', entry: ENTRY_NEW, exitStep: 2, exitDate: '2026-10-07', reason: 'logistical_family' }])
    // El reingreso de h3 abre su propia cohorte
    expect(c.rows[3].members[0]).toMatchObject({ clientId: 'h3', entry: ENTRY_RETURN, exitStep: 2 })
    expect(c.rows[1].members[0]).toMatchObject({ clientId: 'n1', exitStep: null, exitDate: null })
    // Vivos de las cohortes + heredados activos = activos al cierre
    const alive = c.rows.reduce((s, r) => s + (r.cells[r.cells.length - 1]?.active || 0), 0)
    expect(alive + tenureStats(timeline, 5).inherited).toBe(counts[5].closing)
    expect(c.average[0]).toMatchObject({ k: 0, active: 3, base: 3, cohorts: 3 })
    expect(c).toMatchObject({ entries: 3, emptyCohorts: 3 })
  })

  test('por trimestre calendario', () => {
    const c = cohortRetention(timeline, 5, 'quarter')
    expect(c.rows.map(r => [r.key, r.size, r.cells.length])).toEqual([['2026-T2', 0, 3], ['2026-T3', 3, 2], ['2026-T4', 0, 1]])
    expect(c.rows[1].cells.map(x => x.active)).toEqual([3, 1])
  })
})
