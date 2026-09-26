/**
 * Jan-Sankalp AI — Whistleblower Anonymity Controller
 * ------------------------------------------------------------------
 * Provides anonymous reporting and token-only status tracking without
 * storing user-identifying metadata in the report payload.
 * ------------------------------------------------------------------
 */

const crypto = require('crypto');
const db = require('../config/database');

const TOKEN_SALT = process.env.WHISTLEBLOWER_TOKEN_SALT || 'jan-sankalp-whistleblower-v1';
const STATUS_CHOICES = new Set([
  'Submitted',
  'Reviewed',
  'Under Investigation',
  'Escalated',
  'Resolved',
  'Rejected'
]);

function getTokenHash(token) {
  return crypto.createHash('sha256')
    .update(`${TOKEN_SALT}:${String(token).trim()}`)
    .digest('hex');
}

function generateToken() {
  return crypto.randomBytes(18).toString('hex');
}

function sanitizeText(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim();
}

function normalizeStatus(value) {
  const trimmed = sanitizeText(value, 'Submitted');
  return STATUS_CHOICES.has(trimmed) ? trimmed : 'Submitted';
}

async function submitWhistleblowerReport(req, res) {
  try {
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const category = sanitizeText(body.category, 'General');
    const summary = sanitizeText(body.summary || body.message || body.report, '');
    const locationHint = sanitizeText(body.locationHint || body.location || body.location_hint, '');
    const evidence = sanitizeText(body.evidence || body.details || body.evidenceSummary, '');

    if (!summary || summary.length < 20) {
      return res.status(400).json({
        success: false,
        error: 'A detailed whistleblower summary of at least 20 characters is required.'
      });
    }

    const token = generateToken();
    const tokenHash = getTokenHash(token);
    const submittedAt = new Date().toISOString();

    const record = await db.insertWhistleblowerReport({
      token_hash: tokenHash,
      category,
      report_summary: summary,
      location_hint: locationHint || null,
      evidence: evidence || null,
      status: 'Submitted',
      status_message: 'Report received and stored anonymously.',
      created_at: submittedAt,
      updated_at: submittedAt
    });

    return res.status(201).json({
      success: true,
      token,
      reportId: record && record.id ? record.id : null,
      status: 'Submitted',
      createdAt: submittedAt,
      message: 'Anonymous report submitted securely. Save this token to check updates.'
    });
  } catch (err) {
    console.error('[whistleblowerController] submit failed:', err && err.message);
    return res.status(500).json({
      success: false,
      error: 'Could not submit anonymous whistleblower report.',
      details: err && err.message
    });
  }
}

async function getWhistleblowerStatus(req, res) {
  try {
    const token = sanitizeText(req && req.params && req.params.token ? req.params.token : (req.query && req.query.token) || (req.body && req.body.token), '');

    if (!token || token.length < 16) {
      return res.status(400).json({
        success: false,
        error: 'A valid whistleblower retrieval token is required.'
      });
    }

    const record = await db.getWhistleblowerReportByTokenHash(getTokenHash(token));
    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'No anonymous report was found for the provided token.'
      });
    }

    return res.status(200).json({
      success: true,
      token,
      reportId: record.id,
      status: record.status || 'Submitted',
      updatedAt: record.updated_at || record.created_at,
      message: record.status_message || 'Status is available through this secure token only.'
    });
  } catch (err) {
    console.error('[whistleblowerController] status lookup failed:', err && err.message);
    return res.status(500).json({
      success: false,
      error: 'Whistleblower status lookup failed.',
      details: err && err.message
    });
  }
}

async function updateWhistleblowerStatus(req, res) {
  try {
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const token = sanitizeText(body.token || (req && req.params && req.params.token) || (req && req.query && req.query.token), '');
    const nextStatus = normalizeStatus(body.status || body.newStatus || 'Submitted');
    const statusMessage = sanitizeText(body.message || body.statusMessage || 'Your report status was updated.', 'Your report status was updated.');

    if (!token || token.length < 16) {
      return res.status(400).json({
        success: false,
        error: 'A valid whistleblower token is required to update a report.'
      });
    }

    const record = await db.updateWhistleblowerReportByTokenHash(getTokenHash(token), {
      status: nextStatus,
      status_message: statusMessage,
      updated_at: new Date().toISOString()
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'No anonymous report was found for the provided token.'
      });
    }

    return res.status(200).json({
      success: true,
      token,
      reportId: record.id,
      status: record.status,
      updatedAt: record.updated_at,
      message: record.status_message
    });
  } catch (err) {
    console.error('[whistleblowerController] status update failed:', err && err.message);
    return res.status(500).json({
      success: false,
      error: 'Whistleblower status update failed.',
      details: err && err.message
    });
  }
}

module.exports = {
  generateToken,
  getTokenHash,
  submitWhistleblowerReport,
  getWhistleblowerStatus,
  updateWhistleblowerStatus
};
