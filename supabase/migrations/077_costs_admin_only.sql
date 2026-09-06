-- 077: Costos solo para admin/superadmin
--
-- El operador deja de ver e ingresar gastos. Hasta ahora todas las tablas de
-- costos eran `is_authenticated()`, así que ocultar la página en el frontend
-- habría sido cosmético: cualquier usuario logueado podía leerlas y escribirlas
-- desde la API. Se cierra en RLS, que es donde se hace cumplir de verdad.
--
-- Alcance: gastos fijos, variables y extraordinarios, categorías, el directorio
-- de proveedores y el ajuste `contingency_fund_pct` (todos son la página Costos).
-- El frontend lo refleja con la feature `costs` (antes `suppliers`).

-- ── expenses ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Expenses viewable by authenticated"  ON expenses;
DROP POLICY IF EXISTS "Expenses insertable by authenticated" ON expenses;
DROP POLICY IF EXISTS "Expenses updatable by authenticated"  ON expenses;
DROP POLICY IF EXISTS "Expenses deletable by authenticated"  ON expenses;

CREATE POLICY "Expenses viewable by admins"  ON expenses FOR SELECT USING (is_admin_or_superadmin());
CREATE POLICY "Expenses insertable by admins" ON expenses FOR INSERT WITH CHECK (is_admin_or_superadmin());
CREATE POLICY "Expenses updatable by admins"  ON expenses FOR UPDATE USING (is_admin_or_superadmin());
CREATE POLICY "Expenses deletable by admins"  ON expenses FOR DELETE USING (is_admin_or_superadmin());

-- ── extraordinary_expenses ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Extraordinary expenses viewable by authenticated"  ON extraordinary_expenses;
DROP POLICY IF EXISTS "Extraordinary expenses insertable by authenticated" ON extraordinary_expenses;
DROP POLICY IF EXISTS "Extraordinary expenses updatable by authenticated"  ON extraordinary_expenses;
DROP POLICY IF EXISTS "Extraordinary expenses deletable by authenticated"  ON extraordinary_expenses;

CREATE POLICY "Extraordinary expenses viewable by admins"  ON extraordinary_expenses FOR SELECT USING (is_admin_or_superadmin());
CREATE POLICY "Extraordinary expenses insertable by admins" ON extraordinary_expenses FOR INSERT WITH CHECK (is_admin_or_superadmin());
CREATE POLICY "Extraordinary expenses updatable by admins"  ON extraordinary_expenses FOR UPDATE USING (is_admin_or_superadmin());
CREATE POLICY "Extraordinary expenses deletable by admins"  ON extraordinary_expenses FOR DELETE USING (is_admin_or_superadmin());

-- ── fixed_expenses ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Fixed expenses viewable by authenticated"  ON fixed_expenses;
DROP POLICY IF EXISTS "Fixed expenses insertable by authenticated" ON fixed_expenses;
DROP POLICY IF EXISTS "Fixed expenses updatable by authenticated"  ON fixed_expenses;
DROP POLICY IF EXISTS "Fixed expenses deletable by authenticated"  ON fixed_expenses;

CREATE POLICY "Fixed expenses viewable by admins"  ON fixed_expenses FOR SELECT USING (is_admin_or_superadmin());
CREATE POLICY "Fixed expenses insertable by admins" ON fixed_expenses FOR INSERT WITH CHECK (is_admin_or_superadmin());
CREATE POLICY "Fixed expenses updatable by admins"  ON fixed_expenses FOR UPDATE USING (is_admin_or_superadmin());
CREATE POLICY "Fixed expenses deletable by admins"  ON fixed_expenses FOR DELETE USING (is_admin_or_superadmin());

-- ── expense_categories ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Expense categories viewable by authenticated"  ON expense_categories;
DROP POLICY IF EXISTS "Expense categories insertable by authenticated" ON expense_categories;
DROP POLICY IF EXISTS "Expense categories updatable by authenticated"  ON expense_categories;
DROP POLICY IF EXISTS "Expense categories deletable by authenticated"  ON expense_categories;

CREATE POLICY "Expense categories viewable by admins"  ON expense_categories FOR SELECT USING (is_admin_or_superadmin());
CREATE POLICY "Expense categories insertable by admins" ON expense_categories FOR INSERT WITH CHECK (is_admin_or_superadmin());
CREATE POLICY "Expense categories updatable by admins"  ON expense_categories FOR UPDATE USING (is_admin_or_superadmin());
CREATE POLICY "Expense categories deletable by admins"  ON expense_categories FOR DELETE USING (is_admin_or_superadmin());

-- ── suppliers (directorio, vive dentro de la página Costos) ─────────────────
DROP POLICY IF EXISTS "Suppliers viewable by authenticated"  ON suppliers;
DROP POLICY IF EXISTS "Suppliers insertable by authenticated" ON suppliers;
DROP POLICY IF EXISTS "Suppliers updatable by authenticated"  ON suppliers;
DROP POLICY IF EXISTS "Suppliers deletable by authenticated"  ON suppliers;

CREATE POLICY "Suppliers viewable by admins"  ON suppliers FOR SELECT USING (is_admin_or_superadmin());
CREATE POLICY "Suppliers insertable by admins" ON suppliers FOR INSERT WITH CHECK (is_admin_or_superadmin());
CREATE POLICY "Suppliers updatable by admins"  ON suppliers FOR UPDATE USING (is_admin_or_superadmin());
CREATE POLICY "Suppliers deletable by admins"  ON suppliers FOR DELETE USING (is_admin_or_superadmin());

-- ── app_settings: hoy solo guarda contingency_fund_pct, que es de Costos ────
-- INSERT/UPDATE ya eran admin; faltaba cerrar la lectura.
DROP POLICY IF EXISTS "App settings viewable by authenticated" ON app_settings;
CREATE POLICY "App settings viewable by admins" ON app_settings FOR SELECT USING (is_admin_or_superadmin());
