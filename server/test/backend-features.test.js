const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveIncident } = require('../src/controllers/resolutionController');
const { generateDpr, getDpr } = require('../src/controllers/dprController');
const IncidentModel = require('../src/models/incidentModel');
const db = require('../src/config/database');
const { ingest } = require('../src/controllers/ingestController');
const { getAnalyticsMetrics, getContractorLedger } = require('../src/controllers/analyticsController');
const { buildIncidentCsv } = require('../src/controllers/reportController');
const { auditContractorSla } = require('../src/services/contractorSlaService');
const { checkSpatialDuplication } = require('../src/services/spatialAnalytics');

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

test('DPR generation without an ID uses the newest persisted incident', async (t) => {
  const originalFindLatest = IncidentModel.findLatest;
  const originalFindAll = IncidentModel.findAll;
  const latestIncident = {
    id: 87,
    transcript: 'Newly filed road damage report',
    category: 'Rural Roads',
    urgency: 'High',
    status: 'Under Survey',
    location_name: 'Kanpur',
    h3_index: null,
    latitude: null,
    longitude: null,
    assigned_ministry: 'Ministry of Rural Development',
    created_at: '2026-10-03T10:00:00.000Z'
  };
  IncidentModel.findLatest = async () => latestIncident;
  IncidentModel.findAll = async () => [];
  t.after(() => {
    IncidentModel.findLatest = originalFindLatest;
    IncidentModel.findAll = originalFindAll;
  });

  let report;
  const response = { json(payload) { report = payload; return payload; } };
  await generateDpr({ body: {} }, response);

  assert.equal(report.incident_id, latestIncident.id);
  assert.equal(report.transcript, latestIncident.transcript);
  assert.equal(report.locationName, latestIncident.location_name);
});

test('DPR GET without incidentId uses latest incident despite location query values', async (t) => {
  const originalFindLatest = IncidentModel.findLatest;
  const originalFindAll = IncidentModel.findAll;
  const latestIncident = {
    id: 88,
    transcript: 'Fresh complaint description',
    category: 'Water Security',
    urgency: 'Critical',
    status: 'Under Survey',
    location_name: 'Mysuru',
    h3_index: '8928308280fffff',
    latitude: 12.2958,
    longitude: 76.6394,
    assigned_ministry: 'Ministry of Jal Shakti',
    created_at: '2026-10-03T11:00:00.000Z'
  };
  IncidentModel.findLatest = async () => latestIncident;
  IncidentModel.findAll = async () => [];
  t.after(() => {
    IncidentModel.findLatest = originalFindLatest;
    IncidentModel.findAll = originalFindAll;
  });

  let report;
  const response = { json(payload) { report = payload; return payload; } };
  await getDpr({ query: { locationName: 'stale location', coordinates: '1,2' } }, response);

  assert.equal(report.incident_id, latestIncident.id);
  assert.equal(report.location, latestIncident.location_name);
  assert.equal(report.description, latestIncident.transcript);
  assert.equal(report.createdAt, latestIncident.created_at);
});

