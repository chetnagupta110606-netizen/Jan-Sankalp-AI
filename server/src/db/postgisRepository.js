const { Pool } = require('pg');
const config = require('../config');

let pool = null;
let schemaReady = null;

function isEnabled() {
  return Boolean(config.databaseUrl);
}

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(`
      CREATE EXTENSION IF NOT EXISTS postgis;
      CREATE TABLE IF NOT EXISTS telecom_reports (
        id UUID PRIMARY KEY,
        tracking_id TEXT UNIQUE NOT NULL,
        channel TEXT NOT NULL,
        sender_phone TEXT NOT NULL,
        description TEXT,
        transcript TEXT,
        media_url TEXT,
        location_name TEXT,
        h3_cell TEXT NOT NULL,
        geom GEOGRAPHY(POINT, 4326) NOT NULL,
        dpr_path TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS telecom_reports_geom_idx
        ON telecom_reports USING GIST (geom);
    `);
  }
  return schemaReady;
}

async function insertReport(report) {
  await ensureSchema();

  await getPool().query(
    `INSERT INTO telecom_reports
       (id, tracking_id, channel, sender_phone, description, transcript, media_url,
        location_name, h3_cell, geom, dpr_path, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             ST_SetSRID(ST_MakePoint($10, $11), 4326)::geography, $12, $13)
     ON CONFLICT (id) DO NOTHING`,
    [
      report.id,
      report.trackingId,
      report.channel,
      report.senderPhone,
      report.description,
      report.transcript,
      report.mediaUrl,
      report.location.name,
      report.location.h3Cell,
      report.location.longitude,
      report.location.latitude,
      report.dprPath,
      report.createdAt,
    ],
  );

  return report;
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    schemaReady = null;
  }
}

module.exports = { isEnabled, insertReport, ensureSchema, close };
