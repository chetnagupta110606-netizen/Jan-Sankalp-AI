/**
 * Jan-Sankalp AI — API v1 Routes
 * ------------------------------------------------------------------
 * Mounts every versioned endpoint under /api/v1.
 * ------------------------------------------------------------------
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const { ingest } = require('../controllers/ingestController');
const {
  listIncidents,
  getIncident,
  heatmap,
  updateClusterStatus
} = require('../controllers/geospatialController');
const { verifySatellite } = require('../controllers/satelliteController');
const { generateDpr, getDpr, getDprById } = require('../controllers/dprController');
const { validateReportSubmission, downloadIncidentCsv } = require('../controllers/reportController');
const { submitResolution, validateOfficerRole, resolveIncident } = require('../controllers/resolutionController');
const { getAnalyticsMetrics } = require('../controllers/analyticsController');

const router = express.Router();
const uploadRoot = path.join(__dirname, '..', '..', 'uploads', 'resolutions');
fs.mkdirSync(uploadRoot, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot),
    filename: (_req, file, cb) => {
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname || '.jpg')}`;
      cb(null, safeName);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file || !file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed for proof uploads.'));
    }
    cb(null, true);
  }
});

// ── Health ─────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ status: 'online', version: 'v1', timestamp: new Date().toISOString() });
});

// ── Ingest ─────────────────────────────────────────────────────────
router.post('/ingest', ingest);
router.post('/reports/validate', validateReportSubmission);
router.get('/analytics/metrics', getAnalyticsMetrics);
router.get('/reports/download', downloadIncidentCsv);

// ── Geospatial ─────────────────────────────────────────────────────
router.get('/incidents', listIncidents);
router.get('/incidents/:id', getIncident);
router.get('/heatmap', heatmap);
router.post('/update-cluster-status', updateClusterStatus);

// ── Satellite verification ─────────────────────────────────────────
router.post('/verify-satellite', verifySatellite);

// ── Detailed Project Report ────────────────────────────────────────
router.post('/dpr', generateDpr);
router.get('/dpr', getDpr);
router.get('/dpr/:id', getDprById);

// ── Proof-of-resolution anti-fraud gate ────────────────────────────
router.post('/resolutions', validateOfficerRole, submitResolution);
router.post('/incidents/:id/resolution', validateOfficerRole, submitResolution);
router.post('/incidents/:incidentId/resolve', upload.single('proofImage'), resolveIncident);

module.exports = router;