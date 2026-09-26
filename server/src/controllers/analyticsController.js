/**
 * Jan-Sankalp AI — Analytics Controller
 * ------------------------------------------------------------------
 * Aggregates real incident records into dashboard-friendly metrics for
 * historical monthly trends and current status distribution.
 * ------------------------------------------------------------------
 */

const db = require('../config/database');
const { buildTransparencyLedgerReport } = require('../services/transparencyLedgerService');

function normalizeStatus(status = '') {
  const value = String(status || '').trim();
  if (!value) return 'Unknown';
  return value;
}

function monthKey(dateValue) {
  const date = new Date(dateValue);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getContractorLedger(req, res) {
  try {
    const dbLayer = (req && req.db) || db;
    const incidents = await dbLayer.getAllIncidents();

    const ledgerMap = new Map();
    let activePenalties = 0;

    for (const incident of incidents) {
      const contractorName = String(incident.assignedContractor || incident.assigned_contractor || 'Unassigned Contractor').trim() || 'Unassigned Contractor';
      const status = String(incident.status || 'Pending Survey').trim();
      const penaltyStatus = String(incident.penaltyStatus || incident.penalty_status || 'On Track').trim();
      const deadline = incident.deadline || incident.deadline_at || null;
      const resolvedAt = incident.resolvedAt || incident.resolved_at || null;

      if (!ledgerMap.has(contractorName)) {
        ledgerMap.set(contractorName, {
          contractor: contractorName,
          totalAssignments: 0,
          resolvedAssignments: 0,
          activeAssignments: 0,
          slaBreaches: 0,
          completionRate: 0,
          latestDeadline: null,
          penaltyStatus: penaltyStatus
        });
      }

      const entry = ledgerMap.get(contractorName);
      entry.totalAssignments += 1;
      entry.latestDeadline = deadline && (!entry.latestDeadline || new Date(deadline) > new Date(entry.latestDeadline)) ? deadline : entry.latestDeadline;
      if (status === 'Resolved' || status === 'Action Taken / Resolved' || resolvedAt) {
        entry.resolvedAssignments += 1;
      }
      if (status !== 'Resolved' && status !== 'Action Taken / Resolved' && status !== 'Completed') {
        entry.activeAssignments += 1;
      }
      if (status === 'SLA Breached' || penaltyStatus === 'SLA Breached') {
        entry.slaBreaches += 1;
        activePenalties += 1;
      }
      if (entry.penaltyStatus === 'On Track' && penaltyStatus !== 'On Track') {
        entry.penaltyStatus = penaltyStatus;
      }
      entry.completionRate = entry.totalAssignments > 0
        ? Math.round((entry.resolvedAssignments / entry.totalAssignments) * 100)
        : 0;
    }

    const ledger = Array.from(ledgerMap.values()).map((entry) => ({
      contractor: entry.contractor,
      totalAssignments: entry.totalAssignments,
      activeAssignments: entry.activeAssignments,
      resolvedAssignments: entry.resolvedAssignments,
      completionRate: entry.completionRate,
      slaBreaches: entry.slaBreaches,
      latestDeadline: entry.latestDeadline,
      penaltyStatus: entry.penaltyStatus
    })).sort((a, b) => b.completionRate - a.completionRate || a.contractor.localeCompare(b.contractor));

    const payload = {
      success: true,
      generatedAt: new Date().toISOString(),
      totalContractors: ledger.length,
      activePenalties,
      ledger
    };

    if (res && typeof res.json === 'function') {
      return res.json(payload);
    }
    return payload;
  } catch (error) {
    console.error('[analytics] Contractor ledger failed:', error && error.message);
    if (res && typeof res.status === 'function') {
      return res.status(500).json({ success: false, error: 'Failed to load contractor ledger.', details: error && error.message });
    }
    return { success: false, error: 'Failed to load contractor ledger.', details: error && error.message };
  }
}

async function getTransparencyLedger(req, res) {
  try {
    const dbLayer = (req && req.db) || db;
    const incidents = await dbLayer.getAllIncidents();
    const report = buildTransparencyLedgerReport(incidents);
    const payload = {
      success: true,
      generatedAt: report.generatedAt,
      summary: report.summary,
      ledger: report.ledger,
      reportText: report.reportText,
      title: 'RTI Public Portal & Transparency Ledger'
    };

    if (res && typeof res.json === 'function') {
      return res.json(payload);
    }

    return payload;
  } catch (error) {
    console.error('[analytics] Transparency ledger failed:', error && error.message);
    if (res && typeof res.status === 'function') {
      return res.status(500).json({
        success: false,
        error: 'Failed to load the transparency ledger.',
        details: error && error.message
      });
    }
    return { success: false, error: 'Failed to load the transparency ledger.', details: error && error.message };
  }
}

async function getAnalyticsMetrics(req, res) {
  try {
    const dbLayer = (req && req.db) || db;
    const incidents = await dbLayer.getAllIncidents();

    const currentStatusBreakdown = {};
    const monthlySummary = new Map();

    for (const incident of incidents) {
      const status = normalizeStatus(incident.status);
      currentStatusBreakdown[status] = (currentStatusBreakdown[status] || 0) + 1;

      const period = monthKey(incident.created_at || new Date().toISOString());
      if (!period) continue;

      const bucket = monthlySummary.get(period) || { period, count: 0, resolved: 0, pending: 0 };
      bucket.count += 1;
      if (status === 'Resolved' || status === 'Action Taken / Resolved') {
        bucket.resolved += 1;
      }
      if (status === 'Pending Survey' || status === 'Under Survey' || status === 'Scheduled for Action') {
        bucket.pending += 1;
      }
      monthlySummary.set(period, bucket);
    }

    const historical = Array.from(monthlySummary.values())
      .sort((a, b) => a.period.localeCompare(b.period));

    const summary = {
      totalIncidents: incidents.length,
      resolvedCount: currentStatusBreakdown.Resolved || currentStatusBreakdown['Action Taken / Resolved'] || 0,
      openCount: Object.entries(currentStatusBreakdown)
        .filter(([status]) => status !== 'Resolved' && status !== 'Action Taken / Resolved')
        .reduce((sum, [, count]) => sum + count, 0),
      currentStatusBreakdown
    };

    const payload = {
      success: true,
      generatedAt: new Date().toISOString(),
      totalIncidents: incidents.length,
      summary,
      currentStatusBreakdown,
      historical
    };

    if (res && typeof res.json === 'function') {
      return res.json(payload);
    }

    return payload;
  } catch (error) {
    console.error('[analytics] Failed to aggregate metrics:', error && error.message);
    if (res && typeof res.status === 'function') {
      return res.status(500).json({ success: false, error: 'Failed to load analytics metrics.', details: error && error.message });
    }
    return { success: false, error: 'Failed to load analytics metrics.', details: error && error.message };
  }
}

module.exports = { getAnalyticsMetrics, getContractorLedger, getTransparencyLedger };
