/**
 * Jan-Sankalp AI — Escalation Service
 * ------------------------------------------------------------------
 * Automated SLA escalation triggers for high-priority tickets and
 * vulnerability clusters that remain unresolved beyond threshold.
 * ------------------------------------------------------------------
 */

const IncidentModel = require('../models/incidentModel');
const { detectVulnerabilityCluster } = require('./spatialAnalytics');

// Escalation thresholds
const HIGH_PRIORITY_URGENCY = ['Critical', 'High'];
const ESCALATION_HOURS = 48; // 48 hours for escalation
const ESCALATION_STATUS = 'DISTRICT_COLLECTOR_ALERT';

// Escalation event log (in production, this would go to a database)
const escalationLog = [];

/**
 * Check if an incident should be escalated
 */
function shouldEscalate(incident) {
  // Skip already escalated incidents
  if (incident.status === ESCALATION_STATUS) {
    return false;
  }

  // Check if high priority
  const isHighPriority = HIGH_PRIORITY_URGENCY.includes(incident.urgency);
  if (!isHighPriority) {
    return false;
  }

  // Check if unresolved
  const isUnresolved = incident.status !== 'Resolved' && incident.status !== 'Closed';
  if (!isUnresolved) {
    return false;
  }

  // Check time threshold
  const createdTime = new Date(incident.created_at).getTime();
  const currentTime = Date.now();
  const hoursSinceCreation = (currentTime - createdTime) / (1000 * 60 * 60);

  return hoursSinceCreation >= ESCALATION_HOURS;
}

/**
 * Escalate an incident to District Collector Alert
 */
async function escalateIncident(incident, reason = '') {
  try {
    const escalatedIncident = await IncidentModel.update(incident.id, {
      status: ESCALATION_STATUS,
      priority: 'CRITICAL'
    });

    // Log escalation event
    const escalationEvent = {
      incidentId: incident.id,
      previousStatus: incident.status,
      newStatus: ESCALATION_STATUS,
      escalatedAt: new Date().toISOString(),
      reason: reason || `Unresolved for ${ESCALATION_HOURS}+ hours`,
      urgency: incident.urgency,
      location: incident.location_name
    };

    escalationLog.push(escalationEvent);
    console.log('[escalation] ⚠️ Incident escalated:', escalationEvent);

    return {
      success: true,
      incident: escalatedIncident,
      escalationEvent
    };
  } catch (err) {
    console.error('[escalation] Escalation error:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Scan all incidents for escalation candidates
 */
async function scanForEscalationCandidates() {
  try {
    const allIncidents = await IncidentModel.findAll();
    const escalationCandidates = [];

    for (const incident of allIncidents) {
      // Check for escalation based on SLA
      if (shouldEscalate(incident)) {
        escalationCandidates.push({
          incident,
          reason: `Unresolved high-priority ticket for ${ESCALATION_HOURS}+ hours`
        });
      }

      // Check for vulnerability cluster escalation
      const clusterResult = await detectVulnerabilityCluster(incident);
      if (clusterResult.isCluster && shouldEscalate(incident)) {
        escalationCandidates.push({
          incident,
          reason: `High-Risk Monsoon Vulnerability Cluster unresolved for ${ESCALATION_HOURS}+ hours`,
          clusterInfo: clusterResult
        });
      }
    }

    return {
      totalIncidents: allIncidents.length,
      escalationCandidates: escalationCandidates.length,
      candidates: escalationCandidates
    };
  } catch (err) {
    console.error('[escalation] Scan error:', err.message);
    return {
      totalIncidents: 0,
      escalationCandidates: 0,
      candidates: [],
      error: err.message
    };
  }
}

/**
 * Process escalation candidates and automatically escalate
 */
async function processEscalations() {
  try {
    const scanResult = await scanForEscalationCandidates();
    const results = [];

    for (const candidate of scanResult.candidates) {
      const escalationResult = await escalateIncident(
        candidate.incident,
        candidate.reason
      );
      results.push(escalationResult);
    }

    return {
      scanned: scanResult.totalIncidents,
      escalated: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  } catch (err) {
    console.error('[escalation] Process error:', err.message);
    return {
      scanned: 0,
      escalated: 0,
      failed: 1,
      error: err.message
    };
  }
}

/**
 * Get escalation log
 */
function getEscalationLog() {
  return escalationLog;
}

/**
 * Start background escalation scheduler
 * In production, this would use a proper job scheduler like node-cron
 */
let escalationInterval = null;

function startEscalationScheduler(intervalMinutes = 60) {
  if (escalationInterval) {
    console.log('[escalation] Scheduler already running');
    return;
  }

  console.log(`[escalation] Starting scheduler (every ${intervalMinutes} minutes)`);
  escalationInterval = setInterval(async () => {
    console.log('[escalation] Running scheduled escalation check...');
    const result = await processEscalations();
    console.log('[escalation] Scheduled check complete:', result);
  }, intervalMinutes * 60 * 1000);

  // Run initial check
  processEscalations();
}

function stopEscalationScheduler() {
  if (escalationInterval) {
    clearInterval(escalationInterval);
    escalationInterval = null;
    console.log('[escalation] Scheduler stopped');
  }
}

module.exports = {
  shouldEscalate,
  escalateIncident,
  scanForEscalationCandidates,
  processEscalations,
  getEscalationLog,
  startEscalationScheduler,
  stopEscalationScheduler,
  ESCALATION_HOURS,
  ESCALATION_STATUS
};
