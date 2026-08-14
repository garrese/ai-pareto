import assert from 'node:assert/strict';
import test from 'node:test';

import { decodePubSubEnvelope, validateParetoChangeEvent } from '../src/event.js';

const event = {
  schemaVersion: 1,
  eventId: `sha256:${'a'.repeat(64)}`,
  type: 'pareto.front.changed',
  occurredAt: '2026-08-14T12:00:00.000Z',
  fromSnapshot: 'snapshot-before',
  toSnapshot: 'snapshot-after',
  frontId: 'price-intelligence',
  addedModelIds: ['model-b', 'model-a'],
  removedModelIds: ['model-c'],
};

test('valid Pareto events are canonicalized', () => {
  const result = validateParetoChangeEvent(event);
  assert.deepEqual(result.addedModelIds, ['model-a', 'model-b']);
});

test('Pub/Sub push envelopes decode base64 JSON and delivery metadata', () => {
  const result = decodePubSubEnvelope({
    message: {
      data: Buffer.from(JSON.stringify(event)).toString('base64'),
      messageId: 'message-1',
    },
    deliveryAttempt: 2,
  });
  assert.equal(result.event.eventId, event.eventId);
  assert.equal(result.messageId, 'message-1');
  assert.equal(result.deliveryAttempt, 2);
});

test('unsupported or empty events are rejected for dead-letter delivery', () => {
  assert.throws(() => validateParetoChangeEvent({ ...event, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(
    () => validateParetoChangeEvent({ ...event, addedModelIds: [], removedModelIds: [] }),
    /no changes/,
  );
  assert.throws(() => decodePubSubEnvelope({ message: { data: 'not-json' } }), /base64-encoded/);
});
