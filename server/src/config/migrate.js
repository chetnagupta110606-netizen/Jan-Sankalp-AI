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
`;

async function runMigration() {
  await db.init();

  if (db.mode === 'postgres' && db.pool) {
    await db.query(INCIDENTS_SCHEMA);
    await db.query(`
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_contractor VARCHAR(255);
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS deadline TIMESTAMP;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS priority VARCHAR(128);
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS original_photo TEXT;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution_audit JSONB;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution_proof_path TEXT;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS penalty_status VARCHAR(64) DEFAULT 'On Track';
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS penalty_tier VARCHAR(128);
      ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_status_check;
    `);
    console.log('[migrate] PostgreSQL `incidents` table ensured.');
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