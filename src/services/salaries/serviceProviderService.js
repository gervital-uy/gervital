import { supabase } from '../supabase/client'

function mapProvider(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    monthlyAmount: Number(row.monthly_amount),
    active: row.active,
    notes: row.notes,
    createdAt: row.created_at
  }
}

/**
 * Prestadores de servicios (no empleados), activos primero y por nombre.
 * @returns {Promise<Array>}
 */
export async function getServiceProviders() {
  const { data, error } = await supabase
    .from('service_providers')
    .select('*')
    .order('active', { ascending: false })
    .order('name', { ascending: true })

  if (error) throw new Error(error.message)
  return data.map(mapProvider)
}

/**
 * @param {{name: string, role?: string, monthlyAmount: number, notes?: string}} input
 * @returns {Promise<object>}
 */
export async function createServiceProvider(input) {
  const { data, error } = await supabase
    .from('service_providers')
    .insert({
      name: input.name,
      role: input.role || null,
      monthly_amount: input.monthlyAmount,
      notes: input.notes || null
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return mapProvider(data)
}

/**
 * @param {string} id
 * @param {{name?: string, role?: string, monthlyAmount?: number, active?: boolean, notes?: string}} input
 * @returns {Promise<object>}
 */
export async function updateServiceProvider(id, input) {
  const payload = {}
  if (input.name !== undefined) payload.name = input.name
  if (input.role !== undefined) payload.role = input.role || null
  if (input.monthlyAmount !== undefined) payload.monthly_amount = input.monthlyAmount
  if (input.active !== undefined) payload.active = input.active
  if (input.notes !== undefined) payload.notes = input.notes || null

  const { data, error } = await supabase
    .from('service_providers')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return mapProvider(data)
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteServiceProvider(id) {
  const { error } = await supabase.from('service_providers').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
