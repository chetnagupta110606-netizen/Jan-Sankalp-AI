/**
 * Jan-Sankalp AI — Database Service Layer
 * ------------------------------------------------------------------
 * Primary: PostgreSQL + PostGIS connection pool (activated when the
 *          standard PG* / DATABASE_URL environment variables are set).
 * Fallback: Dynamic file-backed store (NeDB-style JSON persistence)
 *          automatically activated when no DB env vars are present,
 *          so every incident survives a server restart even with zero
 *          external infrastructure.
 * ------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

// ── Environment resolution ─────────────────────────────────────────
const DB_URL = process.env.DATABASE_URL || '';
const PG_ENV_PRESENT = Boolean(
  DB_URL ||
  process.env.PGHOST ||
  process.env.PGDATABASE ||
  process.env.PGUSER
);

const PG_CONFIG = {
  connectionString: DB_URL || undefined,
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'jan_sankalp',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
};

// ── Fallback (file-backed) store ───────────────────────────────────
const FALLBACK_DIR = path.join(__dirname, '..', '..', '.data');
const FALLBACK_FILE = path.join(FALLBACK_DIR, 'incidents.json');

class FileStore {
  constructor() {
    this.records = [];
    this._seq = 1;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(FALLBACK_FILE)) {
        const raw = fs.readFileSync(FALLBACK_FILE, 'utf8');
        const parsed = JSON.parse(raw || '[]');
        if (Array.isArray(parsed) && parsed.length) {
          this.records = parsed;
          this._seq = parsed.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
        }
      }
    } catch (err) {
      console.warn('[db:fallback] Could not read store, starting empty:', err.message);
      this.records = [];
    }
  }

  _persist() {
    try {
      if (!fs.existsSync(FALLBACK_DIR)) {
        fs.mkdirSync(FALLBACK_DIR, { recursive: true });
      }
      fs.writeFileSync(FALLBACK_FILE, JSON.stringify(this.records, null, 2), 'utf8');
    } catch (err) {
      console.error('[db:fallback] Persist failure:', err.message);
    }
  }

  all() {
    return [...this.records].sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );
  }

  findById(id) {
    return this.records.find((r) => String(r.id) === String(id)) || null;
  }

  insert(data = {}) {
    const record = {
      id: this._seq++,
      transcript: data.transcript || null,
      category: data.category || null,
      urgency: data.urgency || null,
      status: data.status || 'Pending Survey',
      location_name: data.location_name || null,
      h3_index: data.h3_index || null,
      latitude: data.latitude != null && Number.isFinite(Number(data.latitude)) ? Number(data.latitude) : null,
      longitude: data.longitude != null && Number.isFinite(Number(data.longitude)) ? Number(data.longitude) : null,
      assigned_ministry: data.assigned_ministry || null,
      assignedContractor: data.assignedContractor || data.assigned_contractor || null,
      assigned_contractor: data.assignedContractor || data.assigned_contractor || null,
      deadline: data.deadline || data.deadline_at || null,
      resolvedAt: data.resolvedAt || data.resolved_at || null,
      resolved_at: data.resolvedAt || data.resolved_at || null,
      penaltyStatus: data.penaltyStatus || data.penalty_status || 'On Track',
      penalty_status: data.penaltyStatus || data.penalty_status || 'On Track',
      penaltyTier: data.penaltyTier || data.penalty_tier || null,
      penalty_tier: data.penaltyTier || data.penalty_tier || null,
      target_completion_date: data.target_completion_date || null,
      priority: data.priority || null,
      original_photo: data.original_photo || null,
      resolution_audit: data.resolution_audit || null,
      resolution_proof_path: data.resolution_proof_path || data.proof_file_path || null,
      resolution_notes: data.resolution_notes || data.notes || null,
      upvote_count: Number(data.upvote_count) || 0,
      affected_citizens_count: Number(data.affected_citizens_count) || 0,
      created_at: data.created_at || new Date().toISOString()
    };
    this.records.push(record);
    this._persist();
    return record;
  }

  update(id, patch = {}) {
    const record = this.findById(id);
    if (!record) return null;
    const nextPatch = { ...patch };
    if (nextPatch.resolution_proof_path == null && nextPatch.proof_file_path) {
      nextPatch.resolution_proof_path = nextPatch.proof_file_path;
    }
    if (nextPatch.resolution_notes == null && nextPatch.notes) {
      nextPatch.resolution_notes = nextPatch.notes;
    }
    Object.assign(record, nextPatch);
    this._persist();
    return record;
  }

  count() {
    return this.records.length;
  }
}

// ── Public DB facade ───────────────────────────────────────────────
const db = {
  mode: PG_ENV_PRESENT ? 'postgres' : 'file',
  pool: null,
  fileStore: null,

  async init() {
    if (PG_ENV_PRESENT) {
      try {
        // Lazy require so the fallback path never needs `pg` installed.
        const { Pool } = require('pg');
        this.pool = new Pool(PG_CONFIG);
        await this.pool.query('SELECT 1');
        this.mode = 'postgres';
        console.log(`[db] PostgreSQL/PostGIS pool connected → ${PG_CONFIG.database}@${PG_CONFIG.host}:${PG_CONFIG.port}`);
        return this;
      } catch (err) {
        console.warn('[db] PostgreSQL unavailable, falling back to file store:', err.message);
        this.pool = null;
        this.mode = 'file';
      }
    }
    this.fileStore = new FileStore();
    this.mode = 'file';
    console.log(`[db] File-backed persistence active → ${FALLBACK_FILE}`);
    return this;
  },

  // Raw query helper (PostgreSQL only).
  async query(text, params = []) {
    if (!this.pool) throw new Error('PostgreSQL pool is not initialised.');
    return this.pool.query(text, params);
  },

  // Generic insert into incidents.
  async insertIncident(data = {}) {
    if (this.pool) {
      const sql = `
        INSERT INTO incidents
          (transcript, category, urgency, status, location_name, h3_index,
           latitude, longitude, assigned_ministry, assigned_contractor, deadline,
           target_completion_date, priority, original_photo, resolution_audit,
           resolution_proof_path, resolution_notes, resolved_at, penalty_status,
           penalty_tier, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, COALESCE($21, NOW()))
        RETURNING *;
      `;
      const params = [
        data.transcript || null,
        data.category || null,
        data.urgency || null,
        data.status || 'Pending Survey',
        data.location_name || null,
        data.h3_index || null,
        data.latitude != null && Number.isFinite(Number(data.latitude)) ? Number(data.latitude) : null,
        data.longitude != null && Number.isFinite(Number(data.longitude)) ? Number(data.longitude) : null,
        data.assigned_ministry || null,
        data.assignedContractor || data.assigned_contractor || null,
        data.deadline || data.deadline_at || null,
        data.target_completion_date || null,
        data.priority || null,
        data.original_photo || null,
        data.resolution_audit ? JSON.stringify(data.resolution_audit) : null,
        data.resolution_proof_path || data.proof_file_path || null,
        data.resolution_notes || data.notes || null,
        data.resolvedAt || data.resolved_at || null,
        data.penaltyStatus || data.penalty_status || 'On Track',
        data.penaltyTier || data.penalty_tier || null,
        data.created_at || null
      ];
      const { rows } = await this.pool.query(sql, params);
      return rows[0];
    }
    return this.fileStore.insert(data);
  },

  async getAllIncidents() {
    if (this.pool) {
      const { rows } = await this.pool.query('SELECT * FROM incidents ORDER BY created_at DESC;');
      return rows;
    }
    return this.fileStore.all();
  },

  async getIncidentById(id) {
    if (this.pool) {
      const { rows } = await this.pool.query('SELECT * FROM incidents WHERE id = $1;', [id]);
      return rows[0] || null;
    }
    return this.fileStore.findById(id);
  },

  async updateIncident(id, patch = {}) {
    if (this.pool) {
      const { rows } = await this.pool.query(
        `UPDATE incidents
           SET status = COALESCE($2, status),
               assigned_ministry = COALESCE($3, assigned_ministry),
               assigned_contractor = COALESCE($4, assigned_contractor),
               deadline = COALESCE($5, deadline),
               target_completion_date = COALESCE($6, target_completion_date),
               urgency = COALESCE($7, urgency),
               priority = COALESCE($8, priority),
               original_photo = COALESCE($9, original_photo),
               resolution_audit = COALESCE($10::jsonb, resolution_audit),
               resolution_proof_path = COALESCE($11, resolution_proof_path),
               resolution_notes = COALESCE($12, resolution_notes),
               resolved_at = COALESCE($13, resolved_at),
               penalty_status = COALESCE($14, penalty_status),
               penalty_tier = COALESCE($15, penalty_tier)
         WHERE id = $1
         RETURNING *;`,
        [
          id,
          patch.status || null,
          patch.assigned_ministry || null,
          patch.assignedContractor || patch.assigned_contractor || null,
          patch.deadline || patch.deadline_at || null,
          patch.target_completion_date || null,
          patch.urgency || null,
          patch.priority || null,
          patch.original_photo || null,
          patch.resolution_audit ? JSON.stringify(patch.resolution_audit) : null,
          patch.resolution_proof_path || patch.proof_file_path || null,
          patch.resolution_notes || patch.notes || null,
          patch.resolved_at || patch.resolvedAt || null,
          patch.penaltyStatus || patch.penalty_status || null,
          patch.penaltyTier || patch.penalty_tier || null
        ]
      );
      return rows[0] || null;
    }
    return this.fileStore.update(id, patch);
  },

  async countIncidents() {
    if (this.pool) {
      const { rows } = await this.pool.query('SELECT COUNT(*)::int AS count FROM incidents;');
      return rows[0] ? rows[0].count : 0;
    }
    return this.fileStore.count();
  }
};

module.exports = db;
module.exports.PG_ENV_PRESENT = PG_ENV_PRESENT;
module.exports.FALLBACK_FILE = FALLBACK_FILE;