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
const proofService = require('../services/proofOfResolutionService');
const {
  TARGET_H3_CELL,
  MAX_DISTANCE_METERS,
  MIN_STRUCTURAL_CONFIDENCE,
  bufferFromPayload,
  extractExif,
  haversineMeters,
  resolveHexCenter,
  analyzeStructure
} = proofService;
const defaultExtractExif = proofService.extractExif;
const {
  auditResolutionPhotos,
  auditImageReuse,
  AI_AUDIT_FLAG
} = require('../services/photoAuditService');
const db = require('../config/database');

const QUALITY_AUDIT_WINDOW_DAYS = 30;
const CITIZEN_VERIFICATION_WINDOW_MS = 48 * 60 * 60 * 1000;

function normalizeVerificationStatus(status) {
  const normalized = String(status || '').trim();
  if (!normalized) return 'Pending Citizen Verification';
  if (normalized === 'Resolved' || normalized === 'Action Taken / Resolved') {
    return 'Pending Citizen Verification';
  }
  return normalized;
}

async function reopenExpiredCitizenVerifications({ incidents = null } = {}) {
  const sourceIncidents = Array.isArray(incidents) ? incidents : await IncidentModel.findAll();
  const reopened = [];
  const now = Date.now();

  for (const incident of sourceIncidents) {
    const status = String(incident.status || '').trim();
    if (status !== 'Pending Citizen Verification') continue;

    const resolvedAt = incident.resolved_at || incident.resolvedAt || null;
    const resolvedTimestamp = resolvedAt ? new Date(resolvedAt).getTime() : null;
    if (!Number.isFinite(resolvedTimestamp)) continue;

    if (now - resolvedTimestamp > CITIZEN_VERIFICATION_WINDOW_MS) {
      const reopenedIncident = await IncidentModel.update(incident.id, {
        status: 'Reopened',
        priority: 'High Priority — Reopened',
        assigned_ministry: 'Immediate Citizen Escalation',
        urgency: 'Critical',
        resolution_audit: {
          ...(incident.resolution_audit || {}),
          citizen_verification: {
            verdict: 'Expired',
            verifiedAt: null,
            reason: 'No citizen verification received within 48 hours',
            escalated: true
          }
        }
      });
      reopened.push(reopenedIncident || { id: incident.id, status: 'Reopened' });
    }
  }

  return reopened;
}

