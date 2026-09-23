const test = require('node:test');
const assert = require('node:assert/strict');

const { validateCivicImage } = require('../src/controllers/reportController');
const { checkQualityAuditTrigger } = require('../src/controllers/resolutionController');
const { triggerStatusWebhook } = require('../src/services/notificationService');

function makePngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAF' +
    'c4zjQAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJ0UkG' +
    'AAAAAABJRU5ErkJggg==',
    'base64'
  );
}

test('civic image validation rejects non-civic spam content', async () => {
  const buffer = makePngBuffer();
  const result = await validateCivicImage(buffer, {
    transcript: 'This is a selfie of my dog  at a beach weekend.'
  });

  assert.equal(result.isValid, false);
  assert.equal(result.status, 'REJECTED_INVALID_CIVIC_SUBJECT');
});

test('civic image validation accepts infrastructure imagery', async () => {
  const buffer = makePngBuffer();
  const result = await validateCivicImage(buffer, {
    transcript: 'Road is broken near the drain and streetlight in Jaipur.'
  });

  assert.equal(result.isValid, true);
  assert.equal(result.status, 'VALID_CIVIC_SUBJECT');
});

test('quality audit trigger flags recent duplicate H3 cell', async () => {
  const incidents = [
    {
      id: 7,
      h3_index: '8c1f3d9b5a7f1e2',
      status: 'Action Taken / Resolved',
      created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      assigned_ministry: 'Ministry of Housing and Urban Affairs'
    }
  ];

  const result = await checkQualityAuditTrigger({
    newIncidentId: 9,
    h3Index: '8c1f3d9b5a7f1e2',
    createdAt: new Date().toISOString(),
    incidents
  });

  assert.equal(result.triggered, true);
  assert.equal(result.auditBreaches.length, 1);
  assert.equal(result.auditBreaches[0].status, 'QUALITY_AUDIT_BREACH');
});

test('quality audit trigger ignores older resolved tickets', async () => {
  const incidents = [
    {
      id: 7,
      h3_index: '8c1f3d9b5a7f1e2',
      status: 'Action Taken / Resolved',
      created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      assigned_ministry: 'Ministry of Housing and Urban Affairs'
    }
  ];

  const result = await checkQualityAuditTrigger({
    newIncidentId: 9,
    h3Index: '8c1f3d9b5a7f1e2',
    createdAt: new Date().toISOString(),
    incidents
  });

  assert.equal(result.triggered, false);
  assert.equal(result.auditBreaches.length, 0);
});

test('status webhook emits an SMS/WhatsApp event for assigned statuses', async () => {
  const events = [];
  const result = await triggerStatusWebhook({
    id: 4,
    status: 'ASSIGNED',
    assignee: 'Field Team 2',
    phone: '+919900000001'
  }, {
    previousStatus: 'Under Survey',
    emit: (evt) => events.push(evt)
  });

  assert.equal(result.triggered, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'ASSIGNED');
  assert.equal(events[0].channels.includes('sms'), true);
});

test('status webhook emits an approved event for mobile alerts', async () => {
  const events = [];
  const result = await triggerStatusWebhook({
    id: 4,
    status: 'APPROVED',
    assignee: 'Field Team 2',
    phone: '+919900000001',
    whatsapp: '+919900000001'
  }, {
    previousStatus: 'PENDING_AUDIT',
    emit: (evt) => events.push(evt)
  });

  assert.equal(result.triggered, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].channels.includes('whatsapp'), true);
});
