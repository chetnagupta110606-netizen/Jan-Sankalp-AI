const crypto = require('crypto');
const config = require('../config');
const postgisRepository = require('../db/postgisRepository');
const { transcribe } = require('./speechToTextService');
const { extractLocation, isEmergency } = require('./locationExtractor');
const { generateDpr } = require('./dprService');
const { sendAcknowledgement } = require('./whatsappNotifier');

const ingestedReports = new Map();

function nextTrackingId(createdAt) {
  const year = new Date(createdAt).getUTCFullYear();
  const sequence = String(ingestedReports.size + 1).padStart(3, '0');
  return `JS-${year}-${sequence}`;
}

function parseCoordinates(payload) {
  const latitude = Number.parseFloat(payload.Latitude);
  const longitude = Number.parseFloat(payload.Longitude);

  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
}

function parseWhatsAppPayload(payload) {
  const mediaCount = Number.parseInt(payload.NumMedia, 10) || 0;
  const media = [];

  for (let index = 0; index < mediaCount; index += 1) {
    const url = payload[`MediaUrl${index}`];
    if (url) {
      media.push({ url, contentType: payload[`MediaContentType${index}`] || null });
    }
  }

  return {
    senderPhone: payload.From || null,
    text: payload.Body || '',
    media,
    voiceNote: media.find((item) => (item.contentType || '').startsWith('audio')) || null,
    photo: media.find((item) => (item.contentType || '').startsWith('image')) || null,
    coordinates: parseCoordinates(payload),
    messageSid: payload.MessageSid || payload.SmsMessageSid || null,
  };
}

async function ingestWhatsAppMessage(payload) {
  const message = parseWhatsAppPayload(payload);

  if (!message.senderPhone) {
    const error = new Error('Sender phone number (From) is required');
    error.status = 400;
    throw error;
  }

  const speech = await transcribe(message.voiceNote && message.voiceNote.url);
  const description = [speech.transcript, message.text].filter(Boolean).join(' ').trim();
  const location = extractLocation({
    text: description,
    coordinates: message.coordinates,
  });

  if (!location) {
    const error = new Error(
      'Could not resolve a location from the message text, transcript or shared pin',
    );
    error.status = 422;
    throw error;
  }

  const createdAt = new Date().toISOString();
  const trackingId = nextTrackingId(createdAt);

  const report = {
    id: crypto.randomUUID(),
    trackingId,
    trackingUrl: `${config.trackingBaseUrl}/${trackingId}`,
    channel: 'whatsapp',
    senderPhone: message.senderPhone,
    messageSid: message.messageSid,
    description: message.text || null,
    transcript: speech.transcript,
    transcriptProvider: speech.provider,
    transcriptError: speech.error,
    mediaUrl: (message.voiceNote || message.photo || message.media[0] || {}).url || null,
    location,
    emergency: isEmergency(description),
    createdAt,
    dprPath: null,
    persistedToPostgis: false,
  };

  report.dprPath = await generateDpr(report);

  if (postgisRepository.isEnabled()) {
    await postgisRepository.insertReport(report);
    report.persistedToPostgis = true;
  }

  ingestedReports.set(report.id, report);
  report.acknowledgement = await sendAcknowledgement(report);

  return report;
}

function listIngestedReports() {
  return [...ingestedReports.values()];
}

module.exports = {
  parseWhatsAppPayload,
  ingestWhatsAppMessage,
  listIngestedReports,
};
