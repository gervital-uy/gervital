-- ════════════════════════════════════════════════════════════════════════════
-- 072_client_followup_reports.sql
-- Informes de seguimiento y observaciones del equipo interdisciplinario por
-- cliente. Tres tipos (seguimiento / objetivos / familiares) con campos propios.
-- RLS espeja las tablas médicas y client_test_instances (is_authenticated()).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS client_followup_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type                TEXT NOT NULL CHECK (type IN ('seguimiento', 'objetivos', 'familiares')),
  report_date         DATE NOT NULL,
  professional        TEXT,
  discipline          TEXT,
  motivation          TEXT CHECK (motivation IN ('alta', 'media', 'baja')),
  observations        TEXT,
  actions             TEXT,
  recipient           TEXT,
  general_objectives  JSONB NOT NULL DEFAULT '[]'::jsonb,
  specific_objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
  strategies          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_followup_reports_client_date
  ON client_followup_reports (client_id, report_date DESC);

-- RLS: espeja las tablas médicas (is_authenticated() para todo).
ALTER TABLE client_followup_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfr_select ON client_followup_reports;
DROP POLICY IF EXISTS cfr_insert ON client_followup_reports;
DROP POLICY IF EXISTS cfr_update ON client_followup_reports;
DROP POLICY IF EXISTS cfr_delete ON client_followup_reports;
CREATE POLICY cfr_select ON client_followup_reports FOR SELECT USING (is_authenticated());
CREATE POLICY cfr_insert ON client_followup_reports FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY cfr_update ON client_followup_reports FOR UPDATE USING (is_authenticated());
CREATE POLICY cfr_delete ON client_followup_reports FOR DELETE USING (is_authenticated());
