/**
 * Jan-Sankalp AI — Spatial Analytics Service
 * ------------------------------------------------------------------
 * Implements H3-based spatial neighbor clustering for early-warning
 * cascading risk detection and spatial deduplication.
 * ------------------------------------------------------------------
 */

const h3 = require('h3-js');
const IncidentModel = require('../models/incidentModel');

// Monsoon-related keywords that trigger vulnerability cluster detection
const MONSOON_RISK_KEYWORDS = [
  'dampness', 'damp', 'moisture', 'seepage',
  'wall cracks', 'crack', 'cracks', 'structural damage',
  'waterlogging', 'waterlog', 'flood', 'flooding',
  'leak', 'leaking', 'roof leak', 'ceiling leak'
];

// H3 resolution level for 500m approximate coverage
// Resolution 8 ≈ 0.74km edge length, Resolution 9 ≈ 0.25km edge length
const H3_RESOLUTION = 9;
const DEDUPLICATION_RESOLUTION = 10; // Higher resolution for deduplication (~100m)
const K_RING_DISTANCE = 1; // Check immediate neighbors
const CLUSTER_THRESHOLD = 3; // Minimum incidents to trigger cluster
const TIME_WINDOW_DAYS = 7; // Look back 7 days
const DEDUPLICATION_DISTANCE_METERS = 20; // 20 meters for deduplication

/**
 * Check if a transcript contains monsoon risk keywords
 */
function containsMonsoonRiskKeywords(transcript) {
  const text = String(transcript || '').toLowerCase();
  return MONSOON_RISK_KEYWORDS.some(keyword => text.includes(keyword));
}

/**
 * Spatial deduplication check using H3 indexing
 * Returns existing incident if duplicate found within distance threshold
 */
async function checkSpatialDuplication(newIncident) {
  try {
    // Get high-resolution H3 index for deduplication
    const h3Index = newIncident.h3_index || latLngToH3(
      newIncident.latitude,
      newIncident.longitude,
      DEDUPLICATION_RESOLUTION
    );

    if (!h3Index) {
      return { isDuplicate: false, reason: 'Invalid H3 index' };
    }

    // Get all incidents
    const allIncidents = await IncidentModel.findAll();

    // Filter for open incidents and check distance
    const nearbyIncidents = allIncidents.filter(incident => {
      // Skip resolved/closed incidents
      if (incident.status === 'Resolved' || incident.status === 'Closed') {
        return false;
      }

      // Skip the current incident if it has an ID
      if (newIncident.id && incident.id === newIncident.id) {
        return false;
      }

      // Check if coordinates are available
      if (!incident.latitude || !incident.longitude) {
        return false;
      }

      return true;
    });

    if (nearbyIncidents.length === 0) {
      return { isDuplicate: false, reason: 'No nearby open incidents' };
    }

    // Check actual distance for 20m threshold
    for (const incident of nearbyIncidents) {
      const distance = haversineDistance(
        newIncident.latitude,
        newIncident.longitude,
        incident.latitude,
        incident.longitude
      );

      if (distance <= DEDUPLICATION_DISTANCE_METERS) {
        // Found duplicate within threshold
        return {
          isDuplicate: true,
          existingIncident: incident,
          distance: distance,
          h3Index: h3Index,
          reason: `Duplicate found within ${distance.toFixed(1)}m`
        };
      }
    }

    return { isDuplicate: false, reason: 'No incidents within 20m threshold' };

  } catch (err) {
    console.error('[spatial] Deduplication check error:', err.message);
    return { isDuplicate: false, reason: 'Deduplication error', error: err.message };
  }
}

/**
 * Calculate Haversine distance between two coordinates in meters
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get H3 index from coordinates
 */
function latLngToH3(lat, lng, resolution = H3_RESOLUTION) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  try {
    return h3.latLngToCell(lat, lng, resolution);
  } catch (err) {
    console.warn('[spatial] H3 conversion error:', err.message);
    return null;
  }
}

/**
 * Get adjacent H3 cells within k-ring distance
 */
function getAdjacentH3Cells(h3Index, kRing = K_RING_DISTANCE) {
  if (!h3Index) return [];
  try {
    return h3.gridDisk(h3Index, kRing);
  } catch (err) {
    console.warn('[spatial] gridDisk error:', err.message);
    return [];
  }
}

/**
 * Check if an incident is within the time window
 */
function isWithinTimeWindow(incidentDate, days = TIME_WINDOW_DAYS) {
  if (!incidentDate) return false;
  const incidentTime = new Date(incidentDate).getTime();
  const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
  return incidentTime >= cutoffTime;
}

/**
 * Detect vulnerability cluster for a new incident
 * Returns cluster information if a high-risk cluster is detected
 */
