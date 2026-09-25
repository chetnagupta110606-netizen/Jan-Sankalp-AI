/**
 * Jan-Sankalp AI — Proof-of-Resolution AI Gate
 * ------------------------------------------------------------------
 * POST /api/v1/resolutions
 * Field-officer close-out: EXIF GPS must fall inside 50 m of the
 * incident H3 cell, then a structural similarity / debris check
 * decides between AI-verified close and District Collector audit.
 * ------------------------------------------------------------------
 */

const IncidentModel = require('../models/incidentModel');
const {
  TARGET_H3_CELL,
  MAX_DISTANCE_METERS,
  MIN_STRUCTURAL_CONFIDENCE,
  bufferFromPayload,
  extractExif,
  haversineMeters,
  resolveHexCenter,
  analyzeStructure
} = require('../services/proofOfResolutionService');
const { auditResolutionPhotos } = require('../services/photoAuditService');
const db = require('../config/database');

const QUALITY_AUDIT_WINDOW_DAYS = 30;

async function resolveIncident(req, res) {
  try {
    const request = req && req.params ? req : { params: {}, body: {}, file: null };
    const incidentId = request.params.incidentId || request.params.id || request.body.incidentId || request.body.id;
    const dbLayer = request.db || db;
    const incident = await dbLayer.getIncidentById(incidentId);

    if (!incident) {
      if (res && typeof res.status === 'function') {
        return res.status(404).json({ success: false, error: 'Incident not found.' });
      }
      return { success: false, error: 'Incident not found.' };
    }

    const filePath = request.file && request.file.path
      ? request.file.path
      : (request.body.resolution_proof_path || request.body.proof_file_path || request.body.proofPath || null);

    if (!filePath) {
      if (res && typeof res.status === 'function') {
        return res.status(400).json({ success: false, error: 'Resolution proof image is required.' });
      }
      return { success: false, error: 'Resolution proof image is required.' };
    }

    const notes = request.body.notes || request.body.resolution_notes || request.body.comment || 'Filed proof of resolution';
    const timestamp = new Date().toISOString();
    const patch = {
      status: 'Resolved',
      resolution_proof_path: filePath,
      resolution_notes: `${notes} — ${timestamp}`,
      resolved_at: timestamp,
      priority: 'Resolved'
    };

    const updated = await dbLayer.updateIncident(incidentId, patch);
    const payload = updated || { ...incident, ...patch };

    if (res && typeof res.json === 'function') {
      return res.json({ success: true, data: payload });
    }

    return { success: true, data: payload };
  } catch (error) {
    console.error('[resolution] resolveIncident error:', error && error.message);
    if (res && typeof res.status === 'function') {
      return res.status(500).json({ success: false, error: 'Unable to resolve incident.', details: error && error.message });
    }
    return { success: false, error: 'Unable to resolve incident.', details: error && error.message };
  }
}

async function checkQualityAuditTrigger({
  newIncidentId = null,
  h3Index = null,
  createdAt = new Date().toISOString(),
  incidents = null,
  now = new Date()
} = {}) {
  const sourceIncidents = Array.isArray(incidents) ? incidents : await IncidentModel.findAll();
  const targetH3 = String(h3Index || '').trim();

  if (!targetH3) {
    return { triggered: false, auditBreaches: [] };
  }

  const cutoffMillis = new Date(createdAt || now).getTime();
  const breaches = [];

  for (const incident of sourceIncidents) {
    if (!incident || incident.id === newIncidentId) continue;
    if (String(incident.h3_index || '').trim() !== targetH3) continue;

    const status = String(incident.status || '').trim();
    const isResolved = ['Action Taken / Resolved', 'Resolved', 'Closed'].includes(status);
    if (!isResolved) continue;

    const incidentTime = new Date(incident.created_at || incident.createdAt || 0).getTime();
    if (!Number.isFinite(incidentTime)) continue;

    const diffMs = cutoffMillis - incidentTime;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffMs >= 0 && diffDays <= QUALITY_AUDIT_WINDOW_DAYS) {
      breaches.push({
        id: incident.id,
        status: 'QUALITY_AUDIT_BREACH',
        priority: 'Senior Contractor Review',
        assigned_ministry: 'Senior Review / Contractor Quality Audit',
        h3_index: incident.h3_index,
        created_at: incident.created_at
      });
    }
  }

  return {
    triggered: breaches.length > 0,
    auditBreaches: breaches
  };
}

function safeBody(req) {
  return (req && req.body && typeof req.body === 'object') ? req.body : {};
}

function pickImage(req, keys) {
  const body = safeBody(req);
  const files = req.files || {};
  const file = req.file;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (files[key] && files[key][0] && files[key][0].buffer) {
      return files[key][0].buffer;
    }
    if (file && file.fieldname === key && file.buffer) {
      return file.buffer;
    }
    const fromBody = bufferFromPayload(body[key]);
    if (fromBody) return fromBody;
  }
  return null;
}

