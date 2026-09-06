-- 078: Prestadores de servicios
--
-- Gasto fijo mensual de quienes prestan servicio sin ser empleados (choferes
-- contratados, contador, autos de terceros). Hasta ahora se cargaban como
-- gastos extraordinarios sin empleado, que no son recurrentes y había que
-- re-tipear todos los meses.
--
-- El monto mensual es el monto mensual: sin aguinaldo, sin salario vacacional,
-- sin mensualizar un anual. Cuentan como sueldo a efectos estadísticos.
-- Dar de baja (active = false) deja de sumar.
--
-- No migra ni carga datos: los extraordinarios sin empleado ya cargados quedan
-- como están y se siguen viendo y sumando igual.

CREATE TABLE service_providers (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  role           TEXT,
  monthly_amount NUMERIC(12,2) NOT NULL CHECK (monthly_amount >= 0),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_service_providers_active ON service_providers(active);

ALTER TABLE service_providers ENABLE ROW LEVEL SECURITY;

-- Mismo permiso que empleados: la sección vive dentro de Sueldos (solo superadmin).
CREATE POLICY "Service providers viewable by superadmin"  ON service_providers FOR SELECT USING (is_superadmin());
CREATE POLICY "Service providers insertable by superadmin" ON service_providers FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY "Service providers updatable by superadmin"  ON service_providers FOR UPDATE USING (is_superadmin());
CREATE POLICY "Service providers deletable by superadmin"  ON service_providers FOR DELETE USING (is_superadmin());

CREATE TRIGGER update_service_providers_updated_at
  BEFORE UPDATE ON service_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
