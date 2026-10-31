import { useEffect, useState } from 'react'
import { todayStr } from '../../utils/date'

// El día de hoy ('YYYY-MM-DD'), que se actualiza solo: una pestaña abierta de un
// día para el otro (o de un mes para el otro) tiene que ver el día nuevo sin
// recargar. Se revisa al volver a la pestaña y una vez por minuto; si el día no
// cambió, no hay render.
export function useToday() {
  const [today, setToday] = useState(todayStr)
  useEffect(() => {
    const check = () => setToday(todayStr())
    const timer = setInterval(check, 60 * 1000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
  return today
}
