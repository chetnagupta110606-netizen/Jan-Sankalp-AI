const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveIncident } = require('../src/controllers/resolutionController');
const { getAnalyticsMetrics, getContractorLedger } = require('../src/controllers/analyticsController');
const { buildIncidentCsv } = require('../src/controllers/reportController');
const { auditContractorSla } = require('../src/services/contractorSlaService');

test('resolveIncident updates an incident with proof path and notes', async () => {
  const updated = await resolveIncident({
    params: { incidentId: '42' },
    body: { notes: 'Repair completed on site.' },
    file: { path: '/uploads/resolutions/42-proof.jpg' },
    db: {
      getIncidentById: async (id) => ({
        id: Number(id),
        status: 'Under Survey',
        transcript: 'Broken drain near market road',
        created_at: '2026-01-10T00:00:00.000Z'
      }),
      updateIncident: async (id, patch) => ({ id: Number(id), ...patch })
    }
  });

  assert.equal(updated.success, true);
  assert.equal(updated.data.status, 'Resolved');
  assert.equal(updated.data.resolution_proof_path, '/uploads/resolutions/42-proof.jpg');
  assert.match(updated.data.resolution_notes, /Repair completed/i);
});

test('analytics metrics aggregate monthly history and current status counts', async () => {
  const metrics = await getAnalyticsMetrics({
    db: {
      getAllIncidents: async () => [
        { created_at: '2026-01-15T00:00:00.000Z', status: 'Resolved' },
        { created_at: '2026-01-20T00:00:00.000Z', status: 'Pending Survey' },
        { created_at: '2026-02-05T00:00:00.000Z', status: 'Under Survey' },
        { created_at: '2026-02-18T00:00:00.000Z', status: 'Resolved' },
        { created_at: '2026-02-22T00:00:00.000Z', status: 'Resolved' }
      ]
    }
  });

  assert.equal(metrics.totalIncidents, 5);
  assert.equal(metrics.currentStatusBreakdown.Resolved, 3);
  assert.equal(metrics.historical[0].period, '2026-01');
  assert.equal(metrics.historical[0].count, 2);
});

test('contractor SLA audit marks overdue assignments as breached and logs a penalty tier', async () => {
  const records = [{
    id: 1,
    assignedContractor: 'Asha Builders',
    deadline: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    status: 'Assigned',
    resolved_at: null,
    penaltyStatus: 'On Track'
  }];

  const result = await auditContractorSla({
    findAll: async () => records,
    update: async (id, patch) => {
      const record = records.find((entry) => entry.id === id);
      Object.assign(record, patch);
      return record;
    }
  });

  assert.equal(result.updated, 1);
  assert.equal(records[0].status, 'SLA Breached');
  assert.equal(records[0].penaltyStatus, 'SLA Breached');
  assert.match(String(records[0].penaltyTier || ''), /Tier/i);
});

test('report CSV export renders real incident data', () => {
  const csv = buildIncidentCsv([
    { id: 1, transcript: 'Road damage', category: 'Roads', urgency: 'High', status: 'Resolved', location_name: 'Jaipur', created_at: '2026-02-01T00:00:00.000Z' }
  ]);

  assert.match(csv, /id,transcript,category/);
  assert.match(csv, /Road damage/);
  assert.match(csv, /Jaipur/);
});

test('contractor ledger aggregates contractor completion and SLA breaches', async () => {
  const ledger = await getContractorLedger({
    db: {
      getAllIncidents: async () => [
        { assignedContractor: 'Asha Builders', status: 'Resolved', resolved_at: '2026-09-20T10:00:00.000Z', penaltyStatus: 'Completed' },
        { assignedContractor: 'Asha Builders', status: 'SLA Breached', resolved_at: null, penaltyStatus: 'SLA Breached', deadline: '2026-09-18T10:00:00.000Z' },
        { assignedContractor: 'CityWorks', status: 'Assigned', resolved_at: null, penaltyStatus: 'On Track', deadline: '2026-09-30T10:00:00.000Z' }
      ]
    }
  });

  assert.equal(ledger.totalContractors, 2);
  assert.equal(ledger.activePenalties, 1);
  assert.equal(ledger.ledger[0].completionRate, 50);
});
