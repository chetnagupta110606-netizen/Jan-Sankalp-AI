const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const IncidentModel = require('../src/models/incidentModel');
const { ingest } = require('../src/controllers/ingestController');
const { submitResolution } = require('../src/controllers/resolutionController');
const proofService = require('../src/services/proofOfResolutionService');
const { auditImageReuse } = require('../src/services/photoAuditService');

const AI_AUDIT_FLAG = 'AI Audit Flag: Potential Spoofed Proof / Reused Asset';

async function createImage(pattern) {
  const width = 32;
  const height = 32;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const light = pattern === 'split' ? x >= width / 2 : (x + y) % 2 === 0;
      const value = light ? 240 : 12;
      const offset = (y * width + x) * 3;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

function imageDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

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

test('image reuse audit detects a previously submitted complaint photo across locations', async () => {
  const reusedImage = await createImage('split');
  const differentImage = await createImage('checker');
  const existingIncidents = [{
    id: 19,
    location_name: 'Lucknow',
    original_photo: imageDataUrl(reusedImage)
  }];

  const duplicate = await auditImageReuse(reusedImage, existingIncidents);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.match.incident_id, 19);
  assert.equal(duplicate.match.asset_type, 'complaint_photo');
  assert.equal(duplicate.perceptual_hash.length, 64);

  const unique = await auditImageReuse(differentImage, existingIncidents);
  assert.equal(unique.duplicate, false);
  assert.equal(unique.match, null);
});

test('ingest persists a reused complaint photo as pending manual audit', async (t) => {
  const photo = await createImage('split');
  const originalMethods = {
    findAllForPhotoAudit: IncidentModel.findAllForPhotoAudit,
    findAll: IncidentModel.findAll,
    create: IncidentModel.create
  };
  let createdIncident;
  IncidentModel.findAllForPhotoAudit = async () => [{
    id: 19,
    location_name: 'Other location',
    original_photo: imageDataUrl(photo)
  }];
  IncidentModel.findAll = async () => [];
  IncidentModel.create = async (data) => {
    createdIncident = { id: 20, ...data };
    return createdIncident;
  };
  t.after(() => Object.assign(IncidentModel, originalMethods));

  const res = responseCapture();
  await ingest({
    body: {
      transcript: 'A pothole is damaging the road in Lucknow.',
      original_photo: imageDataUrl(photo),
      status: 'Resolved'
    }
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(createdIncident.status, 'PENDING_MANUAL_AUDIT');
  assert.equal(createdIncident.priority, AI_AUDIT_FLAG);
  assert.equal(createdIncident.resolution_audit.ai_audit_flag, AI_AUDIT_FLAG);
  assert.equal(res.body.status, 'PENDING_MANUAL_AUDIT');
  assert.equal(res.body.data.resolution_audit.image_audit.duplicate, true);
});

test('resolution submissions using a reused image are persisted without auto-approval', async (t) => {
  const photo = await createImage('split');
  const originalMethods = {
    findById: IncidentModel.findById,
    findAllForPhotoAudit: IncidentModel.findAllForPhotoAudit,
    update: IncidentModel.update
  };
  let updatedIncident;
  IncidentModel.findById = async (id) => ({
    id,
    status: 'Under Survey',
    location_name: 'Lucknow',
    original_photo: imageDataUrl(photo),
    h3_index: null
  });
  IncidentModel.findAllForPhotoAudit = async () => [{
    id: 10,
    location_name: 'Other location',
    original_photo: imageDataUrl(photo)
  }];
  IncidentModel.update = async (id, patch) => {
    updatedIncident = { id, ...patch };
    return updatedIncident;
  };
  t.after(() => Object.assign(IncidentModel, originalMethods));

  const res = responseCapture();
  await submitResolution({
    params: { id: '42' },
    body: { notes: 'Work completed' },
    files: {
      originalImage: [{ buffer: photo }],
      resolutionImage: [{ buffer: photo }]
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'PENDING_MANUAL_AUDIT');
  assert.equal(res.body.aiAuditFlag, AI_AUDIT_FLAG);
  assert.equal(updatedIncident.status, 'PENDING_MANUAL_AUDIT');
  assert.equal(updatedIncident.resolution_audit.verified, false);
  assert.equal(updatedIncident.resolution_audit.photo_reuse_audit.duplicate, true);
});

test('resolution submissions reject proof with missing EXIF GPS and flag possible fake or recycled proof', async (t) => {
  const photo = await createImage('split');
  const originalExtractExif = proofService.extractExif;
  proofService.extractExif = async () => ({ latitude: null, longitude: null, timestamp: null });
  t.after(() => {
    proofService.extractExif = originalExtractExif;
  });

  const originalMethods = {
    findById: IncidentModel.findById,
    update: IncidentModel.update
  };
  IncidentModel.findById = async (id) => ({
    id,
    status: 'Under Survey',
    location_name: 'Lucknow',
    h3_index: '8c2a100d36bffff',
    latitude: 26.9248,
    longitude: 75.8273,
    original_photo: imageDataUrl(photo)
  });
  IncidentModel.update = async () => ({ success: true });
  t.after(() => Object.assign(IncidentModel, originalMethods));

  const res = responseCapture();
  await submitResolution({
    params: { id: '42' },
    body: { notes: 'Work completed' },
    files: {
      originalImage: [{ buffer: photo }],
      resolutionImage: [{ buffer: photo }]
    }
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'REJECTED_GEO_FENCE');
  assert.match(String(res.body.error || ''), /potential fake or recycled proof/i);
});
