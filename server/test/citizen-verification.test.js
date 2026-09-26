const test = require('node:test');
const assert = require('node:assert/strict');

const IncidentModel = require('../src/models/incidentModel');
const { submitResolution, verifyCitizenResolution } = require('../src/controllers/resolutionController');
const proofService = require('../src/services/proofOfResolutionService');

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

function createImage(pattern = 'solid') {
  const sharp = require('sharp');
  const width = 32;
  const height = 32;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isDark = pattern === 'checker' ? (x + y) % 2 === 0 : false;
      const isLeftSplit = pattern === 'split' ? x < width / 2 : false;
      const value = pattern === 'solid' ? 200 : (isDark || isLeftSplit ? 220 : 60);
      const offset = (y * width + x) * 3;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

test('field officer resolution transitions to pending citizen verification', async (t) => {
  const originalPhoto = await createImage('checker');
  const photo = await createImage('split');
  const originalExtractExif = proofService.extractExif;
  proofService.extractExif = async () => ({ latitude: 26.9248, longitude: 75.8273, timestamp: new Date().toISOString() });
  t.after(() => {
    proofService.extractExif = originalExtractExif;
  });

  const originalMethods = {
    findById: IncidentModel.findById,
    findAllForPhotoAudit: IncidentModel.findAllForPhotoAudit,
    update: IncidentModel.update
  };
  let updatedIncident;
  IncidentModel.findById = async (id) => ({
    id,
    status: 'Under Survey',
    location_name: 'Jaipur West',
    h3_index: '8c2a100d36bffff',
    latitude: 26.9248,
    longitude: 75.8273,
    original_photo: `data:image/png;base64,${originalPhoto.toString('base64')}`,
    resolution_audit: null
  });
  IncidentModel.findAllForPhotoAudit = async () => [];
  IncidentModel.update = async (id, patch) => {
    updatedIncident = { id, ...patch };
    return updatedIncident;
  };
  t.after(() => Object.assign(IncidentModel, originalMethods));

  const res = responseCapture();
  await submitResolution({
    params: { id: '42' },
    body: { notes: 'Work completed' },
    files: { image: [{ buffer: photo }] }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updatedIncident.status, 'Pending Citizen Verification');
  assert.equal(updatedIncident.priority, 'Awaiting Citizen Verification');
});

test('citizen still-broken feedback reopens the incident and escalates it', async (t) => {
  const originalMethods = {
    findById: IncidentModel.findById,
    update: IncidentModel.update
  };
  let updatedIncident;
  IncidentModel.findById = async (id) => ({
    id,
    status: 'Pending Citizen Verification',
    resolved_at: new Date(Date.now() - 1000).toISOString(),
    resolution_audit: { citizen_verification: { verdict: 'Pending' } }
  });
  IncidentModel.update = async (id, patch) => {
    updatedIncident = { id, ...patch };
    return updatedIncident;
  };
  t.after(() => Object.assign(IncidentModel, originalMethods));

  const res = responseCapture();
  await verifyCitizenResolution({
    params: { id: '42' },
    body: { verdict: 'Still Broken', comment: 'Not working' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updatedIncident.status, 'Reopened');
  assert.equal(res.body.escalation, true);
  assert.equal(updatedIncident.priority, 'High Priority — Reopened');
});
