import test from 'node:test';
import assert from 'node:assert/strict';
import { GATE_ASK_PREFIX, isGateAsk } from '../lib/gate.js';

test('GATE ask marker is the reserved reason prefix', () => {
  assert.equal(GATE_ASK_PREFIX, 'GATE-ASK:');
  assert.equal(isGateAsk({ reason: 'GATE-ASK: recursive-delete rm -rf ./build' }), true);
  assert.equal(isGateAsk({ reason: 'GATE-ASK:' }), true);
  assert.equal(isGateAsk({ reason: 'GATE-ASK' }), false);
  assert.equal(isGateAsk({ reason: 'gate-ask: recursive-delete' }), false);
  assert.equal(isGateAsk({ reason: 'prefix GATE-ASK: recursive-delete' }), false);
  assert.equal(isGateAsk({ reason: '' }), false);
  assert.equal(isGateAsk({}), false);
  assert.equal(isGateAsk(null), false);
  assert.equal(isGateAsk('GATE-ASK: recursive-delete'), false);
});

test('GATE ask marker is also honored in displayReason when reason is absent', () => {
  assert.equal(isGateAsk({ displayReason: 'GATE-ASK: 递归删除' }), true);
  assert.equal(isGateAsk({ reason: 'normal ask', displayReason: 'GATE-ASK: 递归删除' }), true);
});
