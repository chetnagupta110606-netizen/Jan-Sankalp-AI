const config = require('../config');

async function fetchMedia(mediaUrl) {
  const headers = {};
  const { accountSid, authToken } = config.twilio;

  if (accountSid && authToken && mediaUrl.includes('api.twilio.com')) {
    headers.Authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
  }

  const response = await fetch(mediaUrl, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download media (${response.status})`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}

async function transcribeWithOpenAi(media) {
  const form = new FormData();
  form.append('model', config.speechToText.model);
  form.append(
    'file',
    new Blob([media.buffer], { type: media.contentType }),
    'voice-note.ogg',
  );

  const response = await fetch(config.speechToText.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.speechToText.apiKey}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Speech-to-text failed (${response.status})`);
  }

  const payload = await response.json();
  return payload.text || '';
}

async function transcribe(mediaUrl) {
  if (!mediaUrl) {
    return { transcript: null, provider: null, error: null };
  }

  if (config.speechToText.provider !== 'openai' || !config.speechToText.apiKey) {
    return {
      transcript: null,
      provider: 'none',
      error:
        'No speech-to-text provider configured; falling back to the message text body.',
    };
  }

  try {
    const media = await fetchMedia(mediaUrl);
    return {
      transcript: await transcribeWithOpenAi(media),
      provider: 'openai',
      error: null,
    };
  } catch (error) {
    return { transcript: null, provider: 'openai', error: error.message };
  }
}

module.exports = { transcribe };
