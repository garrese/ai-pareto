import assert from 'node:assert/strict';
import test from 'node:test';

import { decodePubSubEnvelope, validateParetoEvent } from '../src/event.js';

const model = (id, name, intelligence, costPerTask) => ({
  id,
  name,
  metrics: { costPerTask, intelligence },
});

const event = {
  schemaVersion: 2,
  eventId: `sha256:${'a'.repeat(64)}`,
  type: 'pareto.model.moved',
  occurredAt: '2026-08-14T12:00:00.000Z',
  fromSnapshot: 'snapshot-before',
  toSnapshot: 'snapshot-after',
  frontId: 'cost-per-task-intelligence',
  objectives: [
    { key: 'costPerTask', dir: 'min' },
    { key: 'intelligence', dir: 'max' },
  ],
  tier: 0,
  previousTier: null,
  model: model('model-a', 'GPT-6 (high)', 61.2, 0.82),
  displaced: [model('model-b', 'Grok 4.6 (high)', 60.9, 0.8367)],
  neighbour: null,
};

test('a valid movement event is accepted and reduced to known fields', () => {
  const result = validateParetoEvent({ ...event, injected: 'ignored' });

  assert.equal(result.type, 'pareto.model.moved');
  assert.equal(result.model.name, 'GPT-6 (high)');
  assert.equal(result.displaced.length, 1);
  assert.equal(result.injected, undefined);
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

test('the v1 schema is no longer accepted', () => {
  assert.throws(
    () =>
      validateParetoEvent({
        schemaVersion: 1,
        eventId: event.eventId,
        type: 'pareto.front.changed',
        occurredAt: event.occurredAt,
        fromSnapshot: 'a',
        toSnapshot: 'b',
        frontId: 'price-intelligence',
        addedModelIds: ['model-a'],
        removedModelIds: [],
      }),
    /schemaVersion/,
  );
});

test('a sideways or downward move is rejected — only arrivals and promotions publish', () => {
  assert.throws(() => validateParetoEvent({ ...event, tier: 1, previousTier: 0 }), /arrival or a promotion/);
  assert.throws(() => validateParetoEvent({ ...event, tier: 1, previousTier: 1 }), /arrival or a promotion/);
  assert.doesNotThrow(() => validateParetoEvent({ ...event, tier: 0, previousTier: 2 }));
});

test('malformed payloads are rejected for dead-letter delivery', () => {
  assert.throws(() => validateParetoEvent({ ...event, type: 'something.else' }), /Unsupported event type/);
  assert.throws(() => validateParetoEvent({ ...event, eventId: 'nope' }), /eventId/);
  assert.throws(() => validateParetoEvent({ ...event, tier: 7 }), /Invalid tier/);
  assert.throws(() => validateParetoEvent({ ...event, objectives: [] }), /objectives/);
  assert.throws(() => validateParetoEvent({ ...event, model: { id: 'x' } }), /model identity/);
  assert.throws(() => validateParetoEvent({ ...event, displaced: 'no' }), /displaced/);
  assert.throws(() => decodePubSubEnvelope({ message: { data: 'not-json' } }), /base64-encoded/);
});

test('a digest event validates on its own terms', () => {
  const digest = {
    schemaVersion: 2,
    eventId: event.eventId,
    type: 'pareto.scan.digest',
    occurredAt: event.occurredAt,
    fromSnapshot: 'a',
    toSnapshot: 'b',
    frontId: event.frontId,
    objectives: event.objectives,
    moveCount: 11,
    perTier: [4, 5, 2],
    headline: { tier: 0, model: event.model },
  };

  const result = validateParetoEvent(digest);
  assert.equal(result.moveCount, 11);
  assert.deepEqual(result.perTier, [4, 5, 2]);
  assert.throws(() => validateParetoEvent({ ...digest, moveCount: 0 }), /moveCount/);
});
