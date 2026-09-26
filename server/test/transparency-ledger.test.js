const test = require('node:test');
const assert = require('node:assert/strict');

const { getTransparencyLedger } = require('../src/controllers/analyticsController');

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('public transparency ledger aggregates resolved incidents, penalties and SLA status', async () => {
  const res = responseCapture();

  await getTransparencyLedger({
    db: {
      getAllIncidents: async () => [
        {
          id: 1,
          category: 'Road repair',
          status: 'Resolved',
          penaltyStatus: 'On Track',
          assignedContractor: 'Asha Builders',
          location_name: 'Jaipur West',
          resolved_at: '2026-09-20T12:00:00.000Z'
        },
        {
          id: 2,
          category: 'Drainage fix',
          status: 'SLA Breached',
          penaltyStatus: 'SLA Breached',
          assignedContractor: 'Rajasthan Roads Co.',
          location_name: 'Kishanpole',
          resolved_at: '2026-09-18T08:00:00.000Z'
        },
        {
          id: 3,
          category: 'Streetlight repair',
          status: 'Pending Citizen Verification',
          penaltyStatus: 'On Track',
          assignedContractor: 'CityWorks Infra',
          location_name: 'Sanganer'
        }
      ]
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.summary.totalIncidents, 3);
  assert.equal(res.body.summary.totalResolvedIncidents, 2);
  assert.equal(res.body.summary.totalPenalties, 1);
  assert.ok(res.body.reportText.includes('RTI Public Ledger Audit Summary'));
  assert.ok(res.body.ledger.some((entry) => entry.auditHash));
});
