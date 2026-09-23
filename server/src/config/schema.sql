-- ══════════════════════════════════════════════════════════════════
--  Jan-Sankalp AI — Reference Schema (PostgreSQL + PostGIS)
--  This mirrors the idempotent migration in server/src/config/migrate.js
--  and is provided for DBAs / manual provisioning.
-- ══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS incidents (
  id                     SERIAL PRIMARY KEY,
  transcript             TEXT,
  category               VARCHAR(255),
  urgency                VARCHAR(64) DEFAULT 'Medium',
  status                 VARCHAR(64) NOT NULL DEFAULT 'Pending Survey'
    CHECK (status IN ('Pending Survey', 'Under Survey', 'Scheduled for Action', 'Action Taken / Resolved', 'Resolved')),
  location_name          VARCHAR(255),
  h3_index               VARCHAR(128),
  latitude               DOUBLE PRECISION,
  longitude              DOUBLE PRECISION,
  assigned_ministry      VARCHAR(255),
  target_completion_date DATE,
  priority               VARCHAR(128),
  original_photo         TEXT,
  resolution_audit       JSONB,
  resolution_proof_path  TEXT,
  resolution_notes       TEXT,
  resolved_at            TIMESTAMP,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_incidents_status
  ON incidents (status);

CREATE INDEX IF NOT EXISTS idx_incidents_h3_index
  ON incidents (h3_index);

CREATE INDEX IF NOT EXISTS idx_incidents_ministry
  ON incidents (assigned_ministry);

CREATE INDEX IF NOT EXISTS idx_incidents_created_at
  ON incidents (created_at DESC);