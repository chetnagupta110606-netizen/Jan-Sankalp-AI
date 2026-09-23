const test = require('node:test');
const assert = require('node:assert/strict');

const { cellCenter, cellForPoint } = require('../src/utils/geo');

test('resolves the programme cell id to its surveyed Jaipur coordinates', () => {
  const center = cellCenter('8c2a100d36bffff');
  assert.ok(Math.abs(center.latitude - 26.9239) < 0.01);
  assert.ok(Math.abs(center.longitude - 75.8267) < 0.01);
});

test('decodes ordinary H3 cells and round-trips a point', () => {
  const cell = cellForPoint({ latitude: 26.9239, longitude: 75.8267 }, 12);
  const center = cellCenter(cell);
  assert.equal(cellForPoint(center, 12), cell);
});

test('rejects cell ids that are neither valid H3 nor known', () => {
  assert.throws(() => cellCenter('not-a-cell'), /Unknown H3 cell/);
});
