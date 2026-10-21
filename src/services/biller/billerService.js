import { supabase } from '../supabase/client'

// Invoke the biller edge function, surfacing the server error message. The thrown
// Error carries `detail` (Biller's raw response body, when the edge function got one)
// and `status` (HTTP status of the edge function) so the UI can show what Biller said.
async function invokeBiller(body) {
  const { data, error } = await supabase.functions.invoke('biller', { body })
  if (error) {
    let message = error.message
    let detail = null
    try {
      const ctx = await error.context?.json?.()
      if (ctx?.error) message = ctx.error
      if (ctx?.detail) detail = ctx.detail
    } catch (_) { /* ignore parse errors */ }
    const err = new Error(message)
    err.detail = detail
    err.status = error.context?.status ?? null
    throw err
  }
  if (data?.error) throw new Error(data.error)
  return data
}

/**
 * Emit a monthly e-Ticket for a client (month is 0-indexed).
 * @param {object} [override] - Optional edited values from the confirmation modal:
 *   attendanceConcepto, attendanceAmount, transportConcepto, transportAmount, adenda, fechaEmision, fechaVencimiento
 */
export async function emitInvoice(clientId, year, month, override = {}) {
  return invokeBiller({ action: 'emit_invoice', clientId, year, month, ...override })
}

/** Fetch the comprobante PDF (base64) for an emitted invoice */
export async function getInvoicePdf(clientId, year, month) {
  return invokeBiller({ action: 'get_invoice_pdf', clientId, year, month })
}

/**
 * Pre-register / sync a client as a Biller receptor.
 * @param {boolean} [force] - Re-sync even if already linked (e.g. after editing fiscal data)
 */
export async function syncClientToBiller(clientId, force = false) {
  const data = await invokeBiller({ action: 'sync_client', clientId, force })
  // Biller respondió 2xx pero sin el id del receptor: el cliente no quedó vinculado
  if (!data?.billerClientId) throw new Error('Biller no devolvió el id del cliente')
  return data
}

/** Poll DGI acceptance status for an emitted invoice */
export async function checkDgiStatus(clientId, year, month) {
  return invokeBiller({ action: 'check_dgi_status', clientId, year, month })
}

/** Void an emitted invoice (issues a credit note in Biller) */
export async function voidInvoice(clientId, year, month) {
  return invokeBiller({ action: 'void_invoice', clientId, year, month })
}
