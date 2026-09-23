/**
 * Jan-Sankalp AI — Notification Service Stub
 * ------------------------------------------------------------------
 * Emits webhook-style events for status transitions that require citizen
 * notification or contractor escalation.
 * ------------------------------------------------------------------
 */

const STATUS_WEBHOOK_STATUSES = new Set(['ASSIGNED', 'PENDING_AUDIT', 'APPROVED']);

async function triggerStatusWebhook(report = {}, options = {}) {
  const status = String(report.status || '').trim().toUpperCase();
  const previousStatus = String(options.previousStatus || '').trim().toUpperCase();

  if (!STATUS_WEBHOOK_STATUSES.has(status)) {
    return {
      triggered: false,
      status,
      previousStatus,
      channels: []
    };
  }

  const channels = [];
  if (report.phone || options.phone) channels.push('sms');
  if (report.whatsapp || options.whatsapp) channels.push('whatsapp');

  const event = {
    id: report.id || null,
    status,
    previousStatus,
    channels,
    recipient: report.phone || options.phone || report.whatsapp || options.whatsapp || null,
    message: `Report ${report.id || 'unknown'} moved to ${status}.`,
    timestamp: new Date().toISOString()
  };

  const emitter = typeof options.emit === 'function' ? options.emit : (payload) => {
    console.log('[notification-webhook]', JSON.stringify(payload));
  };

  emitter(event);

  return {
    triggered: true,
    status,
    previousStatus,
    channels,
    event
  };
}

module.exports = {
  STATUS_WEBHOOK_STATUSES,
  triggerStatusWebhook
};
