const test = require('node:test');
const assert = require('node:assert/strict');

const { parseTranscript } = require('../src/services/civicService');
const { resolveIngestRegion } = require('../src/controllers/ingestController');
const { toIncidentPayload } = require('../src/models/incidentModel');

test('transcript city takes precedence and resolves Lucknow coordinates', () => {
  const parsed = parseTranscript('Lucknow');
  const region = resolveIngestRegion(parsed, { coordinates: [28.6139, 77.209] });

  assert.equal(parsed.locationName, 'Lucknow, Uttar Pradesh');
  assert.deepEqual([region.centerLat, region.centerLng], [26.8467, 80.9462]);
});

test('generic issue descriptions are not mistaken for bare city names', () => {
  assert.equal(parseTranscript('Drain issue').locationName, null);
});

test('unrecognized transcript city is retained instead of using stale Delhi coordinates', () => {
  const parsed = parseTranscript('Potholes are damaging roads in Kanpur after heavy rain.');
  const region = resolveIngestRegion(parsed, { coordinates: [28.6139, 77.209] });

  assert.equal(parsed.locationName, 'Kanpur');
  assert.equal(region.locationName, 'Kanpur');
  assert.equal(region.centerLat, null);
  assert.equal(region.centerLng, null);
  assert.equal(region.h3Index, null);
});

test('incident payload leaves ungeocoded coordinates null instead of converting them to zero', () => {
  const incident = toIncidentPayload({
    id: 1,
    latitude: null,
    longitude: null,
    location_name: 'Kanpur'
  });

  assert.equal(incident.latitude, null);
  assert.equal(incident.longitude, null);
  assert.equal(incident.coordinates, null);
});
