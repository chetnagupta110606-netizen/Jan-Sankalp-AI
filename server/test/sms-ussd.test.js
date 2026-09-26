const assert = require('assert');
const { parseSmsUssdCommand, resolveSmsUssdCommand } = require('../src/services/smsUssdService');

(async () => {
  const reportCommand = parseSmsUssdCommand('REPORT ROAD Pothole near school gate');
  assert.strictEqual(reportCommand.ok, true);
  assert.strictEqual(reportCommand.type, 'report');
  assert.strictEqual(reportCommand.category, 'ROAD');
  assert.strictEqual(reportCommand.location, 'school gate');

  const statusCommand = parseSmsUssdCommand('STATUS 42');
  assert.strictEqual(statusCommand.ok, true);
  assert.strictEqual(statusCommand.type, 'status');
  assert.strictEqual(statusCommand.token, '42');

  const result = await resolveSmsUssdCommand('REPORT WATER pipe burst near market');
  assert.strictEqual(result.success, true);
  assert.ok(result.incidentId !== undefined);
  assert.ok(result.text.includes('SUCCESS: Incident #'));

  const statusResult = await resolveSmsUssdCommand(`STATUS ${result.incidentId}`);
  assert.strictEqual(statusResult.success, true);
  assert.ok(statusResult.text.includes('STATUS:'));

  console.log('[sms-ussd] parser and simulator validation passed.');
})();
