/**
 * Jan-Sankalp AI — Geospatial Controller
 * ------------------------------------------------------------------
 * GET /api/v1/incidents        → all reported incidents from the DB.
 * GET /api/v1/incidents/:id    → single incident.
 * GET /api/v1/heatmap          → GeoJSON feature collection combining
 *                                DB incidents with monitored regions.
 * POST /api/v1/update-cluster-status → mutate an incident's status.
 * ------------------------------------------------------------------
 */

const IncidentModel = require('../models/incidentModel');
const { triggerStatusWebhook } = require('../services/notificationService');
const {
  URBAN_REGIONS,
  buildPolygonForRegion,
  formatDisplayDate
} = require('../services/civicService');

function safeBody(req) {
  return (req && req.body && typeof req.body === 'object') ? req.body : {};
}

// GET /api/v1/incidents
async function listIncidents(req, res) {
  try {
    const incidents = await IncidentModel.findAll();
    return res.json({
      success: true,
      count: incidents.length,
      data: incidents
    });
  } catch (err) {
    console.error('[incidents] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Could not fetch incidents.',
      details: err.message
    });
  }
}

// GET /api/v1/incidents/:id
async function getIncident(req, res) {
  try {
    const incident = await IncidentModel.findById(req.params.id);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }
    return res.json({ success: true, data: incident });
  } catch (err) {
    console.error('[incident:get] Error:', err.message);
    return res.status(500).json({ success: false, error: 'Lookup failed.', details: err.message });
  }
}

// GET /api/v1/heatmap
async function heatmap(req, res) {
  try {
    const incidents = await IncidentModel.findAll();

    const regionFeatures = URBAN_REGIONS.map((region) => ({
      type: 'Feature',
      properties: {
        source: 'monitored-region',
        label: region.label,
        location: region.locationName,
        category: region.category,
        urgency: region.urgency,
        h3Index: region.h3Index,
        centerLat: region.centerLat,
        centerLng: region.centerLng,
        targetMinistry: region.targetMinistry,
        budget: region.budget,
        impactedCitizens: region.impactedCitizens,
        priorityIndex: region.priorityIndex,
        alignmentScore: region.alignmentScore,
        status: 'Pending Survey',
        max_resolution_date: null,
        assigned_ministry: region.targetMinistry
      },
      geometry: {
        type: 'Polygon',
        coordinates: buildPolygonForRegion(region.centerLat, region.centerLng)
      }
    }));

    const incidentFeatures = incidents
      .filter((i) => Number.isFinite(i.latitude) && Number.isFinite(i.longitude))
      .map((i) => ({
        type: 'Feature',
        properties: {
          source: 'incident',
          id: i.id,
          label: i.location_name,
          location: i.location_name,
          category: i.category,
          urgency: i.urgency,
          h3Index: i.h3_index,
          centerLat: i.latitude,
          centerLng: i.longitude,
          status: i.status,
          assigned_ministry: i.assigned_ministry,
          max_resolution_date: i.target_completion_date,
          created_at: i.created_at
        },
        geometry: {
          type: 'Polygon',
          coordinates: buildPolygonForRegion(i.latitude, i.longitude, 0.12)
        }
      }));

    return res.json({
      type: 'FeatureCollection',
      features: [...regionFeatures, ...incidentFeatures]
    });
  } catch (err) {
    console.error('[heatmap] Error:', err.message);
    return res.status(500).json({ success: false, error: 'Heatmap failed.', details: err.message });
  }
}

// POST /api/v1/update-cluster-status
async function updateClusterStatus(req, res) {
  try {
    const body = safeBody(req);
    const { id, status, assigned_ministry, target_completion_date } = body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Incident id is required.' });
    }

    const existing = await IncidentModel.findById(id);
    const previousStatus = existing ? existing.status : null;

    const updated = await IncidentModel.update(id, {
      status: status || null,
      assigned_ministry: assigned_ministry || null,
      target_completion_date: target_completion_date || null
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Incident not found.' });
    }

    const webhook = await triggerStatusWebhook({
      id: updated.id,
      status: updated.status,
      phone: body.phone || null,
      whatsapp: body.whatsapp || null
    }, {
      previousStatus,
      emit: (event) => console.log('[status-webhook]', JSON.stringify(event))
    });

    const message = updated.status === 'Action Taken / Resolved'
      ? `This issue was resolved on ${formatDisplayDate(updated.target_completion_date)} under ${updated.assigned_ministry}.`
      : updated.status === 'Scheduled for Action'
        ? `Government action is underway. Guaranteed completion target date: ${formatDisplayDate(updated.target_completion_date)}.`
        : `Incident status updated to ${updated.status}.`;

    return res.json({ success: true, data: updated, message, webhook });
  } catch (err) {
    console.error('[update-cluster-status] Error:', err.message);
    return res.status(500).json({ success: false, error: 'Update failed.', details: err.message });
  }
}

module.exports = { listIncidents, getIncident, heatmap, updateClusterStatus };