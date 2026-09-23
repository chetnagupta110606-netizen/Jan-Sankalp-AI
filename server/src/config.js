const path = require('path');

module.exports = {
  port: Number(process.env.PORT || 4000),
  targetH3Cell: process.env.TARGET_H3_CELL || '8c2a100d36bffff',
  h3Resolution: Number(process.env.H3_RESOLUTION || 12),
  maxDistanceMeters: Number(process.env.MAX_DISTANCE_METERS || 50),
  similarityThreshold: Number(process.env.SIMILARITY_THRESHOLD || 0.65),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024),
  dprOutputDir:
    process.env.DPR_OUTPUT_DIR || path.join(__dirname, '..', 'generated', 'dpr'),
  trackingBaseUrl: process.env.TRACKING_BASE_URL || 'https://jansankalp.ai/track',
  databaseUrl: process.env.DATABASE_URL || null,
  speechToText: {
    provider: process.env.STT_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : 'none'),
    apiKey: process.env.OPENAI_API_KEY || null,
    model: process.env.STT_MODEL || 'whisper-1',
    endpoint:
      process.env.STT_ENDPOINT || 'https://api.openai.com/v1/audio/transcriptions',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || null,
    authToken: process.env.TWILIO_AUTH_TOKEN || null,
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
    validateSignature: process.env.TWILIO_VALIDATE_SIGNATURE !== 'false',
    publicWebhookUrl: process.env.PUBLIC_WEBHOOK_URL || null,
  },
};
