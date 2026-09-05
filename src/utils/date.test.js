import { format } from 'date-fns'
import { lastBusinessDayOfMonth, parseDateOnly, todayStr, toDateStr } from './date'

const iso = (d) => format(d, 'yyyy-MM-dd')

describe('lastBusinessDayOfMonth', () => {
  test('returns the last day when it is a weekday', () => {
    // Jun 2026 ends on Tuesday the 30th
    expect(iso(lastBusinessDayOfMonth(2026, 5))).toBe('2026-06-30')
  })
  test('steps back when the month ends on Sunday', () => {
    // May 2026 ends on Sunday the 31st → Friday the 29th
    expect(iso(lastBusinessDayOfMonth(2026, 4))).toBe('2026-05-29')
  })
  test('steps back when the month ends on Saturday', () => {
    // Jan 2026 ends on Saturday the 31st → Friday the 30th
    expect(iso(lastBusinessDayOfMonth(2026, 0))).toBe('2026-01-30')
  })
})

describe('parseDateOnly', () => {
  test('devuelve el mismo día que dice el string (no el anterior)', () => {
    const d = parseDateOnly('2026-06-24')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(5) // junio
    expect(d.getDate()).toBe(24)
  })

  test('el bug original: new Date(str) se corre un día, parseDateOnly no', () => {
    // En GMT-3 `new Date('2026-06-24')` es el 23 a las 21:00.
    expect(format(parseDateOnly('2026-06-24'), 'd MMMM')).toBe(format(new Date(2026, 5, 24), 'd MMMM'))
    expect(iso(parseDateOnly('2026-06-24'))).toBe('2026-06-24')
  })

  test('es medianoche local, para comparar contra días de calendario', () => {
    const d = parseDateOnly('2026-06-24')
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
    // El propio día debe entrar en un rango `día >= inicio` (cálculo de facturación)
    expect(new Date(2026, 5, 24) >= d).toBe(true)
    expect(new Date(2026, 5, 23) >= d).toBe(false)
  })

  test('un timestamp con hora se parsea como instante, en día local', () => {
    // 18:30Z = 15:30 local en GMT-3, mismo día
    expect(iso(parseDateOnly('2026-06-24T18:30:00.000Z'))).toBe('2026-06-24')
    // 00:25Z del 5 = 21:25 local del 4: el día local es el 4, no el 5.
    // Recortar el string a 10 daría '2026-09-05', que es el bug que evitamos.
    expect(iso(parseDateOnly('2026-09-05T00:25:47+00:00'))).toBe('2026-09-04')
  })

  test('devuelve null para valores vacíos o inválidos', () => {
    expect(parseDateOnly(null)).toBeNull()
    expect(parseDateOnly(undefined)).toBeNull()
    expect(parseDateOnly('')).toBeNull()
    expect(parseDateOnly('no-es-fecha')).toBeNull()
  })

  test('deja pasar un Date sin tocarlo', () => {
    const d = new Date(2026, 5, 24)
    expect(parseDateOnly(d)).toBe(d)
  })

  test('roundtrip con toDateStr para todo un mes', () => {
    for (let day = 1; day <= 30; day++) {
      const s = `2026-06-${String(day).padStart(2, '0')}`
      expect(toDateStr(parseDateOnly(s))).toBe(s)
    }
  })
})

describe('toDateStr / todayStr', () => {
  test('usa los componentes locales, no UTC', () => {
    // 21:30 local en GMT-3 ya es el día siguiente en UTC: toISOString daría el 25.
    const nocheDelJueves = new Date(2026, 5, 24, 21, 30)
    expect(toDateStr(nocheDelJueves)).toBe('2026-06-24')
    expect(nocheDelJueves.toISOString().slice(0, 10)).toBe('2026-06-25') // el bug que evitamos
  })

  test('pad de mes y día de un dígito', () => {
    expect(toDateStr(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  test('todayStr coincide con el día local de hoy', () => {
    expect(todayStr()).toBe(format(new Date(), 'yyyy-MM-dd'))
  })
})
