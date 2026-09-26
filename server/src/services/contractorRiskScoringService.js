const db = require('../config/database');
const { getContractorSlaAuditLog } = require('./contractorSlaService');

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeContractorName(value) {
  const candidate = String(value || '').trim();
  return candidate || 'Unassigned Contractor';
}

function normalizeLocation(value) {
  return String(value || '').trim();
}

function parseDate(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function getUrgencyWeight(value) {
  const status = String(value || '').toLowerCase();
  if (status.includes('high')) return 3;
  if (status.includes('medium')) return 2;
  if (status.includes('low')) return 1;
  return 1;
}

function getRiskLevel(score) {
  if (score >= 80) return 'Critical';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Moderate';
  return 'Low';
}

function summarizeHotspotRisk(incidents = []) {
  if (!incidents.length) return { hotspotRisk: 0, hotspot: null, hotspotCount: 0 };

  const locationSummary = new Map();
  for (const incident of incidents) {
    const location = normalizeLocation(incident.location_name || incident.location || incident.region || 'Unspecified');
    if (!location) continue;
    const bucket = locationSummary.get(location) || {
      location,
      count: 0,
      highPriority: 0,
      breaches: 0,
      weightedUrgency: 0
    };
    bucket.count += 1;
    bucket.weightedUrgency += getUrgencyWeight(incident.urgency || incident.priority || 'Medium');
    if (String(incident.status || '').includes('SLA Breached') || String(incident.penaltyStatus || '').includes('SLA Breached')) {
      bucket.breaches += 1;
    }
    if (String(incident.priority || incident.urgency || '').toLowerCase().includes('high')) {
      bucket.highPriority += 1;
    }
    locationSummary.set(location, bucket);
  }

  let hotspotRisk = 0;
  let hotspot = null;
  let hotspotCount = 0;

  for (const summary of locationSummary.values()) {
    const repeatingFactor = Math.min(100, (summary.count / Math.max(1, incidents.length)) * 100);
    const breachFactor = summary.breaches * 20;
    const severityFactor = summary.highPriority * 10;
    const zoneRisk = clamp(repeatingFactor + breachFactor + severityFactor + (summary.weightedUrgency * 4), 0, 100);
    if (zoneRisk > hotspotRisk) {
      hotspotRisk = zoneRisk;
      hotspot = summary.location;
      hotspotCount = summary.count;
    }
  }

  return { hotspotRisk, hotspot, hotspotCount };
}

function computeContractorRiskProfile(contractorName, incidents = []) {
  const contractor = normalizeContractorName(contractorName);
  const records = incidents.filter((incident) => normalizeContractorName(incident.assignedContractor || incident.assigned_contractor || incident.contractor) === contractor);

  if (!records.length) {
    return {
      contractor,
      riskIndex: 0,
      riskLevel: 'Low',
      warningFlags: [],
      totalAssignments: 0,
      activeAssignments: 0,
      slaBreaches: 0,
      avgResolutionHours: 0,
      hotspot: null,
      hotspotRisk: 0,
      penaltyLogCount: 0,
      historicalAverageDelayHours: 0
    };
  }

  const slaBreaches = records.filter((incident) => {
    const status = String(incident.status || '');
    const penalty = String(incident.penaltyStatus || incident.penalty_status || '');
    return status.includes('SLA Breached') || penalty.includes('SLA Breached');
  }).length;

  const activeAssignments = records.filter((incident) => {
    const status = String(incident.status || '');
    return !status.includes('Resolved') && !status.includes('Completed') && !status.includes('Action Taken');
  }).length;

  const resolutionDurations = [];

  for (const incident of records) {
    const createdAt = parseDate(incident.created_at || incident.createdAt || incident.dateCreated || null);
    const resolvedAt = parseDate(incident.resolvedAt || incident.resolved_at || null);

    if (createdAt && resolvedAt) {
      const elapsedHours = Math.max(0, (resolvedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60));
      if (elapsedHours > 0) {
        resolutionDurations.push(elapsedHours);
      }
      continue;
    }

    if (createdAt) {
      const deadline = parseDate(incident.deadline || incident.deadline_at || null);
      if (deadline && deadline.getTime() >= createdAt.getTime()) {
        const projectedHours = Math.max(0, (deadline.getTime() - createdAt.getTime()) / (1000 * 60 * 60));
        resolutionDurations.push(projectedHours);
      }
    }
  }

  const avgResolutionHours = resolutionDurations.length
    ? resolutionDurations.reduce((sum, hours) => sum + hours, 0) / resolutionDurations.length
    : 0;
  const delayFactor = clamp((slaBreaches / Math.max(1, records.length)) * 100, 0, 100);
  const resolutionFactor = clamp((avgResolutionHours / 72) * 100, 0, 100);
  const hotspotSummary = summarizeHotspotRisk(records);
  const hotspotFactor = hotspotSummary.hotspotRisk || 0;
  const activeFactor = clamp((activeAssignments / Math.max(1, records.length)) * 100, 0, 100);
  const penaltyLogCount = getContractorSlaAuditLog().filter((entry) => String(entry.contractor || '').toLowerCase() === contractor.toLowerCase()).length;
  const penaltyFactor = clamp((penaltyLogCount / Math.max(1, records.length)) * 100, 0, 100);

  const riskIndex = clamp(
    Math.round(
      (delayFactor * 0.35) +
      (resolutionFactor * 0.25) +
      (hotspotFactor * 0.25) +
      (activeFactor * 0.15) +
      (penaltyFactor * 0.05)
    ),
    0,
    100
  );

  const warningFlags = [];
  if (slaBreaches > 0) {
    warningFlags.push('High SLA breach rate');
  }
  if (avgResolutionHours > 72) {
    warningFlags.push('Average resolution time exceeds 72 hours');
  }
  if (hotspotSummary.hotspot) {
    warningFlags.push(`Hotspot exposure in ${hotspotSummary.hotspot}`);
  }
  if (activeAssignments >= Math.max(2, Math.ceil(records.length * 0.5))) {
    warningFlags.push('Multiple active assignments without closure');
  }
  if (penaltyLogCount > 0) {
    warningFlags.push('SLA penalty history recorded');
  }
  if (!warningFlags.length) {
    warningFlags.push('Stable performance with low current risk');
  }

  return {
    contractor,
    riskIndex,
    riskLevel: getRiskLevel(riskIndex),
    warningFlags: warningFlags.slice(0, 4),
    totalAssignments: records.length,
    activeAssignments,
    slaBreaches,
    avgResolutionHours: Number(avgResolutionHours.toFixed(1)),
    hotspot: hotspotSummary.hotspot,
    hotspotRisk: hotspotSummary.hotspotRisk,
    penaltyLogCount,
    historicalAverageDelayHours: Number(avgResolutionHours.toFixed(1))
  };
}

async function computeContractorRiskScores(dbLayer = db) {
  try {
    const incidents = await dbLayer.getAllIncidents();
    const grouped = new Map();

    for (const incident of incidents) {
      const contractorName = normalizeContractorName(incident.assignedContractor || incident.assigned_contractor || incident.contractor || null);
      if (!contractorName || contractorName === 'Unassigned Contractor') {
        continue;
      }
      if (!grouped.has(contractorName)) {
        grouped.set(contractorName, []);
      }
      grouped.get(contractorName).push(incident);
    }

    const contractors = Array.from(grouped.entries())
      .map(([contractorName, contractorIncidents]) => computeContractorRiskProfile(contractorName, contractorIncidents))
      .sort((a, b) => b.riskIndex - a.riskIndex || a.contractor.localeCompare(b.contractor));

    const highestRisk = contractors[0] || null;
    const summary = {
      totalContractors: contractors.length,
      criticalRiskCount: contractors.filter((entry) => entry.riskLevel === 'Critical').length,
      highRiskCount: contractors.filter((entry) => entry.riskLevel === 'High').length,
      highestRisk: highestRisk ? highestRisk.contractor : null,
      highestRiskIndex: highestRisk ? highestRisk.riskIndex : 0
    };

    return {
      success: true,
      generatedAt: new Date().toISOString(),
      summary,
      contractors
    };
  } catch (error) {
    console.error('[contractor-risk] failed to compute risk scores:', error && error.message);
    return {
      success: false,
      generatedAt: new Date().toISOString(),
      summary: { totalContractors: 0, criticalRiskCount: 0, highRiskCount: 0, highestRisk: null, highestRiskIndex: 0 },
      contractors: [],
      error: error && error.message
    };
  }
}

module.exports = {
  computeContractorRiskProfile,
  computeContractorRiskScores,
  summarizeHotspotRisk
};
