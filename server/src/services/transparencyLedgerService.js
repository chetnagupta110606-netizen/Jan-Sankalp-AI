const crypto = require('crypto');

function normalizeText(value, fallback = 'Unknown') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function isResolvedStatus(status = '') {
  const value = String(status || '').trim();
  return value === 'Resolved' || value === 'Action Taken / Resolved' || value.includes('Resolved');
}

function deriveSlaStatus(incident = {}) {
  const status = String(incident.status || '').trim();
  const penalty = String(incident.penaltyStatus || incident.penalty_status || 'On Track').trim();
  const resolvedAt = incident.resolvedAt || incident.resolved_at;

  if (status.includes('SLA Breached') || penalty.includes('SLA Breached')) {
    return 'SLA Breached';
  }
  if (isResolvedStatus(status) || resolvedAt) {
    return 'Resolved';
  }
  if (!status || status === 'Pending Survey' || status.includes('Under Survey') || status.includes('Scheduled for Action') || status.includes('Assigned') || status.includes('Pending Citizen Verification')) {
    return 'In Progress';
  }
  return 'On Track';
}

function buildLedgerHash(entry = {}) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(entry))
    .digest('hex');
}

function buildTransparencyLedgerReport(incidents = []) {
  const records = Array.isArray(incidents) ? incidents : [];
  const statusBreakdown = {};
  const slaStatusBreakdown = {
    'On Track': 0,
    'In Progress': 0,
    Resolved: 0,
    'SLA Breached': 0
  };

  let totalResolvedIncidents = 0;
  let totalPenalties = 0;

  const ledger = records.map((incident) => {
    const status = normalizeText(incident.status || 'Pending Survey', 'Pending Survey');
    const penaltyStatus = normalizeText(incident.penaltyStatus || incident.penalty_status || 'On Track', 'On Track');
    const slaStatus = deriveSlaStatus(incident);

    statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    slaStatusBreakdown[slaStatus] = (slaStatusBreakdown[slaStatus] || 0) + 1;

    if (isResolvedStatus(status) || incident.resolvedAt || incident.resolved_at) {
      totalResolvedIncidents += 1;
    }

    if (status.includes('SLA Breached') || penaltyStatus.includes('SLA Breached')) {
      totalPenalties += 1;
    }

    const entry = {
      incidentId: incident.id || null,
      title: normalizeText(incident.category || incident.transcript || 'Public works incident', 'Public works incident'),
      location: normalizeText(incident.location_name || incident.location || 'District office', 'District office'),
      contractor: normalizeText(incident.assignedContractor || incident.assigned_contractor || 'Unassigned Contractor', 'Unassigned Contractor'),
      status,
      penaltyStatus,
      slaStatus,
      resolvedAt: incident.resolvedAt || incident.resolved_at || null,
      immutable: true,
      auditHash: buildLedgerHash({
        incidentId: incident.id || null,
        status,
        penaltyStatus,
        slaStatus,
        resolvedAt: incident.resolvedAt || incident.resolved_at || null,
        contractor: normalizeText(incident.assignedContractor || incident.assigned_contractor || 'Unassigned Contractor', 'Unassigned Contractor')
      })
    };

    return entry;
  });

  const summary = {
    totalIncidents: records.length,
    totalResolvedIncidents,
    totalPenalties,
    resolvedRate: records.length ? Math.round((totalResolvedIncidents / records.length) * 100) : 0,
    statusBreakdown,
    slaStatusBreakdown,
    ledger
  };

  const generatedAt = new Date().toISOString();
  const reportText = [
    'Jan-Sankalp AI — RTI Public Ledger Audit Summary',
    `Generated: ${generatedAt}`,
    '',
    'Overview',
    `- Total incidents tracked: ${summary.totalIncidents}`,
    `- Resolved incidents: ${summary.totalResolvedIncidents}`,
    `- Penalties levied: ${summary.totalPenalties}`,
    `- Resolution rate: ${summary.resolvedRate}%`,
    '',
    'SLA status summary',
    ...Object.entries(summary.slaStatusBreakdown).map(([label, count]) => `- ${label}: ${count}`),
    '',
    'Immutable ledger entries',
    ...summary.ledger.map((entry, index) => {
      return `${index + 1}. ${entry.title} | Location: ${entry.location} | Contractor: ${entry.contractor} | Status: ${entry.status} | SLA: ${entry.slaStatus} | Penalty: ${entry.penaltyStatus} | Hash: ${entry.auditHash}`;
    })
  ].join('\n');

  return {
    generatedAt,
    summary,
    ledger,
    reportText
  };
}

module.exports = {
  buildTransparencyLedgerReport,
  deriveSlaStatus,
  buildLedgerHash
};