async function detectVulnerabilityCluster(newIncident) {
  try {
    // Skip if transcript doesn't contain monsoon risk keywords
    if (!containsMonsoonRiskKeywords(newIncident.transcript)) {
      return { isCluster: false, reason: 'No monsoon risk keywords detected' };
    }

    // Get H3 index for the new incident
    const h3Index = newIncident.h3_index || latLngToH3(
      newIncident.latitude,
      newIncident.longitude
    );

    if (!h3Index) {
      return { isCluster: false, reason: 'Invalid H3 index' };
    }

    // Get adjacent H3 cells
    const adjacentCells = getAdjacentH3Cells(h3Index);
    const allCellsToCheck = [h3Index, ...adjacentCells];

    // Get all incidents
    const allIncidents = await IncidentModel.findAll();

    // Filter incidents within the same H3 cells and time window
    const nearbyIncidents = allIncidents.filter(incident => {
      // Skip the current incident (if it has an ID)
      if (newIncident.id && incident.id === newIncident.id) return false;

      // Check if within time window
      if (!isWithinTimeWindow(incident.created_at, TIME_WINDOW_DAYS)) return false;

      // Check if incident also contains monsoon risk keywords
      if (!containsMonsoonRiskKeywords(incident.transcript)) return false;

      // Check if H3 index matches or is adjacent
      const incidentH3 = incident.h3_index || latLngToH3(
        incident.latitude,
        incident.longitude
      );

      if (!incidentH3) return false;

      // Check if incident H3 is in our search area
      return allCellsToCheck.includes(incidentH3);
    });

    // Add the new incident to count if it has monsoon keywords
    const totalRelevantIncidents = nearbyIncidents.length + 1;

    // Check if threshold is met
    if (totalRelevantIncidents >= CLUSTER_THRESHOLD) {
      // Build cluster metadata
      const clusterInfo = {
        isCluster: true,
        clusterType: 'High-Risk Monsoon Vulnerability Cluster',
        h3Index: h3Index,
        adjacentCells: adjacentCells,
        incidentCount: totalRelevantIncidents,
        timeWindowDays: TIME_WINDOW_DAYS,
        radiusMeters: approximateH3RadiusMeters(H3_RESOLUTION),
        detectedAt: new Date().toISOString(),
        locationName: newIncident.location_name || 'Unknown location',
        affectedArea: deriveAffectedArea(newIncident, nearbyIncidents),
        recommendedAction: 'Automated pre-monsoon audit triggered for pre-1950 heritage structures'
      };

      console.log('[spatial] ⚠️ Vulnerability cluster detected:', clusterInfo);
      return clusterInfo;
    }

    return {
      isCluster: false,
      reason: `Insufficient incidents (${totalRelevantIncidents}/${CLUSTER_THRESHOLD} required)`,
      incidentCount: totalRelevantIncidents
    };

  } catch (err) {
    console.error('[spatial] Cluster detection error:', err.message);
    return { isCluster: false, reason: 'Detection error', error: err.message };
  }
}

/**
 * Approximate radius in meters for H3 resolution
 */
function approximateH3RadiusMeters(resolution) {
  // Approximate edge lengths in meters for different resolutions
  const radii = {
    0: 1107449, 1: 436183, 2: 172194, 3: 68083, 4: 26862,
    5: 10609, 6: 4186, 7: 1653, 8: 653, 9: 258, 10: 102
  };
  return radii[resolution] || 500;
}

/**
 * Derive affected area name from incidents
 */
function deriveAffectedArea(newIncident, nearbyIncidents) {
  const allIncidents = [newIncident, ...nearbyIncidents];
  const locationNames = allIncidents
    .map(i => i.location_name)
    .filter(name => name && name !== 'Unassigned Region');

  if (locationNames.length === 0) return 'Unknown area';

  // Extract unique location parts
  const uniqueParts = [...new Set(locationNames.flatMap(name => 
    name.split(/[/,]/).map(part => part.trim())
  ))];

  return uniqueParts.slice(0, 3).join(' / ') || locationNames[0];
}

/**
 * Batch check all recent incidents for clusters
 * Useful for periodic background checks
 */
async function scanForClusters() {
  try {
    const allIncidents = await IncidentModel.findAll();
    const recentIncidents = allIncidents.filter(incident =>
      isWithinTimeWindow(incident.created_at, TIME_WINDOW_DAYS)
    );

    const clusters = [];
    const processedH3Cells = new Set();

    for (const incident of recentIncidents) {
      // Only check incidents with monsoon risk keywords
      if (!containsMonsoonRiskKeywords(incident.transcript)) continue;

      const h3Index = incident.h3_index || latLngToH3(
        incident.latitude,
        incident.longitude
      );

      if (!h3Index || processedH3Cells.has(h3Index)) continue;

      const clusterResult = await detectVulnerabilityCluster(incident);
      if (clusterResult.isCluster) {
        clusters.push(clusterResult);
        // Mark all cells in this cluster as processed
        processedH3Cells.add(h3Index);
        clusterResult.adjacentCells.forEach(cell => processedH3Cells.add(cell));
      }
    }

    return {
      totalIncidents: recentIncidents.length,
      clustersFound: clusters.length,
      clusters
    };

  } catch (err) {
    console.error('[spatial] Cluster scan error:', err.message);
    return { totalIncidents: 0, clustersFound: 0, clusters: [], error: err.message };
  }
}

module.exports = {
  detectVulnerabilityCluster,
  scanForClusters,
  checkSpatialDuplication,
  containsMonsoonRiskKeywords,
  latLngToH3,
  getAdjacentH3Cells,
  haversineDistance,
  MONSOON_RISK_KEYWORDS,
  H3_RESOLUTION,
  DEDUPLICATION_RESOLUTION,
  K_RING_DISTANCE,
  CLUSTER_THRESHOLD,
  TIME_WINDOW_DAYS,
  DEDUPLICATION_DISTANCE_METERS
};
