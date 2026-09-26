/**
 * Jan-Sankalp AI — SMS simulator controller
 * ------------------------------------------------------------------
 * Receives raw text strings, invokes the parser service, and returns a
 * carrier-grade USSD/SMS response text for low-connectivity users.
 * ------------------------------------------------------------------
 */

const { resolveSmsUssdCommand } = require('../services/smsUssdService');

async function simulateSmsCommand(req, res) {
  try {
    const payload = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const rawCommand = typeof payload.command === 'string'
      ? payload.command
      : typeof payload.text === 'string'
        ? payload.text
        : typeof payload.message === 'string'
          ? payload.message
          : '';

    const result = await resolveSmsUssdCommand(rawCommand);
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json({
      success: result.success,
      type: result.type || 'sms',
      command: result.command,
      text: result.text || result.message || '',
      message: result.message || result.text || '',
      incidentId: result.incidentId || null,
      incident: result.incident || null,
      status: result.status || null,
      code: result.code || null
    });
  } catch (err) {
    console.error('[smsController] simulate failed:', err && err.message);
    return res.status(500).json({
      success: false,
      type: 'sms',
      text: 'SMS command failed. Please try again.',
      message: 'SMS command failed. Please try again.',
      code: 'SMS_PROCESSING_ERROR',
      incidentId: null,
      incident: null,
      status: null
    });
  }
}

module.exports = {
  simulateSmsCommand
};