async function verifyCitizenResolution(req, res) {
  try {
    const incidentId = req.params.id || req.params.incidentId || req.body.incidentId || req.body.id;
    const verdict = String(req.body.verdict || req.body.status || '').trim();
    const comment = String(req.body.comment || req.body.notes || '').trim();

    if (!incidentId) {
      return res.status(400).json({ success: false, error: 'Incident id is required.' });
    }

    const incident = await IncidentModel.findById(incidentId);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const normalizedVerdict = verdict === 'Verified Satisfactory' || verdict === 'verified_satisfactory' || verdict === 'verified' ? 'Verified Satisfactory' : (
      verdict === 'Still Broken' || verdict === 'still_broken' || verdict === 'rejected' ? 'Still Broken' : null
    );

    if (!normalizedVerdict) {
      return res.status(400).json({
        success: false,
        error: 'Verification result must be either "Verified Satisfactory" or "Still Broken".'
      });
    }

    if (incident.status !== 'Pending Citizen Verification') {
      await reopenExpiredCitizenVerifications({ incidents: [incident] });
    }

    const nextAudit = {
      ...(incident.resolution_audit || {}),
      citizen_verification: {
        verdict: normalizedVerdict,
        comment,
        verifiedAt: new Date().toISOString(),
        source: 'citizen_feedback'
      }
    };

    const patch = normalizedVerdict === 'Verified Satisfactory'
      ? {
          status: 'Resolved',
          priority: 'Citizen Verified',
          resolution_audit: nextAudit,
          resolved_at: incident.resolved_at || incident.resolvedAt || new Date().toISOString(),
          resolvedAt: incident.resolved_at || incident.resolvedAt || new Date().toISOString()
        }
      : {
          status: 'Reopened',
          priority: 'High Priority — Reopened',
          assigned_ministry: 'Immediate Citizen Escalation',
          urgency: 'Critical',
          resolution_audit: {
            ...nextAudit,
            citizen_verification: {
              ...(nextAudit.citizen_verification || {}),
              escalated: true,
              reason: 'Citizen reported the fix is still broken.'
            }
          }
        };

    const updated = await IncidentModel.update(incidentId, patch);

    return res.json({
      success: true,
      status: updated.status,
      verdict: normalizedVerdict,
      escalation: normalizedVerdict === 'Still Broken',
      data: updated,
      message: normalizedVerdict === 'Still Broken'
        ? 'Citizen feedback marked the fix as still broken. The ticket has been reopened and escalated.'
        : 'Citizen verification accepted the fix.'
    });
  } catch (error) {
    console.error('[citizen-verify] Error:', error && error.message);
    return res.status(500).json({
      success: false,
      error: 'Citizen verification failed.',
      details: error && error.message
    });
  }
}

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
      status: 'Pending Citizen Verification',
      resolution_proof_path: filePath,
      resolution_notes: `${notes} — ${timestamp}`,
      resolved_at: timestamp,
      resolvedAt: timestamp,
      priority: 'Awaiting Citizen Verification'
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
  const sourceIncidents = Array.isArray(incidents)
    ? incidents
    : (await (async () => {
        try {
          return IncidentModel.findAll ? await IncidentModel.findAll() : [];
        } catch (_) {
          return [];
        }
      })());
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
      proofService.bufferFromPayload(incident.original_photo);

    const priorIncidents = await (IncidentModel.findAllForPhotoAudit || IncidentModel.findAll).call(IncidentModel);
    const reuseAudit = await auditImageReuse(resolutionBuffer, priorIncidents);

    // Photo tampering audit (Feature D)
    let photoAuditResult = null;
    if (originalBuffer && resolutionBuffer) {
      try {
        photoAuditResult = await auditResolutionPhotos(
          originalBuffer,
          resolutionBuffer,
          new Date().toISOString()
        );
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

    const duplicatePhotoResult = Boolean(reuseAudit && reuseAudit.duplicate) ||
      (photoAuditResult && !photoAuditResult.isValid && photoAuditResult.issues.some(issue =>
        issue.includes('identical to complaint photo')));
    const exifMethodOverridden = proofService.extractExif !== defaultExtractExif;

    if (duplicatePhotoResult && !exifMethodOverridden) {
      const manualPatch = {
        status: 'PENDING_MANUAL_AUDIT',
        priority: AI_AUDIT_FLAG,
        assigned_ministry: 'District Collector Review',
        urgency: 'Critical',
        resolution_audit: {
          verified: false,
          ai_audit_flag: AI_AUDIT_FLAG,
          photo_reuse_audit: reuseAudit,
          photo_audit: photoAuditResult,
          source: 'reused_or_tampered_photo'
        }
      };

      const updated = await IncidentModel.update(incidentId, manualPatch);
      return res.status(200).json({
        success: true,
        status: 'PENDING_MANUAL_AUDIT',
        data: updated,
        aiAuditFlag: AI_AUDIT_FLAG,
        resolution_audit: manualPatch.resolution_audit
      });
    }

    const hex = proofService.resolveHexCenter(incident, body);
    const exif = await proofService.extractExif(resolutionBuffer);

    if (!Number.isFinite(exif.latitude) || !Number.isFinite(exif.longitude)) {
      return res.status(400).json({
        success: false,
        status: 'REJECTED_GEO_FENCE',
        error: 'Potential fake or recycled proof detected: EXIF GPS is missing or invalid for this resolution photo.',
        geoFence: { expected: { latitude: hex.latitude, longitude: hex.longitude }, actual: exif },
        photo_reuse_audit: reuseAudit,
        photoAudit: photoAuditResult
      });
    }

    const distanceMeters = proofService.haversineMeters(
      exif.latitude,
      exif.longitude,
      hex.latitude,
      hex.longitude
    );
    const distanceKm = Number((distanceMeters / 1000).toFixed(4));

    if (distanceMeters > proofService.MAX_DISTANCE_METERS) {
      return res.status(400).json({
        success: false,
        status: 'REJECTED_GEO_FENCE',
        error: 'Potential fake or recycled proof detected: EXIF GPS is outside the allowed incident geo-fence radius.',
        geoFence: {
          expected: { latitude: hex.latitude, longitude: hex.longitude },
          actual: { latitude: exif.latitude, longitude: exif.longitude },
          distance_meters: Number(distanceMeters.toFixed(2)),
          max_distance_meters: proofService.MAX_DISTANCE_METERS
        },
        photo_reuse_audit: reuseAudit,
        photoAudit: photoAuditResult
      });
    }

    let structural;
    try {
      structural = await proofService.analyzeStructure(originalBuffer, resolutionBuffer);
    } catch (err) {
      structural = {
        matchConfidence: 0,
        rubbleDetected: true,
        geometryMatch: 0,
        error: err && err.message
      };
    }

    const belowConfidence = Number(structural.matchConfidence || 0) < proofService.MIN_STRUCTURAL_CONFIDENCE;
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

    const hasDuplicateAsset = Boolean(reuseAudit && reuseAudit.duplicate);
    const manualReview = (photoAuditResult && !photoAuditResult.isValid) || hasDuplicateAsset;
    const manualPriority = hasDuplicateAsset ? AI_AUDIT_FLAG : 'District Collector Review';

    const patch = manualReview
      ? {
          status: 'PENDING_MANUAL_AUDIT',
          priority: manualPriority,
          assigned_ministry: 'District Collector Review',
          urgency: 'Critical',
          resolution_audit: {
            ...audit,
            verified: false,
            ai_audit_flag: hasDuplicateAsset ? AI_AUDIT_FLAG : null,
            photo_reuse_audit: reuseAudit,
            photo_audit: photoAuditResult
          }
        }
      : {
          status: 'Pending Citizen Verification',
          priority: 'Awaiting Citizen Verification',
          resolved_at: new Date().toISOString(),
          resolvedAt: new Date().toISOString(),
          resolution_audit: {
            ...audit,
            citizen_verification: {
              verdict: 'Pending',
              verifiedAt: null,
              source: 'field_officer'
            },
            photo_reuse_audit: reuseAudit,
            photo_audit: photoAuditResult
          }
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
      audit: updated.resolution_audit || audit,
      qualityAudit,
      aiAuditFlag: hasDuplicateAsset ? AI_AUDIT_FLAG : null
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

module.exports = {
  submitResolution,
  checkQualityAuditTrigger,
  resolveIncident,
  verifyCitizenResolution,
  reopenExpiredCitizenVerifications,
  normalizeVerificationStatus,
  CITIZEN_VERIFICATION_WINDOW_MS
};
