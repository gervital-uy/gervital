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