test('DPR GET uses the dynamically selected incidentId when provided', async (t) => {
  const originalFindById = IncidentModel.findById;
  const originalFindAll = IncidentModel.findAll;
  const selectedIncident = {
    id: 91,
    transcript: 'Selected complaint description',
    category: 'Rural Roads',
    urgency: 'High',
    status: 'Under Survey',
    location_name: 'Hubballi',
    h3_index: null,
    latitude: null,
    longitude: null,
    assigned_ministry: 'Ministry of Rural Development',
    created_at: '2026-10-03T12:00:00.000Z'
  };
  let requestedId;
  IncidentModel.findById = async (id) => { requestedId = id; return selectedIncident; };
  IncidentModel.findAll = async () => [];
  t.after(() => {
    IncidentModel.findById = originalFindById;
    IncidentModel.findAll = originalFindAll;
  });

  let report;
  const response = { json(payload) { report = payload; return payload; } };
  await getDpr({ query: { incidentId: '91' } }, response);

  assert.equal(requestedId, '91');
  assert.equal(report.incident_id, selectedIncident.id);
  assert.equal(report.location, selectedIncident.location_name);
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

test('duplicate civic reports increment the master incident report count', async (t) => {
  const originalFindAll = IncidentModel.findAll;
  const originalAppendSubReport = IncidentModel.appendSubReport;
  const masterIncident = {
    id: 50,
    transcript: 'Water pipe burst in Lucknow',
    category: 'General Infrastructure',
    urgency: 'Medium',
    status: 'Under Survey',
    latitude: 26.8467,
    longitude: 80.9462,
    h3_index: '893d8dcd553ffff',
    location_name: 'Lucknow, Uttar Pradesh'
  };
  let reads = 0;
  let incrementedId = null;
  let appendedSubReport = null;
  let nextUrgency = null;
  IncidentModel.findAll = async () => (++reads === 1 ? [] : [masterIncident]);
  IncidentModel.appendSubReport = async (id, subReport, urgency) => {
    incrementedId = id;
    appendedSubReport = subReport;
    nextUrgency = urgency;
    return { ...masterIncident, report_count: 4, subReports: [subReport, subReport, subReport] };
  };
  t.after(() => {
    IncidentModel.findAll = originalFindAll;
    IncidentModel.appendSubReport = originalAppendSubReport;
  });

  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  await ingest({
    body: {
      transcript: 'Water pipe burst in Lucknow near the market.',
      reporterId: 'citizen-50',
      reporterName: 'Test Reporter'
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'DUPLICATE_LINKED');
  assert.equal(incrementedId, masterIncident.id);
  assert.equal(response.body.data.report_count, 4);
  assert.equal(response.body.data.subReports.length, 3);
  assert.equal(appendedSubReport.category, masterIncident.category);
  assert.equal(appendedSubReport.reporterId, 'citizen-50');
  assert.equal(appendedSubReport.reporterName, 'Test Reporter');
  assert.ok(appendedSubReport.created_at);
  assert.equal(nextUrgency, 'Medium');
});

test('PostgreSQL report count increment is atomic', async (t) => {
  const originalPool = db.pool;
  let queryText = '';
  let queryParams = null;
  db.pool = {
    async query(text, params) {
      queryText = text;
      queryParams = params;
      return { rows: [{ id: 9, report_count: 3 }] };
    }
  };
  t.after(() => { db.pool = originalPool; });

  const updated = await db.incrementIncidentReportCount(9);
  assert.match(queryText, /report_count\s*=\s*COALESCE\(report_count, 1\)\s*\+\s*1/i);
  assert.deepEqual(queryParams, [9]);
  assert.equal(updated.report_count, 3);
});

test('file-backed duplicate aggregation appends subreport and escalates urgency', async (t) => {
  const originalPool = db.pool;
  const originalFileStore = db.fileStore;
  const parent = {
    id: 71,
    report_count: 1,
    sub_reports: [],
    urgency: 'Medium',
    priority: 'MEDIUM'
  };
  db.pool = null;
  db.fileStore = {
    records: [parent],
    findById(id) { return this.records.find((record) => record.id === id) || null; },
    _persist() {}
  };
  t.after(() => {
    db.pool = originalPool;
    db.fileStore = originalFileStore;
  });

  const subReport = { transcript: 'A new description', created_at: '2026-10-04T12:00:00.000Z' };
  const updated = await db.appendIncidentSubReport(71, subReport, 'Low');

  assert.equal(updated.report_count, 2);
  assert.deepEqual(updated.sub_reports, [subReport]);
  assert.equal(updated.urgency, 'High');
  assert.equal(updated.priority, 'HIGH');
});

test('PostgreSQL duplicate aggregation appends JSONB, increments count, and escalates priority atomically', async (t) => {
  const originalPool = db.pool;
  let queryText = '';
  let queryParams = null;
  db.pool = {
    async query(text, params) {
      queryText = text;
      queryParams = params;
      return { rows: [{ id: 72, report_count: 2, urgency: 'High', priority: 'HIGH', sub_reports: [JSON.parse(params[1])] }] };
    }
  };
  t.after(() => { db.pool = originalPool; });

  const subReport = { reporterId: 'citizen-4', created_at: '2026-10-04T12:01:00.000Z' };
  const updated = await db.appendIncidentSubReport(72, subReport, 'Low');

  assert.match(queryText, /sub_reports\s*=\s*COALESCE\(sub_reports, '\[\]'::jsonb\) \|\| jsonb_build_array/i);
  assert.match(queryText, /report_count\s*=\s*COALESCE\(report_count, 1\) \+ 1/i);
  assert.match(queryText, /priority\s*=\s*CASE/i);
  assert.deepEqual(queryParams, [72, JSON.stringify(subReport), 'Low']);
  assert.equal(updated.report_count, 2);
  assert.equal(updated.urgency, 'High');
});

test('coordinate-free duplicate reports match by location and transcript similarity', async (t) => {
  const originalFindAll = IncidentModel.findAll;
  IncidentModel.findAll = async () => [{
    id: 63,
    status: 'Under Survey',
    category: 'Disaster Resilience',
    location_name: 'North East Region',
    transcript: 'Flood water has damaged homes across the eastern districts',
    latitude: null,
    longitude: null,
    h3_index: null
  }];
  t.after(() => { IncidentModel.findAll = originalFindAll; });

  const result = await checkSpatialDuplication({
    transcript: 'Many homes are flooded across the North East districts.',
    category: 'Disaster Resilience',
    location_name: 'North East Region',
    latitude: null,
    longitude: null,
    h3_index: null
  });

  assert.equal(result.isDuplicate, true);
  assert.equal(result.existingIncident.id, 63);
});

test('same location and wording do not deduplicate when categories differ', async (t) => {
  const originalFindAll = IncidentModel.findAll;
  IncidentModel.findAll = async () => [{
    id: 64,
    status: 'Under Survey',
    location_name: 'Market Ward',
    category: 'Water Security',
    transcript: 'A pipe is leaking near the market',
    latitude: null,
    longitude: null,
    h3_index: null
  }];
  t.after(() => { IncidentModel.findAll = originalFindAll; });

  const result = await checkSpatialDuplication({
    location_name: 'Market Ward',
    category: 'Sanitation',
    transcript: 'A pipe is leaking near the market',
    latitude: null,
    longitude: null,
    h3_index: null
  });
  assert.equal(result.isDuplicate, false);
});

test('same exact H3 cell and category deduplicates despite different wording', async (t) => {
  const h3 = require('h3-js');
  const cell = h3.latLngToCell(20.5937, 78.9629, 9);
  const originalFindAll = IncidentModel.findAll;
  IncidentModel.findAll = async () => [{
    id: 65,
    status: 'Under Survey',
    location_name: 'Ward 4',
    category: 'Water Security',
    transcript: 'Leaking tap by the school',
    h3_index: cell,
    latitude: null,
    longitude: null
  }];
  t.after(() => { IncidentModel.findAll = originalFindAll; });

  const result = await checkSpatialDuplication({
    location_name: 'Ward 4',
    category: 'Water Security',
    transcript: 'Residents report a dry public drinking-water tap',
    h3_index: cell,
    latitude: null,
    longitude: null
  });
  assert.equal(result.isDuplicate, true);
  assert.equal(result.existingIncident.id, 65);
});
