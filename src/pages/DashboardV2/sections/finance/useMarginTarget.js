import { useCallback, useEffect, useState } from 'react'
import { getSetting, setSetting } from '../../../../services/settings/appSettingsService'
import { MARGIN_TARGET_KEY, parseTarget, serializeTarget } from '../../../../services/dashboardV2/financeView'

// La meta de margen neto guardada en app_settings. Arranca "sin definir" (null) y
// solo se escribe cuando alguien aprieta Guardar: `save(v)` guarda el número o '' para
// "sin meta", nunca null (quedaría el texto 'null'). Si no se puede leer, `status` es
// 'error' y el control solo simula: guardar a ciegas podría pisar una meta que no se vio.
export function useMarginTarget() {
  const [state, setState] = useState({ status: 'loading', value: null })

  useEffect(() => {
    let cancelled = false
    getSetting(MARGIN_TARGET_KEY).then(
      value => { if (!cancelled) setState({ status: 'ready', value: parseTarget(value) }) },
      () => { if (!cancelled) setState({ status: 'error', value: null }) }
    )
    return () => { cancelled = true }
  }, [])

  const save = useCallback(async value => {
    const text = serializeTarget(value)
    await setSetting(MARGIN_TARGET_KEY, text)
    setState({ status: 'ready', value: parseTarget(text) })
  }, [])

  return { ...state, save }
}
