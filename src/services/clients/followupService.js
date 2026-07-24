import { supabase } from '../supabase/client'

// Fila DB → objeto camelCase de frontend.
function fromDb(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    type: row.type,
    reportDate: row.report_date,
    professional: row.professional,
    discipline: row.discipline,
    motivation: row.motivation,
    observations: row.observations,
    actions: row.actions,
    recipient: row.recipient,
    generalObjectives: row.general_objectives || [],
    specificObjectives: row.specific_objectives || [],
    strategies: row.strategies || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// Payload de frontend → columnas DB (sin client_id, que va aparte en create).
function toDb(payload) {
  return {
    type: payload.type,
    report_date: payload.reportDate,
    professional: payload.professional ?? null,
    discipline: payload.discipline ?? null,
    motivation: payload.motivation || null,
    observations: payload.observations ?? null,
    actions: payload.actions ?? null,
    recipient: payload.recipient ?? null,
    general_objectives: payload.generalObjectives ?? [],
    specific_objectives: payload.specificObjectives ?? [],
    strategies: payload.strategies ?? [],
    updated_at: new Date().toISOString()
  }
}

export async function getClientFollowups(clientId) {
  const { data, error } = await supabase
    .from('client_followup_reports')
    .select('*')
    .eq('client_id', clientId)
    .order('report_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data.map(fromDb)
}

export async function createFollowup(clientId, payload) {
  const { data, error } = await supabase
    .from('client_followup_reports')
    .insert({ client_id: clientId, ...toDb(payload) })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return fromDb(data)
}

export async function updateFollowup(id, payload) {
  const { data, error } = await supabase
    .from('client_followup_reports')
    .update(toDb(payload))
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return fromDb(data)
}

export async function deleteFollowup(id) {
  const { error } = await supabase
    .from('client_followup_reports')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}
