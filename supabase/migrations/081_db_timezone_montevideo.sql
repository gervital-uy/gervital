-- 081: La base pasa a razonar en hora uruguaya
--
-- El servidor corre en UTC y ~34 llamadas usan CURRENT_DATE. Entre las 21:00 y
-- la medianoche de Uruguay eso ya es el día siguiente, así que durante ese 12,5%
-- del tiempo la base estaba un día adelantada. Efectos medidos en producción:
--
--   * get_churn_board mostraba un día de más en cada tarjeta
--   * los créditos de recupero que vencían hoy se descartaban 3 horas antes
--   * register_absence trataba una falta de mañana como de hoy → la cobraba y
--     además otorgaba recupero
--   * advance_scheduled_attendance marcaba "asistió" a todo el padrón del día
--     siguiente si corría después de las 21:00
--   * deactivate_client escribía la baja con la fecha de mañana, y eso alimenta
--     el corte de facturación
--
-- Se hace a nivel del rol `authenticator` y no de la base entera: es el único
-- rol de login por el que entran PostgREST y las edge functions, así que auth,
-- storage y realtime quedan fuera del alcance sin perder nada a cambio.
--
-- Es seguro porque ninguna columna de día calendario es timestamp: las 26 son
-- `date` (no tienen zona) y los timestamptz guardan instantes absolutos, que no
-- se mueven — sólo cambia cómo se renderizan. Se verificó que no hay ninguna
-- columna `timestamp without time zone` en el esquema.
--
-- Revertir: ALTER ROLE authenticator RESET TimeZone;

ALTER ROLE authenticator SET TimeZone = 'America/Montevideo';

-- Nota: aplica al abrir la conexión, así que las conexiones que PostgREST ya
-- tenía en el pool siguen en UTC hasta reciclarse.
