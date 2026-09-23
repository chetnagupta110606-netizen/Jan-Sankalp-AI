/**
 * Jan-Sankalp AI — Analytics Controller
 * ------------------------------------------------------------------
 * Aggregates real incident records into dashboard-friendly metrics for
 * historical monthly trends and current status distribution.
 * ------------------------------------------------------------------
 */

const db = require('../config/database');

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

module.exports = { getAnalyticsMetrics };
