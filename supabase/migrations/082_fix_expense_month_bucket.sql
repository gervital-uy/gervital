-- 082: Corrige los gastos archivados en el mes equivocado
--
-- CostsPage derivaba year/month con new Date(form.date).getMonth(), que parsea
-- 'YYYY-MM-DD' como medianoche UTC: en GMT-3 todo gasto del día 1 caía en el mes
-- anterior. El código ya está arreglado (usa parseDateOnly); esto repara las
-- filas ya guardadas.
--
-- La corrección es determinista: year/month deben coincidir con la columna date,
-- que siempre se guardó bien. month es 0-indexado (convención JS).
-- Afectó 1 fila: "Cortinas Cine" 2026-06-01, archivada en mayo.

UPDATE expenses
SET year = EXTRACT(YEAR FROM date)::int,
    month = EXTRACT(MONTH FROM date)::int - 1
WHERE year <> EXTRACT(YEAR FROM date)::int
   OR month <> EXTRACT(MONTH FROM date)::int - 1;

UPDATE extraordinary_expenses
SET year = EXTRACT(YEAR FROM date)::int,
    month = EXTRACT(MONTH FROM date)::int - 1
WHERE year <> EXTRACT(YEAR FROM date)::int
   OR month <> EXTRACT(MONTH FROM date)::int - 1;
