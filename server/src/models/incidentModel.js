/**
 * Jan-Sankalp AI — Incident Model
 * ------------------------------------------------------------------
 * Encapsulates all database schema queries for the `incidents` table.
 * Controllers never touch SQL or the file store directly; they call
 * these typed helpers instead.
 * ------------------------------------------------------------------
 */

const db = require('../config/database');

// Normalise a DB row (postgres snake_case or file store) into the API shape.
function toIncidentPayload(row = {}) {
  if (!row) return null;
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  return {
    id: row.id,
    transcript: row.transcript || '',
    category: row.category || 'General Infrastructure',
    urgency: row.urgency || 'Medium',
    status: row.status || 'Pending Survey',
    location_name: row.location_name || 'Unassigned Region',
    h3_index: row.h3_index || null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    coordinates: Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null,
    assigned_ministry: row.assigned_ministry || 'Ministry of Housing and Urban Affairs',
    target_completion_date: normalizeDate(row.target_completion_date),
    priority: row.priority || null,
    original_photo: row.original_photo || null,
    resolution_audit: parseJson(row.resolution_audit),
    resolution_proof_path: row.resolution_proof_path || row.proof_file_path || null,
    resolution_notes: row.resolution_notes || row.notes || null,
    resolved_at: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    upvote_count: Number(row.upvote_count) || 0,
    affected_citizens_count: Number(row.affected_citizens_count) || 0,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  };
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return null; }
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

const IncidentModel = {
  toIncidentPayload,

  async create(data = {}) {
    const row = await db.insertIncident(data);
    return toIncidentPayload(row);
  },

  async incrementUpvoteCount(id) {
    const incident = await this.findById(id);
    if (!incident) return null;

    const currentCount = Number(incident.upvote_count) || 0;
    const currentAffected = Number(incident.affected_citizens_count) || 0;

    const updated = await this.update(id, {
      upvote_count: currentCount + 1,
      affected_citizens_count: currentAffected + 1
    });

    return updated;
  },

  async findAll() {
    const rows = await db.getAllIncidents();
    return rows.map((row) => {
      const payload = toIncidentPayload(row);
      if (!payload) return null;
      payload.has_original_photo = Boolean(payload.original_photo);
      delete payload.original_photo;
      return payload;
    }).filter(Boolean);
  },

  async findById(id) {
    const row = await db.getIncidentById(id);
    return toIncidentPayload(row);
  },

  async update(id, patch = {}) {
    const row = await db.updateIncident(id, patch);
    return toIncidentPayload(row);
  },

  async count() {
    return db.countIncidents();
  },

  async findLatest() {
    const all = await this.findAll();
    return all.length ? all[0] : null;
  }
};

module.exports = IncidentModel;