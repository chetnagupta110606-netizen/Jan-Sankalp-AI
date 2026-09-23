const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const config = require('../src/config');
const { createApp } = require('../src/app');
const {
  parseWhatsAppPayload,
} = require('../src/services/telecomIngestionService');

async function withServer(run) {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    return await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function post(baseUrl, fields, { json = true } = {}) {
  return fetch(`${baseUrl}/api/v1/telecom/whatsapp-webhook${json ? '?format=json' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
}

test('parses sender, media and location out of a Twilio payload', () => {
  const parsed = parseWhatsAppPayload({
    From: 'whatsapp:+919876543210',
    Body: 'Jaipur Walled City collapse',
    NumMedia: '2',
    MediaUrl0: 'https://api.twilio.com/voice.ogg',
    MediaContentType0: 'audio/ogg',
    MediaUrl1: 'https://api.twilio.com/photo.jpg',
    MediaContentType1: 'image/jpeg',
    Latitude: '26.9124',
    Longitude: '75.7873',
  });

  assert.equal(parsed.senderPhone, 'whatsapp:+919876543210');
  assert.equal(parsed.voiceNote.url, 'https://api.twilio.com/voice.ogg');
  assert.equal(parsed.photo.url, 'https://api.twilio.com/photo.jpg');
  assert.deepEqual(parsed.coordinates, { latitude: 26.9124, longitude: 75.7873 });
});

test('ingests a text report, maps Jaipur to the H3 cell and generates a DPR', async () => {
  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, {
      From: 'whatsapp:+919876543210',
      Body: 'Jaipur Walled City collapse',
      NumMedia: '0',
    });

    assert.equal(response.status, 201);
    const report = await response.json();

    assert.equal(report.location.h3Cell, config.targetH3Cell);
    assert.equal(report.location.name, 'Jaipur Walled City');
    assert.equal(report.emergency, true);
    assert.equal(report.senderPhone, 'whatsapp:+919876543210');
    assert.ok(fs.existsSync(report.dprPath));

    assert.equal(
      report.acknowledgement.body,
      `Jan-Sankalp AI: Your emergency infrastructure report for Jaipur Walled City has been grounded. H3 Cell ID: ${config.targetH3Cell}. Track DPR Audit: ${report.trackingUrl}`,
    );
    assert.equal(report.acknowledgement.delivered, false);

    const dpr = await fetch(`${baseUrl}${report.dprUrl}`);
    assert.equal(dpr.status, 200);
    assert.equal(dpr.headers.get('content-type'), 'application/pdf');
  });
});

test('replies with TwiML when Twilio cannot deliver over the REST API', async () => {
  await withServer(async (baseUrl) => {
    const response = await post(
      baseUrl,
      { From: 'whatsapp:+919876543211', Body: 'Jaipur collapse near the fort' },
      { json: false },
    );

    const body = await response.text();
    assert.equal(response.status, 201);
    assert.match(body, /<Message>Jan-Sankalp AI: /);
    assert.match(body, new RegExp(config.targetH3Cell));
    assert.ok(response.headers.get('x-jansankalp-tracking-id').startsWith('JS-'));
  });
});

test('prefers a shared location pin over gazetteer text', async () => {
  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, {
      From: 'whatsapp:+919876543212',
      Body: 'Jaipur collapse',
      Latitude: '28.6139',
      Longitude: '77.2090',
    });

    const report = await response.json();
    assert.equal(report.location.source, 'whatsapp_location_attachment');
    assert.notEqual(report.location.h3Cell, config.targetH3Cell);
  });
});

test('rejects payloads with no resolvable location', async () => {
  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, {
      From: 'whatsapp:+919876543213',
      Body: 'something broke somewhere',
    });

    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /Could not resolve a location/);
  });
});

test('rejects payloads with no sender phone number', async () => {
  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, { Body: 'Jaipur collapse' });
    assert.equal(response.status, 400);
  });
});
