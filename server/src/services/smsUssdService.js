/**
 * Jan-Sankalp AI — SMS / USSD fallback parser
 * ------------------------------------------------------------------
 * Accepts lightweight command strings from feature phones and converts
 * them into the platform's existing incident workflow.
 * ------------------------------------------------------------------
 */

const db = require('../config/database');

function normalizeCommand(command) {
  return String(command || '').trim();
}

function parseSmsUssdCommand(rawCommand) {
  const command = normalizeCommand(rawCommand);
  if (!command) {
    return {
      ok: false,
      code: 'EMPTY_COMMAND',
      message: 'Please send a command such as REPORT <category> <description> <location> or STATUS <token>.'
    };
  }

  if (/^REPORT\b/i.test(command)) {
    const match = command.match(/^REPORT\s+([A-Z0-9_-]+)\s+(.*)$/i);
    if (!match) {
      return {
        ok: false,
        code: 'REPORT_FORMAT_ERROR',
        message: 'Format: REPORT <category> <description> <location>'
      };
    }

    const category = String(match[1] || '').trim();
    const rest = String(match[2] || '').trim();
    if (!rest) {
      return {
        ok: false,
        code: 'REPORT_MISSING_DESCRIPTION',
        message: 'Format: REPORT <category> <description> <location>'
      };
    }

    const locationKeywords = [' near ', ' at ', ' in ', ' by ', ' outside ', ' inside '];
    let description = rest;
    let location = 'Unspecified';

    const splitMatch = locationKeywords
      .map((keyword) => ({ keyword, index: rest.toLowerCase().indexOf(keyword.trim()) }))
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => a.index - b.index)[0];

    if (splitMatch) {
      const locationIndex = splitMatch.index + splitMatch.keyword.length - 1;
      description = rest.slice(0, locationIndex).trim();
      location = rest.slice(locationIndex).trim();
    } else if (rest.includes(' ')) {
      const parts = rest.split(/\s+/);
      description = parts.slice(0, -1).join(' ');
      location = parts[parts.length - 1];
    }

    return {
      ok: true,
      type: 'report',
      category: category.toUpperCase(),
      description: description || 'General civic issue',
      location: location || 'Unspecified'
    };
  }

  if (/^STATUS\b/i.test(command)) {
    const match = command.match(/^STATUS\s+(.+)$/i);
    if (!match) {
      return {
        ok: false,
        code: 'STATUS_FORMAT_ERROR',
        message: 'Format: STATUS <token>'
      };
    }

    const token = String(match[1] || '').trim();
    if (!token) {
      return {
        ok: false,
        code: 'STATUS_MISSING_TOKEN',
        message: 'Format: STATUS <token>'
      };
    }

    return {
      ok: true,
      type: 'status',
      token
    };
  }

  return {
    ok: false,
    code: 'UNSUPPORTED_COMMAND',
    message: 'Unsupported command. Use REPORT <category> <description> <location> or STATUS <token>.'
  };
}

async function updateSmsUssdStatus(payload = {}) {
  await db.init();
  const incidentId = String(payload.id || payload.incidentId || payload.token || '').trim();
  const status = String(payload.status || '').trim();
  const message = String(payload.message || '').trim();

  if (!incidentId) {
    return {
      success: false,
      code: 'MISSING_INCIDENT_ID',
      text: 'ERR: Incident id is required for status updates.',
      message: 'Incident id is required for status updates.'
    };
  }

  const nextStatus = [
    'Pending Survey',
    'Under Survey',
    'Scheduled for Action',
    'Action Taken / Resolved',
    'Resolved',
    'SLA Breached',
    'Assigned'
  ].includes(status) ? status : 'Under Survey';

  const existing = await db.getIncidentById(incidentId);
  if (!existing) {
    return {
      success: false,
      code: 'INCIDENT_NOT_FOUND',
      text: `ERR: No incident found for ${incidentId}.`,
      message: `No incident found for ${incidentId}.`
    };
  }

  const updated = await db.updateIncident(incidentId, {
    status: nextStatus,
    assigned_ministry: payload.assigned_ministry || existing.assigned_ministry || 'Ministry of Housing and Urban Affairs',
    target_completion_date: payload.target_completion_date || existing.target_completion_date || null,
    source: existing.source || 'SMS / USSD fallback'
  });

  const responseText = message
    ? `ACK: ${message} New status: ${updated.status}.`
    : `ACK: Incident ${updated.id} updated to ${updated.status}.`;

  return {
    success: true,
    type: 'status-update',
    incidentId: updated.id,
    status: updated.status,
    text: responseText,
    message: responseText,
    data: updated
  };
}

async function resolveSmsUssdCommand(command) {
  await db.init();
  const parsed = parseSmsUssdCommand(command);
  if (!parsed.ok) {
    return {
      success: false,
      command: normalizeCommand(command),
      code: parsed.code,
      text: parsed.message,
      message: parsed.message
    };
  }

  if (parsed.type === 'report') {
    const incident = await db.insertIncident({
      transcript: parsed.description,
      category: parsed.category,
      urgency: 'Medium',
      status: 'Pending Survey',
      location_name: parsed.location || 'SMS / USSD fallback',
      h3_index: 'sms-ussd-fallback',
      source: 'SMS / USSD fallback',
      created_at: new Date().toISOString()
    });

    const incidentId = incident && incident.id ? incident.id : 'unknown';
    const responseText = `SUCCESS: Incident #${incidentId} logged. Token: ${incidentId}`;

    return {
      success: true,
      command: normalizeCommand(command),
      type: 'report',
      text: responseText,
      message: responseText,
      incidentId,
      status: 'Pending Survey',
      incident
    };
  }

  if (parsed.type === 'status') {
    const incidentId = String(parsed.token || '').trim();
    const incident = await db.getIncidentById(incidentId);
    if (!incident) {
      return {
        success: false,
        command: normalizeCommand(command),
        code: 'INVALID_STATUS_TOKEN',
        text: `ERR: No report found for token ${incidentId}.`,
        message: `No report found for token ${incidentId}.`
      };
    }

    const responseText = `STATUS: ${incident.status || 'Pending Survey'} | Ref ${incident.id}.`;
    return {
      success: true,
      command: normalizeCommand(command),
      type: 'status',
      text: responseText,
      message: responseText,
      incidentId: incident.id,
      status: incident.status || 'Pending Survey',
      incident
    };
  }

  return {
    success: false,
    command: normalizeCommand(command),
    code: 'UNSUPPORTED_COMMAND',
    text: 'Unsupported command. Use REPORT <category> <description> <location> or STATUS <token>.',
    message: 'Unsupported command. Use REPORT <category> <description> <location> or STATUS <token>.'
  };
}

module.exports = {
  normalizeCommand,
  parseSmsUssdCommand,
  resolveSmsUssdCommand,
  updateSmsUssdStatus
};
