/**
 * Jan-Sankalp AI — Migration / Schema Initialisation
 * ------------------------------------------------------------------
 * Idempotently creates the `incidents` table and indexes when a
 * PostgreSQL/PostGIS database is reachable. When no DB environment
 * variables are configured, it prepares the file-backed store so
 * persistence works out of the box.
 *
 * Run manually with:  npm run migrate
 * ------------------------------------------------------------------
 */

const db = require('./database');

const INCIDENTS_SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS postgis;

  CREATE TABLE IF NOT EXISTS incidents (
    id                     SERIAL PRIMARY KEY,
    transcript             TEXT,
    category               VARCHAR(255),
    urgency                VARCHAR(64) DEFAULT 'Medium',
    status                 VARCHAR(64) NOT NULL DEFAULT 'Pending Survey',
    location_name          VARCHAR(255),
    h3_index               VARCHAR(128),
    source                 VARCHAR(128) DEFAULT 'Web Portal',
    latitude               DOUBLE PRECISION,
    longitude              DOUBLE PRECISION,
    assigned_ministry      VARCHAR(255),
    assigned_contractor    VARCHAR(255),
    deadline               TIMESTAMP,
    target_completion_date DATE,
    priority               VARCHAR(128),
    original_photo         TEXT,
    resolution_audit       JSONB,
    resolution_proof_path  TEXT,
    resolution_notes       TEXT,
    resolved_at            TIMESTAMP,
    penalty_status         VARCHAR(64) DEFAULT 'On Track',
    penalty_tier           VARCHAR(128),
    report_count           INTEGER NOT NULL DEFAULT 1,
    sub_reports            JSONB NOT NULL DEFAULT '[]'::jsonb,
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

  CREATE TABLE IF NOT EXISTS whistleblower_reports (
    id              SERIAL PRIMARY KEY,
    token_hash      TEXT NOT NULL UNIQUE,
    category        VARCHAR(128) NOT NULL DEFAULT 'General',
    report_summary  TEXT NOT NULL,
    location_hint   VARCHAR(255),
    evidence        TEXT,
    status          VARCHAR(64) NOT NULL DEFAULT 'Submitted',
    status_message  TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_whistleblower_status
    ON whistleblower_reports (status);

  CREATE INDEX IF NOT EXISTS idx_whistleblower_created_at
    ON whistleblower_reports (created_at DESC);
`;

async function runMigration() {
  await db.init();

  if (db.mode === 'postgres' && db.pool) {
    await db.query(INCIDENTS_SCHEMA);
    await db.query(`
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_contractor VARCHAR(255);
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS deadline TIMESTAMP;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS priority VARCHAR(128);
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS source VARCHAR(128) DEFAULT 'Web Portal';
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS original_photo TEXT;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution_audit JSONB;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution_proof_path TEXT;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS penalty_status VARCHAR(64) DEFAULT 'On Track';
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS penalty_tier VARCHAR(128);
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS report_count INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS sub_reports JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_status_check;

      CREATE TABLE IF NOT EXISTS whistleblower_reports (
        id              SERIAL PRIMARY KEY,
        token_hash      TEXT NOT NULL UNIQUE,
        category        VARCHAR(128) NOT NULL DEFAULT 'General',
        report_summary  TEXT NOT NULL,
        location_hint   VARCHAR(255),
        evidence        TEXT,
        status          VARCHAR(64) NOT NULL DEFAULT 'Submitted',
        status_message  TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_whistleblower_status
        ON whistleblower_reports (status);

      CREATE INDEX IF NOT EXISTS idx_whistleblower_created_at
        ON whistleblower_reports (created_at DESC);
    `);
    console.log('[migrate] PostgreSQL `incidents` and `whistleblower_reports` tables ensured.');
  } else {
    // Touching the fallback store forces creation of the .data directory.
    await db.getAllIncidents();
    console.log('[migrate] File-backed persistence store initialised (no PostgreSQL env vars detected).');
  }

  return true;
}

if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('[migrate] Completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate] Aborted:', err.message);
      process.exit(1);
    });
}

module.exports = { runMigration, INCIDENTS_SCHEMA };