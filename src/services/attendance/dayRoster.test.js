import { buildDayRoster, buildPlannedRoster, classifyDay, isRecoveryAttendee, indexAttendanceByClientId, keepClientsInSlots, ABSENT_STATUSES, RECOVERY_STATUS } from './dayRoster'

// Helpers
const client = (id, days, schedule = 'morning', over = {}) => ({
  id,
  firstName: id,
  lastName: id,
  plan: { assignedDays: days, schedule },
  ...over
})

// morning shift predicate (as used by Grupos): morning or full_day
const morningShift = c => c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day'
const afternoonShift = c => c.plan?.schedule === 'afternoon' || c.plan?.schedule === 'full_day'

describe('buildDayRoster', () => {
  test('planned client with no attendance record is included', () => {
    const clients = [client('a', ['monday'])]
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: new Map() })
    expect(roster.map(c => c.id)).toEqual(['a'])
  })

  test('planned client is excluded when marked absent that day (justified)', () => {
    const clients = [client('hebe', ['monday'])]
    const att = new Map([['hebe', { status: 'absent', isJustified: true }]])
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(roster.map(c => c.id)).toEqual([])
  })

  test('planned client is excluded when marked absent that day (unjustified)', () => {
    const clients = [client('a', ['monday'])]
    const att = new Map([['a', { status: 'absent', isJustified: false }]])
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(roster.map(c => c.id)).toEqual([])
  })

  test('planned client is excluded when marked absent that day (justified, non-chargeable)', () => {
    const clients = [client('a', ['monday'])]
    const att = new Map([['a', { status: 'absent', isJustified: true, isChargeable: false }]])
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(roster.map(c => c.id)).toEqual([])
  })

  test('planned client stays when attended or scheduled', () => {
    const clients = [client('a', ['monday']), client('b', ['monday'])]
    const att = new Map([
      ['a', { status: 'attended' }],
      ['b', { status: 'scheduled' }]
    ])
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(roster.map(c => c.id).sort()).toEqual(['a', 'b'])
  })

  test('non-planned client attending on a recovery day is included in matching shift', () => {
    // client assigned Mon/Wed but attends on Thursday as recovery
    const clients = [client('r', ['monday', 'wednesday'], 'morning')]
    const att = new Map([['r', { status: 'recovery' }]])
    const roster = buildDayRoster({ clients, dayName: 'thursday', matchesShift: morningShift, attendanceByClientId: att })
    expect(roster.map(c => c.id)).toEqual(['r'])
  })

  test('recovery-day attendee is not included in a non-matching shift', () => {
    // morning-schedule client recovering — should not appear in afternoon shift
    const clients = [client('r', ['monday'], 'morning')]
    const att = new Map([['r', { status: 'recovery' }]])
    const roster = buildDayRoster({ clients, dayName: 'thursday', matchesShift: afternoonShift, attendanceByClientId: att })
    expect(roster.map(c => c.id)).toEqual([])
  })

  test('non-planned client with no record is not included', () => {
    const clients = [client('a', ['monday'])]
    const roster = buildDayRoster({ clients, dayName: 'thursday', matchesShift: morningShift, attendanceByClientId: new Map() })
    expect(roster.map(c => c.id)).toEqual([])
  })

  test('full_day client appears in both morning and afternoon shifts', () => {
    const clients = [client('f', ['monday'], 'full_day')]
    const m = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: new Map() })
    const a = buildDayRoster({ clients, dayName: 'monday', matchesShift: afternoonShift, attendanceByClientId: new Map() })
    expect(m.map(c => c.id)).toEqual(['f'])
    expect(a.map(c => c.id)).toEqual(['f'])
  })

  test('empty attendance map behaves exactly like plan-only filtering (no regression)', () => {
    const clients = [
      client('a', ['monday'], 'morning'),
      client('b', ['tuesday'], 'morning'),
      client('c', ['monday'], 'afternoon')
    ]
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift })
    expect(roster.map(c => c.id)).toEqual(['a'])
  })

  test('preserves order of the input clients array', () => {
    const clients = [client('z', ['monday']), client('a', ['monday']), client('m', ['monday'])]
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: new Map() })
    expect(roster.map(c => c.id)).toEqual(['z', 'a', 'm'])
  })
})