async function submitResolution(req, res) {
  try {
    const body = safeBody(req);
    const incidentId = req.params.id || body.incidentId || body.id || body.incident_id;
    if (!incidentId) {
      return res.status(400).json({
        success: false,
        error: 'Incident id is required.'
      });
    }

    const incident = await IncidentModel.findById(incidentId);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const resolutionBuffer = pickImage(req, ['image', 'resolutionImage', 'photo', 'resolution_photo']);
    if (!resolutionBuffer) {
      return res.status(400).json({
        success: false,
        error: 'Resolution photo is required.'
      });
    }

    const originalBuffer =
      pickImage(req, ['originalImage', 'original_photo', 'incidentImage']) ||
      bufferFromPayload(incident.original_photo);

    // Photo tampering audit (Feature D)
    let photoAuditResult = null;
    if (originalBuffer && resolutionBuffer) {
      try {
        photoAuditResult = await auditResolutionPhotos(
          originalBuffer,
          resolutionBuffer,
          new Date().toISOString()
        );

        // Reject if photos are identical (fake upload)
        if (!photoAuditResult.isValid && photoAuditResult.issues.some(issue => 
          issue.includes('identical to complaint photo')
        )) {
          return res.status(400).json({
            success: false,
            status: 'REJECTED_PHOTO_TAMPERING',
            error: 'Resolution photo is identical to complaint photo. Please upload a genuine resolution photo.',
            photoAudit: photoAuditResult
          });
        }
      } catch (auditErr) {
        console.warn('[resolution] Photo audit warning:', auditErr.message);
        // Continue with resolution process even if audit fails
        photoAuditResult = {
          isValid: true,
          issues: ['Photo audit failed: ' + auditErr.message],
          error: auditErr.message
        };
      }
    }

    const hex = resolveHexCenter(incident, body);
    const exif = await extractExif(resolutionBuffer);

    if (!Number.isFinite(exif.latitude) || !Number.isFinite(exif.longitude)) {
      return res.status(400).json({
        status: 'REJECTED_LOCATION_MISMATCH',
        error: 'Photo captured outside incident zone.'
      });
    }

    const distanceMeters = haversineMeters(
      exif.latitude,
      exif.longitude,
      hex.latitude,
      hex.longitude
    );
    const distanceKm = Number((distanceMeters / 1000).toFixed(4));

    if (distanceMeters > MAX_DISTANCE_METERS) {
      return res.status(400).json({
        status: 'REJECTED_LOCATION_MISMATCH',
        error: 'Photo captured outside incident zone.'
      });
    }

    let structural;
    try {
      structural = await analyzeStructure(originalBuffer, resolutionBuffer);
    } catch (err) {
      structural = {
        matchConfidence: 0,
        rubbleDetected: true,
        geometryMatch: 0,
        error: err && err.message
      };
    }

    const belowConfidence = Number(structural.matchConfidence || 0) < MIN_STRUCTURAL_CONFIDENCE;
    const needsManualAudit = belowConfidence || Boolean(structural.rubbleDetected);

    const audit = {
      verified: !needsManualAudit,
      h3_index: hex.h3Index || TARGET_H3_CELL,
      exif: {
        latitude: exif.latitude,
        longitude: exif.longitude,
        timestamp: exif.timestamp
      },
      distance_meters: Number(distanceMeters.toFixed(2)),
      distance_km: distanceKm,
      structural_similarity: Number(structural.matchConfidence || 0),
      geometry_match: structural.geometryMatch != null ? structural.geometryMatch : null,
      rubble_detected: Boolean(structural.rubbleDetected),
      gate: needsManualAudit ? 'PENDING_MANUAL_AUDIT' : 'AI_GROUND_VERIFIED',
      evaluated_at: new Date().toISOString(),
      photo_audit: photoAuditResult
    };

    const patch = needsManualAudit
      ? {
          status: 'PENDING_MANUAL_AUDIT',
          priority: 'District Collector Review',
          assigned_ministry: 'District Collector Review',
          urgency: 'Critical',
          resolution_audit: audit
        }
      : {
          status: 'Action Taken / Resolved',
          priority: 'Closed — AI Ground Verified',
          resolution_audit: audit
        };

    const updated = await IncidentModel.update(incidentId, patch);

    const qualityAudit = await checkQualityAuditTrigger({
      newIncidentId: incidentId,
      h3Index: updated.h3_index || incident.h3_index,
      createdAt: new Date().toISOString(),
      incidents: await IncidentModel.findAll()
    });

    if (qualityAudit.triggered) {
      for (const breach of qualityAudit.auditBreaches) {
        await IncidentModel.update(breach.id, {
          status: 'QUALITY_AUDIT_BREACH',
          priority: 'Senior Contractor Review',
          assigned_ministry: 'Senior Review / Contractor Quality Audit'
        });
      }
    }

    return res.json({
      success: true,
      status: patch.status,
      data: updated,
      audit,
      qualityAudit
    });
  } catch (err) {
    console.error('[resolution] Error:', err && err.message);
    return res.status(500).json({
      success: false,
      error: 'Proof-of-resolution audit failed.',
      details: err && err.message
    });
  }
}

module.exports = { submitResolution, checkQualityAuditTrigger, resolveIncident };
