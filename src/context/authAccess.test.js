import { roleHasAccess } from './AuthContext'

describe('roleHasAccess — attendance_edit', () => {
  test('el operador no edita asistencia: registrar una falta mueve plata', () => {
    expect(roleHasAccess('operador', 'attendance_edit')).toBe(false)
  })

  test('admin y superadmin sí', () => {
    expect(roleHasAccess('admin', 'attendance_edit')).toBe(true)
    expect(roleHasAccess('superadmin', 'attendance_edit')).toBe(true)
  })

  test('el operador conserva clientes (ve el calendario)', () => {
    expect(roleHasAccess('operador', 'clients')).toBe(true)
  })

  test('rol desconocido o vacío no accede', () => {
    expect(roleHasAccess('otro', 'attendance_edit')).toBe(false)
    expect(roleHasAccess(undefined, 'attendance_edit')).toBe(false)
  })

  test('feature inexistente no accede', () => {
    expect(roleHasAccess('superadmin', 'no_existe')).toBe(false)
  })
})

describe('roleHasAccess — dashboard_v2', () => {
  test('arranca solo para superadmin', () => {
    expect(roleHasAccess('superadmin', 'dashboard_v2')).toBe(true)
    expect(roleHasAccess('admin', 'dashboard_v2')).toBe(false)
    expect(roleHasAccess('operador', 'dashboard_v2')).toBe(false)
  })

  test('el dashboard legacy sigue visible para todos los roles', () => {
    expect(roleHasAccess('operador', 'clients')).toBe(true)
    expect(roleHasAccess('admin', 'clients')).toBe(true)
  })
})
