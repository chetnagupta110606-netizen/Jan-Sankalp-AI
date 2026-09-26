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
const {
  submitResolution,
  resolveIncident,
  verifyCitizenResolution,
  reopenExpiredCitizenVerifications
} = require('../controllers/resolutionController');
const { getAnalyticsMetrics, getContractorLedger, getTransparencyLedger } = require('../controllers/analyticsController');
const { computeContractorRiskScores } = require('../services/contractorRiskScoringService');
const {
  submitWhistleblowerReport,
  getWhistleblowerStatus,
  updateWhistleblowerStatus
} = require('../controllers/whistleblowerController');
const { resolveSmsUssdCommand, updateSmsUssdStatus } = require('../services/smsUssdService');
const { simulateSmsCommand } = require('../controllers/smsController');
const { requireOfficerOrAdmin } = require('../middleware/requireOfficerOrAdmin');

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
router.get('/analytics/contractor-ledger', getContractorLedger);
router.get('/transparency/ledger', getTransparencyLedger);
router.get('/contractors/risk-scores', async (_req, res) => {
  try {
    const payload = await computeContractorRiskScores();
    return res.status(payload.success ? 200 : 500).json(payload);
  } catch (error) {
    console.error('[apiRoutes] contractor risk scores failed:', error && error.message);
    return res.status(500).json({
      success: false,
      contractors: [],
      error: 'Failed to compute contractor risk scores.',
      details: error && error.message
    });
  }
});
router.get('/reports/download', downloadIncidentCsv);

// ── Geospatial ─────────────────────────────────────────────────────
router.get('/incidents', async (req, res) => {
  const reopened = await reopenExpiredCitizenVerifications();
  if (reopened.length) {
    console.log('[api] auto-reopened citizen verification incidents:', reopened.length);
  }
  return listIncidents(req, res);
});
router.get('/incidents/:id', async (req, res) => {
  await reopenExpiredCitizenVerifications({ incidents: [await require('../models/incidentModel').findById(req.params.id)].filter(Boolean) });
  return getIncident(req, res);
});
router.get('/heatmap', heatmap);
router.post('/update-cluster-status', updateClusterStatus);
router.post('/incidents/:id/verify', verifyCitizenResolution);

// ── Satellite verification ─────────────────────────────────────────
router.post('/verify-satellite', verifySatellite);

// ── Detailed Project Report ────────────────────────────────────────
router.post('/dpr', generateDpr);
router.get('/dpr', getDpr);
router.get('/dpr/:id', getDprById);

// ── Whistleblower anonymity flows ─────────────────────────────────
router.post('/whistleblower/submit', submitWhistleblowerReport);
router.post('/whistleblower/submission', submitWhistleblowerReport);
router.get('/whistleblower/status/:token', getWhistleblowerStatus);
router.get('/whistleblower/:token', getWhistleblowerStatus);
router.get('/whistleblower/status', getWhistleblowerStatus);
router.post('/whistleblower/status', updateWhistleblowerStatus);
router.put('/whistleblower/status', updateWhistleblowerStatus);
router.put('/whistleblower/:token/status', updateWhistleblowerStatus);
router.post('/whistleblower/admin/status', requireOfficerOrAdmin, updateWhistleblowerStatus);

// ── SMS / USSD offline simulator ───────────────────────────────────
router.post('/sms/simulate', simulateSmsCommand);
router.post('/sms/ussd', async (req, res) => {
  try {
    const command = req && req.body && typeof req.body.command === 'string' ? req.body.command : '';
    const result = await resolveSmsUssdCommand(command);
    const statusCode = result.success ? 200 : 400;
    return res.status(statusCode).json(result);
  } catch (err) {
    console.error('[smsUssd] command failed:', err && err.message);
    return res.status(500).json({
      success: false,
      code: 'SMS_PROCESSING_ERROR',
      text: 'SMS command failed. Please try again.',
      message: err && err.message
    });
  }
});

router.post('/sms/simulate/admin/status', async (req, res) => {
  try {
    const result = await updateSmsUssdStatus(req && req.body ? req.body : {});
    const statusCode = result.success ? 200 : 400;
    return res.status(statusCode).json(result);
  } catch (err) {
    console.error('[smsUssd] admin update failed:', err && err.message);
    return res.status(500).json({
      success: false,
      code: 'SMS_ADMIN_STATUS_ERROR',
      text: 'Could not update the incident status.',
      message: err && err.message
    });
  }
});

router.post('/sms/ussd/admin/status', async (req, res) => {
  try {
    const result = await updateSmsUssdStatus(req && req.body ? req.body : {});
    const statusCode = result.success ? 200 : 400;
    return res.status(statusCode).json(result);
  } catch (err) {
    console.error('[smsUssd] admin update failed:', err && err.message);
    return res.status(500).json({
      success: false,
      code: 'SMS_ADMIN_STATUS_ERROR',
      text: 'Could not update the incident status.',
      message: err && err.message
    });
  }
});

// ── Proof-of-resolution anti-fraud gate ────────────────────────────
router.post('/resolutions', requireOfficerOrAdmin, submitResolution);
router.post('/incidents/:id/resolution', requireOfficerOrAdmin, submitResolution);
router.post('/incidents/:incidentId/resolve', upload.single('proofImage'), resolveIncident);

module.exports = router;