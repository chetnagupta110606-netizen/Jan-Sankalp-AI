const twilio = require('twilio');
const config = require('../config');
const {
  ingestWhatsAppMessage,
  listIngestedReports,
} = require('../services/telecomIngestionService');

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function twiml(body) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(body)}</Message></Response>`;
}

function webhookUrl(req) {
  return (
    config.twilio.publicWebhookUrl ||
    `${req.protocol}://${req.get('host')}${req.originalUrl}`
  );
}

function hasValidSignature(req) {
  const { accountSid, authToken, validateSignature } = config.twilio;

  if (!validateSignature || !accountSid || !authToken) {
    return true;
  }

  return twilio.validateRequest(
    authToken,
    req.get('X-Twilio-Signature') || '',
    webhookUrl(req),
    req.body,
  );
}

function publicJson(report) {
  return {
    id: report.id,
    trackingId: report.trackingId,
    trackingUrl: report.trackingUrl,
    channel: report.channel,
    senderPhone: report.senderPhone,
    description: report.description,
    transcript: report.transcript,
    transcriptProvider: report.transcriptProvider,
    transcriptError: report.transcriptError,
    mediaUrl: report.mediaUrl,
    location: report.location,
    emergency: report.emergency,
    createdAt: report.createdAt,
    dprPath: report.dprPath,
    dprUrl: `/api/v1/telecom/reports/${report.id}/dpr`,
    persistedToPostgis: report.persistedToPostgis,
    acknowledgement: report.acknowledgement,
  };
}

async function handleWhatsAppWebhook(req, res, next) {
  try {
    if (!hasValidSignature(req)) {
      return res.status(403).json({ error: 'Invalid Twilio signature' });
    }

    const report = await ingestWhatsAppMessage(req.body);
    const body = report.acknowledgement.body;

    if (req.query.format === 'json') {
      return res.status(201).json(publicJson(report));
    }

    res.set('X-Jansankalp-Tracking-Id', report.trackingId);
    res.type('text/xml');

    // Twilio already delivered the acknowledgement over the REST API; an empty
    // TwiML response avoids sending the citizen a duplicate message.
    return res
      .status(201)
      .send(
        report.acknowledgement.delivered
          ? '<?xml version="1.0" encoding="UTF-8"?><Response/>'
          : twiml(body),
      );
  } catch (error) {
    return next(error);
  }
}

function listReports(_req, res) {
  return res.json(listIngestedReports().map(publicJson));
}

function getDpr(req, res) {
  const report = listIngestedReports().find((item) => item.id === req.params.id);

  if (!report || !report.dprPath) {
    return res.status(404).json({ error: 'DPR not found' });
  }

  return res.type('application/pdf').sendFile(report.dprPath);
}

module.exports = { handleWhatsAppWebhook, listReports, getDpr };
