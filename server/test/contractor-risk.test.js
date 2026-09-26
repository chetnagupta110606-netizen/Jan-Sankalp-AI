const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeContractorRiskProfile,
  computeContractorRiskScores
} = require('../src/services/contractorRiskScoringService');

test('contractor risk scoring blends delay, SLA penalties and hotspot exposure', async () => {
  const incidents = [
    {
      id: 1,
      assignedContractor: 'Asha Builders',
      status: 'SLA Breached',
      penaltyStatus: 'SLA Breached',
      created_at: '2026-09-01T08:00:00.000Z',
      resolvedAt: null,
      deadline: '2026-09-02T08:00:00.000Z',
      location_name: 'Jaipur West',
      urgency: 'High',
      priority: 'High'
    },
    {
      id: 2,
      assignedContractor: 'Asha Builders',
      status: 'Resolved',
      penaltyStatus: 'On Track',
      created_at: '2026-09-06T09:00:00.000Z',
      resolvedAt: '2026-09-10T12:00:00.000Z',
      deadline: '2026-09-09T09:00:00.000Z',
      location_name: 'Jaipur West',
      urgency: 'High',
      priority: 'High'
    },
    {
      id: 3,
      assignedContractor: 'Asha Builders',
      status: 'Under Survey',
      penaltyStatus: 'On Track',
      created_at: '2026-09-12T10:00:00.000Z',
      resolvedAt: null,
      deadline: '2026-09-13T10:00:00.000Z',
      location_name: 'Jaipur West',
      urgency: 'High',
      priority: 'High'
    },
    {
      id: 4,
      assignedContractor: 'CityWorks Infra',
      status: 'Resolved',
      penaltyStatus: 'On Track',
      created_at: '2026-09-06T09:00:00.000Z',
      resolvedAt: '2026-09-08T12:00:00.000Z',
      deadline: '2026-09-10T09:00:00.000Z',
      location_name: 'Delhi South',
      urgency: 'Medium',
      priority: 'Medium'
    }
  ];

  const profile = computeContractorRiskProfile('Asha Builders', incidents);

  assert.ok(profile.riskIndex >= 60, 'risk score should detect elevated contractor risk');
  assert.equal(profile.warningFlags.includes('High SLA breach rate'), true);
  assert.equal(profile.warningFlags.includes('Hotspot exposure in Jaipur West'), true);
  assert.equal(profile.warningFlags.includes('Average resolution time exceeds 72 hours'), true);

  const allScores = await computeContractorRiskScores({
    getAllIncidents: async () => incidents
  });

  assert.equal(allScores.contractors.length >= 2, true);
  assert.equal(allScores.contractors[0].contractor, 'Asha Builders');
});