describe('classifyDay', () => {
  const morningShift = c => c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day'

  test('splits planned clients into present / absent (all absence reasons flattened)', () => {
    const clients = [
      client('present', ['monday']),
      client('hebe', ['monday']),
      client('onvac', ['monday'])
    ]
    const att = new Map([
      ['hebe', { status: 'absent', isJustified: true, isChargeable: true }],
      ['onvac', { status: 'absent', isJustified: true, isChargeable: false }]
    ])
    const { present, absent } = classifyDay({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(present.map(c => c.id)).toEqual(['present'])
    expect(absent.map(c => c.id)).toEqual(['hebe', 'onvac'])
  })

  test('absent clients carry their attendance record for the motivo tooltip', () => {
    const clients = [client('hebe', ['monday'])]
    const record = { status: 'absent', isJustified: true, isChargeable: true, notes: 'Cita médica' }
    const att = new Map([['hebe', record]])
    const { absent } = classifyDay({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(absent[0].absence).toEqual(record)
    expect(absent[0].id).toBe('hebe')
  })

  test('recovery attendee (non-planned day) lands in present, not absent', () => {
    const clients = [client('r', ['monday'], 'morning')]
    const att = new Map([['r', { status: 'recovery' }]])
    const { present, absent } = classifyDay({ clients, dayName: 'thursday', matchesShift: morningShift, attendanceByClientId: att })
    expect(present.map(c => c.id)).toEqual(['r'])
    expect(absent).toEqual([])
  })

  test('present matches buildDayRoster output', () => {
    const clients = [
      client('a', ['monday']),
      client('b', ['monday']),
      client('r', ['tuesday'], 'morning')
    ]
    const att = new Map([
      ['b', { status: 'absent' }],
      ['r', { status: 'recovery' }]
    ])
    const args = { clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att }
    expect(classifyDay(args).present.map(c => c.id)).toEqual(buildDayRoster(args).map(c => c.id))
  })

  test('absent only includes clients whose shift matches', () => {
    // afternoon-schedule absent client should NOT appear in a morning classification
    const clients = [client('pm', ['monday'], 'afternoon')]
    const att = new Map([['pm', { status: 'absent' }]])
    const { absent } = classifyDay({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(absent).toEqual([])
  })

  test('empty attendance map yields all-present, empty absent', () => {
    const clients = [client('a', ['monday']), client('b', ['monday'])]
    const { present, absent } = classifyDay({ clients, dayName: 'monday', matchesShift: morningShift })
    expect(present.map(c => c.id).sort()).toEqual(['a', 'b'])
    expect(absent).toEqual([])
  })

})

describe('buildPlannedRoster', () => {
  test('returns the planned clients for the day+shift', () => {
    const clients = [client('a', ['monday']), client('b', ['tuesday']), client('c', ['monday'], 'afternoon')]
    const roster = buildPlannedRoster({ clients, dayName: 'monday', matchesShift: morningShift })
    expect(roster.map(c => c.id)).toEqual(['a'])
  })

  test('ignores absences — an absent planned client still shows (commercial view)', () => {
    const clients = [client('a', ['monday']), client('b', ['monday'])]
    const roster = buildPlannedRoster({ clients, dayName: 'monday', matchesShift: morningShift })
    expect(roster.map(c => c.id)).toEqual(['a', 'b'])
  })

  test('ignores recoveries — no one is added outside their plan', () => {
    const clients = [client('r', ['monday'], 'morning')]
    const roster = buildPlannedRoster({ clients, dayName: 'thursday', matchesShift: morningShift })
    expect(roster).toEqual([])
  })

  test('full_day clients match both shifts', () => {
    const clients = [client('f', ['monday'], 'full_day')]
    expect(buildPlannedRoster({ clients, dayName: 'monday', matchesShift: morningShift }).map(c => c.id)).toEqual(['f'])
    expect(buildPlannedRoster({ clients, dayName: 'monday', matchesShift: afternoonShift }).map(c => c.id)).toEqual(['f'])
  })

  test('tolerates a client with no plan', () => {
    const roster = buildPlannedRoster({ clients: [{ id: 'x' }], dayName: 'monday', matchesShift: morningShift })
    expect(roster).toEqual([])
  })
})

describe('isRecoveryAttendee', () => {
  test('true only when the client has a recovery record', () => {
    const att = new Map([
      ['r', { status: 'recovery' }],
      ['a', { status: 'attended' }],
      ['x', { status: 'absent' }]
    ])
    expect(isRecoveryAttendee({ id: 'r' }, att)).toBe(true)
    expect(isRecoveryAttendee({ id: 'a' }, att)).toBe(false)
    expect(isRecoveryAttendee({ id: 'x' }, att)).toBe(false)
    expect(isRecoveryAttendee({ id: 'none' }, att)).toBe(false)
  })

  test('false when no attendance map is provided', () => {
    expect(isRecoveryAttendee({ id: 'r' })).toBe(false)
  })
})

describe('indexAttendanceByClientId', () => {
  test('builds a Map keyed by clientId', () => {
    const records = [
      { clientId: 'a', status: 'absent' },
      { clientId: 'b', status: 'recovery' }
    ]
    const map = indexAttendanceByClientId(records)
    expect(map.get('a').status).toBe('absent')
    expect(map.get('b').status).toBe('recovery')
  })

  test('returns an empty Map for empty or missing input', () => {
    expect(indexAttendanceByClientId([]).size).toBe(0)
    expect(indexAttendanceByClientId(undefined).size).toBe(0)
  })

  test('last record wins on duplicate clientId', () => {
    const map = indexAttendanceByClientId([
      { clientId: 'a', status: 'scheduled' },
      { clientId: 'a', status: 'absent' }
    ])
    expect(map.get('a').status).toBe('absent')
  })
})

describe('keepClientsInSlots', () => {
  const slots = () => [
    {
      id: 's1',
      activities: [
        { id: 'a1', clientIds: ['juan', 'ana'] },
        { id: 'a2', clientIds: ['leo'] }
      ]
    },
    {
      id: 's2',
      activities: [{ id: 'a3', clientIds: ['juan', 'leo'] }]
    }
  ]

  test('keeps only the allowed clients in every activity across all slots', () => {
    const result = keepClientsInSlots(slots(), new Set(['ana', 'leo']))
    expect(result[0].activities[0].clientIds).toEqual(['ana'])
    expect(result[0].activities[1].clientIds).toEqual(['leo'])
    expect(result[1].activities[0].clientIds).toEqual(['leo'])
  })

  test('returns the same array reference when every assigned client is allowed', () => {
    const input = slots()
    expect(keepClientsInSlots(input, new Set(['juan', 'ana', 'leo']))).toBe(input)
  })

  test('returns the input untouched when the allowed set is missing (roster not loaded yet)', () => {
    const input = slots()
    expect(keepClientsInSlots(input, undefined)).toBe(input)
  })

  test('an empty allowed set empties every activity', () => {
    const result = keepClientsInSlots(slots(), new Set())
    expect(result.flatMap(s => s.activities.map(a => a.clientIds))).toEqual([[], [], []])
  })

  test('does not mutate the input slots', () => {
    const input = slots()
    keepClientsInSlots(input, new Set(['ana']))
    expect(input[0].activities[0].clientIds).toEqual(['juan', 'ana'])
    expect(input[1].activities[0].clientIds).toEqual(['juan', 'leo'])
  })

  test('reuses untouched activities and slots (same references)', () => {
    const input = [...slots(), { id: 's3', activities: [{ id: 'a4', clientIds: ['ana'] }] }]
    const result = keepClientsInSlots(input, new Set(['ana', 'leo']))
    expect(result[0].activities[1]).toBe(input[0].activities[1])
    expect(result[2]).toBe(input[2])
  })

  // Los escenarios del pedido: quien ya estaba asignado tiene que salir del grupo
  // cuando deja de venir ese día, sea por falta, recupero anulado o cambio de plan.
  describe('with the day roster as the allowed set', () => {
    const assigned = () => [{ id: 's1', activities: [{ id: 'a1', clientIds: ['ana', 'rec', 'beto'] }] }]
    const presentIds = (clients, att) => new Set(
      classifyDay({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att }).present.map(c => c.id)
    )
    const clients = [client('ana', ['monday']), client('rec', ['tuesday']), client('beto', ['monday'])]

    test('a planned client who gets an absence leaves the group', () => {
      const att = new Map([['ana', { status: 'absent' }], ['rec', { status: 'recovery' }]])
      expect(keepClientsInSlots(assigned(), presentIds(clients, att))[0].activities[0].clientIds).toEqual(['rec', 'beto'])
    })

    test('a recovery client leaves the group when the recovery is annulled (record gone)', () => {
      const att = new Map()
      expect(keepClientsInSlots(assigned(), presentIds(clients, att))[0].activities[0].clientIds).toEqual(['ana', 'beto'])
    })

    test('a client whose plan no longer includes the day, or changed shift, leaves the group', () => {
      const changed = [client('ana', ['tuesday']), client('rec', ['tuesday']), client('beto', ['monday'], 'afternoon')]
      const att = new Map([['rec', { status: 'recovery' }]])
      expect(keepClientsInSlots(assigned(), presentIds(changed, att))[0].activities[0].clientIds).toEqual(['rec'])
    })

    test('a client who is no longer an active client (baja) leaves the group', () => {
      const att = new Map([['rec', { status: 'recovery' }]])
      const withoutBeto = clients.filter(c => c.id !== 'beto')
      expect(keepClientsInSlots(assigned(), presentIds(withoutBeto, att))[0].activities[0].clientIds).toEqual(['ana', 'rec'])
    })

    test('undoing the absence brings the client back to the same activity (non destructive)', () => {
      const input = assigned()
      const att = new Map([['rec', { status: 'recovery' }]])
      keepClientsInSlots(input, presentIds(clients, new Map([['ana', { status: 'absent' }]])))
      expect(keepClientsInSlots(input, presentIds(clients, att))).toBe(input)
    })
  })
})

describe('status constants', () => {
  test('absent statuses cover the unified absence status', () => {
    expect(ABSENT_STATUSES).toContain('absent')
    expect(ABSENT_STATUSES).toEqual(['absent'])
  })

  test('recovery status is "recovery"', () => {
    expect(RECOVERY_STATUS).toBe('recovery')
  })
})
