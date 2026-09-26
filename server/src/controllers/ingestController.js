/**
 * Jan-Sankalp AI — Ingest Controller
 * ------------------------------------------------------------------
 * POST /api/v1/ingest
 * Parses the voice transcript, computes the SLA target date, resolves
 * the geospatial region, persists the incident to the database and
 * returns the canonical incident JSON.
 * ------------------------------------------------------------------
 */

const IncidentModel = require('../models/incidentModel');
const { validateCivicImage } = require('./reportController');
const { checkQualityAuditTrigger } = require('./resolutionController');
const {
  parseTranscript,
  computeSlaTargetDate,
  resolveRegion
} = require('../services/civicService');
const { detectVulnerabilityCluster, checkSpatialDuplication } = require('../services/spatialAnalytics');
const { auditImageReuse, AI_AUDIT_FLAG } = require('../services/photoAuditService');

function safeBody(req) {
  return (req && req.body && typeof req.body === 'object') ? req.body : {};
}

function resolveIngestRegion(parsed, body) {
  if (parsed.region) return parsed.region;
  if (parsed.locationName) {
    return resolveRegion({ locationName: parsed.locationName });
  }
  if (body.locationName) {
    return resolveRegion({
      locationName: body.locationName,
      coordinates: Array.isArray(body.coordinates) ? body.coordinates : null
    });
  }
  if (body.h3Index) return resolveRegion({ h3Index: body.h3Index });
  return resolveRegion({
    coordinates: Array.isArray(body.coordinates) ? body.coordinates : null,
    latitude: body.latitude,
    longitude: body.longitude
  });
}

async function ingest(req, res) {
  try {
    const body = safeBody(req);
    const transcript = String(body.transcript || '').trim();

    if (!transcript) {
      return res.status(400).json({
        success: false,
        error: 'Transcript cannot be empty.'
      });
    }

    // 1. Parse transcript entities.
    const parsed = parseTranscript(transcript);

    // 2. Resolve region.
    //    Text-derived locations must override stale client coordinates (often
    //    the initial Delhi map centre). Unknown cities retain their name and
    //    are left ungeocoded rather than being assigned a false location.
    const region = resolveIngestRegion(parsed, body);

    const category = parsed.region ? parsed.region.category : (body.category || parsed.category || region.category);
    const urgency = parsed.region ? parsed.region.urgency : (body.urgency || parsed.urgency || region.urgency);
    const ministry = parsed.region ? parsed.region.targetMinistry : (body.assigned_ministry || parsed.ministry || region.targetMinistry);
    const assignedContractor = body.assignedContractor || body.assigned_contractor || body.contractor || 'Municipal Works Contractor';
    const deadline = body.deadline || body.deadline_at || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    // 3. Compute SLA target completion date.
    const targetCompletionDate =
      body.target_completion_date || computeSlaTargetDate(urgency);

    const civicValidation = await validateCivicImage(
      body.original_photo || body.originalImage || body.image || null,
      { transcript, category, locationName: parsed.locationName || body.locationName || region.label, body, region }
    );

    if (!civicValidation.isValid) {
      return res.status(400).json({
        success: false,
        status: civicValidation.status,
        error: civicValidation.reason,
        validation: civicValidation
      });
    }

    const qualityAudit = await checkQualityAuditTrigger({
      h3Index: region.h3Index,
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

    // 4. Check for spatial deduplication before creating new incident
    const tempIncident = {
      transcript,
      h3_index: region.h3Index,
      latitude: region.centerLat,
      longitude: region.centerLng,
      location_name: parsed.locationName || body.locationName || region.label
    };

    const deduplicationCheck = await checkSpatialDuplication(tempIncident);

    if (deduplicationCheck.isDuplicate) {
      // Increment upvote count on existing incident
      const existingIncident = await IncidentModel.incrementUpvoteCount(deduplicationCheck.existingIncident.id);
      const updatedPayload = IncidentModel.toIncidentPayload(existingIncident);

      return res.status(200).json({
        success: true,
        status: 'DUPLICATE_LINKED',
        ticketId: deduplicationCheck.existingIncident.id,
        data: updatedPayload,
        deduplicationInfo: {
          distance: deduplicationCheck.distance,
          h3Index: deduplicationCheck.h3Index,
          reason: deduplicationCheck.reason
        }
      });
    }

    // 5. Persist to the database.
    const originalPhoto = body.original_photo || body.originalImage || body.image || null;
    const reuseAudit = await auditImageReuse(originalPhoto, await (IncidentModel.findAllForPhotoAudit || IncidentModel.findAll).call(IncidentModel));

    const incident = await IncidentModel.create({
      transcript,
      category,
      urgency,
      status: reuseAudit.duplicate ? 'PENDING_MANUAL_AUDIT' : (body.status || 'Under Survey'),
      location_name: parsed.locationName || body.locationName || region.label,
      h3_index: region.h3Index,
      latitude: region.centerLat,
      longitude: region.centerLng,
      assigned_ministry: ministry,
      assignedContractor,
      deadline,
      target_completion_date: targetCompletionDate,
      original_photo: originalPhoto,
      penaltyStatus: 'On Track',
      penaltyTier: null,
      priority: reuseAudit.duplicate ? AI_AUDIT_FLAG : null,
      resolution_audit: reuseAudit.duplicate ? {
        ai_audit_flag: AI_AUDIT_FLAG,
        image_audit: reuseAudit,
        verified: false
      } : null
    });

    // 6. Check for vulnerability cluster (early-warning cascading risk)
    const clusterResult = await detectVulnerabilityCluster(incident);

    // 7. Return incident JSON with cluster information.
    return res.status(201).json({
      success: true,
      deduplicated: false,
      status: incident.status,
      data: incident,
      vulnerabilityCluster: clusterResult.isCluster ? clusterResult : null,
      aiAuditFlag: reuseAudit.duplicate ? AI_AUDIT_FLAG : null
    });
  } catch (err) {
    console.error('[ingest] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Ingestion failed.',
      details: err.message
    });
  }
}

module.exports = { ingest, resolveIngestRegion };