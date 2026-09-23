const twilio = require('twilio');
const config = require('../config');

let client = null;

function getClient() {
  const { accountSid, authToken } = config.twilio;
  if (!accountSid || !authToken) {
    return null;
  }
  if (!client) {
    client = twilio(accountSid, authToken);
  }
  return client;
}

function buildAcknowledgement(report) {
  return (
    `Jan-Sankalp AI: Your emergency infrastructure report for ${report.location.name} ` +
    `has been grounded. H3 Cell ID: ${report.location.h3Cell}. ` +
    `Track DPR Audit: ${report.trackingUrl}`
  );
}

async function sendAcknowledgement(report) {
  const body = buildAcknowledgement(report);
  const messaging = getClient();

  if (!messaging) {
    return { body, delivered: false, reason: 'Twilio credentials are not configured' };
  }

  const message = await messaging.messages.create({
    from: config.twilio.whatsappFrom,
    to: report.senderPhone,
    body,
  });

  return { body, delivered: true, sid: message.sid };
}

module.exports = { buildAcknowledgement, sendAcknowledgement };
