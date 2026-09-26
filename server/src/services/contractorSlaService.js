/**
 * Jan-Sankalp AI — Contractor SLA Audit Service
 * ---------------------------------------------------------------
 * Monitors assigned contractor tasks and marks overdue work as SLA
 * breached when a deadline passes without a verified resolution.
 */

const IncidentModel = require('../models/incidentModel');

const SLA_AUDIT_LOG = [];
const CONTRACTOR_PENALTY_TIERS = [
  { maxHours: 24, label: 'Tier 1: Warning' },
  { maxHours: 72, label: 'Tier 2: Municipal Fine' },
  { maxHours: Infinity, label: 'Tier 3: Escalated Contract Default' }
];

function computePenaltyTier(delayHours) {
  if (!Number.isFinite(delayHours) || delayHours < 0) return 'Tier 1: Warning';
  const tier = CONTRACTOR_PENALTY_TIERS.find((entry) => delayHours <= entry.maxHours) || CONTRACTOR_PENALTY_TIERS[CONTRACTOR_PENALTY_TIERS.length - 1];
  return tier.label;
}

function statusFromIncident(incident = {}) {
  const status = String(incident.status || '').trim();
  return status || 'Assigned';
}

function hasValidatedResolution(incident = {}) {
  const status = statusFromIncident(incident);
  const resolvedAt = incident.resolvedAt || incident.resolved_at || null;
  const isResolved = status === 'Resolved' || status === 'Action Taken / Resolved' || status === 'Completed';
  return Boolean(isResolved && (resolvedAt || incident.resolution_proof_path || incident.resolution_proof_path));
}

async function auditContractorSla(model = IncidentModel) {
  try {
    const incidents = await model.findAll();
    let updated = 0;
    const auditEvents = [];

    for (const incident of incidents) {
      const contractorName = incident.assignedContractor || incident.assigned_contractor || null;
      const deadline = incident.deadline || incident.deadline_at || null;
      const penaltyStatus = String(incident.penaltyStatus || incident.penalty_status || 'On Track').trim();
      const currentStatus = statusFromIncident(incident);

      if (!contractorName || !deadline) {
        continue;
      }

      const deadlineMoment = new Date(deadline).getTime();
      const now = Date.now();
      const passedDeadline = Number.isFinite(deadlineMoment) && deadlineMoment <= now;
      const overdueResolved = passedDeadline && hasValidatedResolution(incident);

      if (!passedDeadline || overdueResolved) {
        continue;
      }

      const delayMs = now - deadlineMoment;
      const delayHours = Math.max(0, delayMs / (1000 * 60 * 60));
      const penaltyTier = computePenaltyTier(delayHours);
      const breachPatch = {
        status: 'SLA Breached',
        penaltyStatus: 'SLA Breached',
        penaltyTier,
        resolved_at: incident.resolvedAt || incident.resolved_at || null,
        resolvedAt: incident.resolvedAt || incident.resolved_at || null
      };

      await model.update(incident.id, breachPatch);

      const auditEvent = {
        incidentId: incident.id,
        contractor: contractorName,
        previousStatus: currentStatus,
        newStatus: 'SLA Breached',
        deadline,
        breachedAt: new Date().toISOString(),
        delayHours: Number(delayHours.toFixed(2)),
        penaltyTier,
        penaltyStatus: 'SLA Breached'
      };
      SLA_AUDIT_LOG.push(auditEvent);
      auditEvents.push(auditEvent);
      updated += 1;
    }

    return {
      success: true,
      updated,
      checked: incidents.length,
      auditEvents,
      logLength: SLA_AUDIT_LOG.length
    };
  } catch (err) {
    console.error('[sla-audit] Audit failed:', err && err.message);
    return {
      success: false,
      updated: 0,
      checked: 0,
      auditEvents: [],
      error: err && err.message
    };
  }
}

async function processContractorSlaAudit() {
  return auditContractorSla(IncidentModel);
}

function getContractorSlaAuditLog() {
  return [...SLA_AUDIT_LOG];
}

let contractorSlaInterval = null;

function startContractorSlaScheduler(intervalMinutes = 15) {
  if (contractorSlaInterval) {
    console.log('[sla-audit] Scheduler already running');
    return contractorSlaInterval;
  }

  console.log(`[sla-audit] Starting scheduler (every ${intervalMinutes} minutes)`);
  contractorSlaInterval = setInterval(async () => {
    console.log('[sla-audit] Running scheduled contractor SLA check...');
    const result = await processContractorSlaAudit();
    console.log('[sla-audit] Scheduled contractor SLA check complete:', result);
  }, intervalMinutes * 60 * 1000);

  processContractorSlaAudit();
  return contractorSlaInterval;
}

function stopContractorSlaScheduler() {
  if (contractorSlaInterval) {
    clearInterval(contractorSlaInterval);
    contractorSlaInterval = null;
    console.log('[sla-audit] Scheduler stopped');
  }
}

module.exports = {
  auditContractorSla,
  processContractorSlaAudit,
  getContractorSlaAuditLog,
  startContractorSlaScheduler,
  stopContractorSlaScheduler,
  computePenaltyTier,
  CONTRACTOR_PENALTY_TIERS
};
