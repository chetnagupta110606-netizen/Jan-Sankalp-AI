const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const { cellCenter } = require('../src/utils/geo');
const { createReport, getReport } = require('../src/store');
const {
  RESOLUTION_STATUS,
  submitResolution,
} = require('../src/controllers/resolutionController');
const { geotaggedPhoto } = require('./fixtures');

const center = cellCenter(config.targetH3Cell);

function offsetLatitude(meters) {
  return center.latitude + meters / 111320;
}

function runGate(reportId, buffer) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
        return this;
      },
    };

    submitResolution(
      { params: { id: reportId }, file: { buffer, mimetype: 'image/jpeg' } },
      res,
      reject,
    ).catch(reject);
  });
}

async function seedReport() {
  const originalPhoto = await geotaggedPhoto({
    latitude: center.latitude,
    longitude: center.longitude,
    seed: 5,
  });

  return createReport({
    title: 'Overflowing bin',
    h3Cell: config.targetH3Cell,
    photo: { buffer: originalPhoto, mimetype: 'image/jpeg' },
  });
}

test('approves a geotagged photo taken at the reported cell', async () => {
  const report = await seedReport();
  const photo = await geotaggedPhoto({
    latitude: offsetLatitude(10),
    longitude: center.longitude,
    seed: 5,
    noise: 0.02,
  });

  const { statusCode, body } = await runGate(report.id, photo);

  assert.equal(statusCode, 200);
  assert.equal(body.status, 'RESOLVED_VERIFIED');
  assert.equal(body.resolution.status, RESOLUTION_STATUS.APPROVED);
  assert.equal(body.resolution.aiGroundVerified, true);
  assert.ok(body.resolution.location.distanceMeters <= config.maxDistanceMeters);
});

test('rejects a photo captured more than 50m away', async () => {
  const report = await seedReport();
  const photo = await geotaggedPhoto({
    latitude: offsetLatitude(400),
    longitude: center.longitude,
    seed: 5,
  });

  const { statusCode, body } = await runGate(report.id, photo);

  assert.equal(statusCode, 422);
  assert.equal(body.status, 'REJECTED_LOCATION_MISMATCH');
  assert.equal(body.resolution.aiGroundVerified, false);
  assert.ok(body.resolution.location.distanceMeters > config.maxDistanceMeters);
});

test('rejects a photo without EXIF GPS metadata', async () => {
  const report = await seedReport();
  const photo = await geotaggedPhoto({ seed: 5 });

  const { statusCode, body } = await runGate(report.id, photo);

  assert.equal(statusCode, 422);
  assert.equal(body.resolution.status, RESOLUTION_STATUS.REJECTED_LOCATION_MISMATCH);
  assert.equal(body.resolution.location.coordinates, null);
});

test('flags low structural similarity for District Collector Review', async () => {
  const report = await seedReport();
  const photo = await geotaggedPhoto({
    latitude: center.latitude,
    longitude: center.longitude,
    seed: 41,
    noise: 0.9,
  });

  const { statusCode, body } = await runGate(report.id, photo);

  assert.equal(statusCode, 202);
  assert.equal(body.status, 'PENDING_MANUAL_AUDIT');
  assert.equal(body.resolution.flaggedForDistrictCollectorReview, true);
  assert.ok(body.resolution.similarity.confidence < config.similarityThreshold);
  assert.equal(getReport(report.id).status, 'PENDING_MANUAL_AUDIT');
});
