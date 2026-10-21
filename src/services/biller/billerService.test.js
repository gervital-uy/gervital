import { supabase } from '../supabase/client'
import { syncClientToBiller } from './billerService'

jest.mock('../supabase/client', () => ({
  supabase: { functions: { invoke: jest.fn() } }
}))

// Forma de FunctionsHttpError de supabase-js: `context` es la Response del edge function
const httpError = (status, body) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: { status, json: async () => body }
})

describe('syncClientToBiller', () => {
  afterEach(() => jest.resetAllMocks())

  test('keeps the Biller response body and status when Biller rejects the client', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: null,
      error: httpError(502, {
        error: 'Biller rechazó el alta del cliente (HTTP 422)',
        detail: '{"errores":["Documento inválido"]}'
      })
    })

    const err = await syncClientToBiller('c1').catch(e => e)

    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Biller rechazó el alta del cliente (HTTP 422)')
    expect(err.detail).toBe('{"errores":["Documento inválido"]}')
    expect(err.status).toBe(502)
  })

  test('falls back to the transport message when the body is not JSON', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: null,
      error: { message: 'Failed to send a request to the Edge Function', context: { status: 500, json: async () => { throw new Error('bad json') } } }
    })

    const err = await syncClientToBiller('c1').catch(e => e)

    expect(err.message).toBe('Failed to send a request to the Edge Function')
    expect(err.detail).toBeNull()
  })

  test('treats an OK response without a Biller client id as a failure', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null })

    await expect(syncClientToBiller('c1')).rejects.toThrow('Biller no devolvió el id del cliente')
  })

  test('resolves with the Biller ids on success', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: { ok: true, billerClientId: 10, billerBranchId: 20 }, error: null })

    await expect(syncClientToBiller('c1', true)).resolves.toEqual({ ok: true, billerClientId: 10, billerBranchId: 20 })
    expect(supabase.functions.invoke).toHaveBeenCalledWith('biller', { body: { action: 'sync_client', clientId: 'c1', force: true } })
  })

  test('resolves when the client was already synced', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: { ok: true, alreadySynced: true, billerClientId: 10 }, error: null })

    await expect(syncClientToBiller('c1')).resolves.toMatchObject({ alreadySynced: true })
  })
})
