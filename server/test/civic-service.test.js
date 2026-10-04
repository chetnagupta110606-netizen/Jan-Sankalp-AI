const test = require('node:test');
const assert = require('node:assert/strict');
const h3 = require('h3-js');

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

test('spoken North East region is preserved instead of becoming unassigned', () => {
  const parsed = parseTranscript('North East area due to flood the whole area is disrupted.');
  const region = resolveIngestRegion(parsed, {});

  assert.equal(parsed.locationName, 'North East Region');
  assert.equal(region.location_name || region.locationName, 'North East Region');
  assert.equal(region.centerLat, null);
});

test('explicit spoken coordinate pair is parsed and assigned an H3 cell', () => {
  const parsed = parseTranscript('Water damage reported at coordinates 27.1767, 78.0081.');
  const region = resolveIngestRegion(parsed, {});

  assert.deepEqual(parsed.coordinates, [27.1767, 78.0081]);
  assert.deepEqual([region.centerLat, region.centerLng], parsed.coordinates);
  assert.equal(region.h3Index, h3.latLngToCell(27.1767, 78.0081, 9));
});

test('spoken coordinates do not become part of the extracted location name', () => {
  const parsed = parseTranscript('Water outage in Assam at coordinates 26.2000, 91.7000.');
  const region = resolveIngestRegion(parsed, {});

  assert.equal(parsed.locationName, 'Assam');
  assert.deepEqual(parsed.coordinates, [26.2, 91.7]);
  assert.equal(region.locationName, 'Assam');
  assert.deepEqual([region.centerLat, region.centerLng], [26.2, 91.7]);
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

test('explicit browser or map coordinates override inferred regions and receive a real H3 cell', () => {
  const coordinates = [34.1526, 77.5771];
  const parsed = parseTranscript('Water pipeline damage reported near Lucknow.');
  const region = resolveIngestRegion(parsed, {
    coordinates,
    locationSource: 'map',
    locationName: 'Browser-selected location'
  });

  assert.deepEqual([region.centerLat, region.centerLng], coordinates);
  assert.equal(region.h3Index, h3.latLngToCell(coordinates[0], coordinates[1], 9));
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
