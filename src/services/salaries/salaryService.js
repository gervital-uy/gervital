import { supabase } from '../supabase/client'
import { getSetting } from '../settings/appSettingsService'
import { pendingContributions, DIRECTOR_SYSTEM_KEY, monthKey } from './directorContribution'

// Tipos discretos para gastos extraordinarios de empleado.
export const EXTRA_COST_TYPES = [
  { value: 'despido', label: 'Despido' },
  { value: 'liquidacion', label: 'Liquidación' },
  { value: 'bono', label: 'Bono' },
  { value: 'otro', label: 'Otro' }
]

const EXTRA_COST_LABELS = EXTRA_COST_TYPES.reduce((acc, t) => {
  acc[t.value] = t.label
  return acc
}, {})

export function extraCostLabel(type) {
  return EXTRA_COST_LABELS[type] || type || ''
}

function mapAdjustment(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    liquido: Number(row.liquido),
    effectiveDate: row.effective_date,
    notes: row.notes,
    createdAt: row.created_at
  }
}

function mapExtraCost(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    type: row.type,
    concept: row.concept,
    amount: Number(row.amount),
    date: row.date,
    systemKey: row.system_key || null,
    overriddenAt: row.overridden_at || null,
    createdAt: row.created_at
  }
}

function mapEmployee(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    semesterAdjustmentPct: Number(row.semester_adjustment_pct),
    hasIrpf: !!row.has_irpf,
    active: row.active,
    adjustments: (row.adjustments || []).map(mapAdjustment),
    extraCosts: (row.extra_costs || []).map(mapExtraCost),
    createdAt: row.created_at
  }
}

/**
 * Get all employees with nested salary history and extra costs, newest first.
 * @returns {Promise<Array>}
 */
export async function getEmployees() {
  const { data, error } = await supabase
    .from('employees_full')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data.map(mapEmployee)
}

/**
 * Get standalone extra costs (no employee).
 * @returns {Promise<Array>}
 */
export async function getStandaloneExtraCosts() {
  const { data, error } = await supabase
    .from('employee_extra_costs')
    .select('*')
    .is('employee_id', null)
    .order('date', { ascending: false })

  if (error) throw new Error(error.message)
  return data.map(mapExtraCost)
}

/**
 * Create an employee + its first salary adjustment atomically.
 * @param {object} input - { name, role, semesterAdjustmentPct, liquido, hasIrpf, effectiveDate, notes? }
 * @returns {Promise<string>} new employee id
 */
export async function createEmployee(input) {
  const { data, error } = await supabase.rpc('create_employee_with_salary', {
    p_name: input.name,
    p_role: input.role || null,
    p_semester_adjustment_pct: input.semesterAdjustmentPct ?? 3.5,
    p_liquido: input.liquido,
    p_has_irpf: !!input.hasIrpf,
    p_effective_date: input.effectiveDate,
    p_notes: input.notes || null
  })

  if (error) throw new Error(error.message)
  return data
}

/**
 * Update employee fields (name, role, %, active).
 */
export async function updateEmployee(id, input) {
  const payload = {}
  if (input.name !== undefined) payload.name = input.name
  if (input.role !== undefined) payload.role = input.role
  if (input.semesterAdjustmentPct !== undefined) payload.semester_adjustment_pct = input.semesterAdjustmentPct
  if (input.hasIrpf !== undefined) payload.has_irpf = input.hasIrpf
  if (input.active !== undefined) payload.active = input.active
  payload.updated_at = new Date().toISOString()

  const { error } = await supabase.from('employees').update(payload).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Delete an employee (cascade removes adjustments and extra costs). */
export async function deleteEmployee(id) {
  const { error } = await supabase.from('employees').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Add a salary adjustment row (a real raise/change, kept in history).
 * @param {string} employeeId
 * @param {object} input - { liquido, effectiveDate, notes? }
 */
export async function addSalaryAdjustment(employeeId, input) {
  const { error } = await supabase.from('employee_salary_adjustments').insert({
    employee_id: employeeId,
    liquido: input.liquido,
    effective_date: input.effectiveDate,
    notes: input.notes || null
  })
  if (error) throw new Error(error.message)
}

/**
 * Editar un ajuste existente: corregir el líquido o mover el mes de vigencia.
 * @param {string} id
 * @param {{liquido?: number, effectiveDate?: string, notes?: string}} input
 */
export async function updateSalaryAdjustment(id, input) {
  const payload = {}
  if (input.liquido !== undefined) payload.liquido = input.liquido
  if (input.effectiveDate !== undefined) payload.effective_date = input.effectiveDate
  if (input.notes !== undefined) payload.notes = input.notes || null

  const { error } = await supabase.from('employee_salary_adjustments').update(payload).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Delete a salary adjustment (UI prevents deleting the only/first one). */
export async function deleteSalaryAdjustment(id) {
  const { error } = await supabase.from('employee_salary_adjustments').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Add an extra cost. employeeId null => standalone (no employee, no type).
 * @param {object} input - { employeeId?, type?, concept?, amount, date }
 */
export async function addExtraCost(input) {
  const { error } = await supabase.from('employee_extra_costs').insert({
    employee_id: input.employeeId || null,
    type: input.employeeId ? (input.type || null) : null,
    concept: input.concept || null,
    amount: input.amount,
    date: input.date
  })
  if (error) throw new Error(error.message)
}

/**
 * Pisar a mano el monto de un extraordinario. Si la fila la había generado el
 * sistema queda marcada como editada: no se recalcula igual (una fila creada no
 * se toca nunca), pero el cartel de la UI pasa a "editado a mano" para que se
 * entienda por qué ese mes no cuadra con la fórmula.
 * @param {string} id
 * @param {{amount:number}} input
 */
export async function updateExtraCost(id, { amount }) {
  const { error } = await supabase
    .from('employee_extra_costs')
    .update({ amount, overridden_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** Delete an extra cost. */
export async function deleteExtraCost(id) {
  const { error } = await supabase.from('employee_extra_costs').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Self-heal del aporte jubilatorio de directores: crea la fila de cada mes que
 * falte entre el mes ancla y el corriente. No hay cron en el proyecto, así que
 * corre al abrir Costos — que es superadmin, igual que la RLS de la tabla.
 *
 * Solo inserta. Una fila ya creada se queda con el monto que se congeló ese
 * mes; subir un sueldo hoy no reescribe meses pasados.
 *
 * Best-effort por diseño: si falla (índice único por una carrera entre dos
 * pestañas, permisos, red) no rompe la carga de Costos.
 *
 * @param {Array} employees - lista de getEmployees()
 * @param {{year:number, month:number}} current - mes corriente (month 0-indexed)
 * @returns {Promise<number>} filas creadas
 */
export async function ensureDirectorContributions(employees, current) {
  const startKey = await getSetting('director_contribution_start')
  if (!startKey) return 0

  const currentKey = monthKey(current.year, current.month)
  const { data, error } = await supabase
    .from('employee_extra_costs')
    .select('date')
    .eq('system_key', DIRECTOR_SYSTEM_KEY)
  if (error) throw new Error(error.message)

  const rows = pendingContributions({ startKey, currentKey, existing: data || [], employees })
  if (rows.length === 0) return 0

  const { error: insertError } = await supabase.from('employee_extra_costs').insert(
    rows.map(r => ({
      employee_id: null,
      type: null,
      concept: r.concept,
      amount: r.amount,
      date: r.date,
      system_key: r.systemKey
    }))
  )
  if (insertError) throw new Error(insertError.message)
  return rows.length
}
