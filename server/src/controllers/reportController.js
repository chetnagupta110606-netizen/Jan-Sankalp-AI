/**
 * Jan-Sankalp AI — Report Validation Guardrails
 * ------------------------------------------------------------------
 * Blocks spam / non-civic submissions before they are ingested into the
 * civic reporting pipeline.
 * ------------------------------------------------------------------
 */

const CIVIC_INFRASTRUCTURE_KEYWORDS = [
  'road', 'street', 'drain', 'drainage', 'pothole', 'bridge', 'water', 'pipe',
  'pipeline', 'sewer', 'sanitation', 'streetlight', 'traffic', 'signal',
  'transformer', 'electricity', 'power', 'school', 'hospital', 'toilet',
  'waste', 'garbage', 'flood', 'landslide', 'erosion', 'public', 'parking',
  'sidewalk', 'footpath', 'mobility', 'roadside', 'stormwater', 'junction',
  'सड़क', 'नाली', 'सीवर', 'बिजली', 'जल', 'पानी', 'फुटपाथ', 'पथ', 'ब्रिज', 'गली', 'घर'
];

const NON_CIVIC_SPAM_KEYWORDS = [
  'selfie', 'portrait', 'beach', 'vacation', 'wedding', 'dog', 'cat', 'food',
  'restaurant', 'vacation', 'travel', 'fashion', 'party', 'gym', 'self-portrait',
  'cute', 'birthday', 'celebration'
];

function normalizeText(value) {
  return String(value || '').toLowerCase().trim();
}

function readImageSource(payload) {
  if (!payload) return null;
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && payload.buffer) {
    return Buffer.isBuffer(payload.buffer) ? payload.buffer : null;
  }
  return null;
}

async function validateCivicImage(imageInput, context = {}) {
  const transcript = normalizeText(context.transcript || context.body?.transcript || '');
  const locationName = normalizeText(context.locationName || context.region?.locationName || context.region?.label || '');
  const category = normalizeText(context.category || context.body?.category || '');
  const combinedText = `${transcript} ${locationName} ${category}`.trim();
  const hasCivicSubject = CIVIC_INFRASTRUCTURE_KEYWORDS.some((keyword) => combinedText.includes(keyword));
  const hasSpamSignal = NON_CIVIC_SPAM_KEYWORDS.some((keyword) => combinedText.includes(keyword));
  const imageSource = readImageSource(imageInput);

  if (!imageSource && !combinedText) {
    return {
      isValid: false,
      status: 'REJECTED_INVALID_CIVIC_SUBJECT',
      reason: 'No civic image or civic context was provided for ingestion.'
    };
  }

  if (hasSpamSignal && !hasCivicSubject) {
    return {
      isValid: false,
      status: 'REJECTED_INVALID_CIVIC_SUBJECT',
      reason: 'Uploaded image does not appear to depict civic infrastructure or public works.'
    };
  }

  if (hasCivicSubject || imageSource) {
    return {
      isValid: true,
      status: 'VALID_CIVIC_SUBJECT',
      reason: 'Civic infrastructure context detected.'
    };
  }

  return {
    isValid: false,
    status: 'REJECTED_INVALID_CIVIC_SUBJECT',
    reason: 'Uploaded image does not appear to depict civic infrastructure.'
  };
}

async function validateReportSubmission(req, res) {
  try {
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const imageInput = body.original_photo || body.originalImage || body.image || null;
    const result = await validateCivicImage(imageInput, { transcript: body.transcript, locationName: body.locationName, category: body.category, body });

    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        status: result.status,
        error: result.reason,
        validation: result
      });
    }

    return res.json({
      success: true,
      status: result.status,
      validation: result
    });
  } catch (err) {
    console.error('[reportController] Validation failed:', err && err.message);
    return res.status(500).json({
      success: false,
      status: 'REJECTED_INVALID_CIVIC_SUBJECT',
      error: 'Civic validation failed.',
      details: err && err.message
    });
  }
}

function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildIncidentCsv(records = []) {
  const headers = [
    'id', 'transcript', 'category', 'urgency', 'status', 'location_name', 'h3_index',
    'latitude', 'longitude', 'assigned_ministry', 'target_completion_date', 'priority',
    'original_photo', 'resolution_proof_path', 'resolution_notes', 'resolved_at', 'created_at'
  ];

  const rows = [headers.join(',')];
  for (const record of records) {
    rows.push(headers.map((header) => escapeCsv(record[header])).join(','));
  }
  return rows.join('\n');
}

async function downloadIncidentCsv(req, res) {
  try {
    const db = require('../config/database');
    const incidents = await db.getAllIncidents();
    const csv = buildIncidentCsv(incidents);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="incidents.csv"');
    res.status(200).send(csv);
    return csv;
  } catch (err) {
    console.error('[reportController] CSV export failed:', err && err.message);
    if (res && typeof res.status === 'function') {
      return res.status(500).json({ success: false, error: 'CSV export failed.', details: err && err.message });
    }
    return { success: false, error: 'CSV export failed.', details: err && err.message };
  }
}

module.exports = {
  validateCivicImage,
  validateReportSubmission,
  buildIncidentCsv,
  downloadIncidentCsv
};
