import assert from 'node:assert/strict';
import test from 'node:test';

import { createParetoChangeEvents } from '../src/collector/events.js';

const occurredAt = '2026-08-14T12:30:00.000Z';
const document = (snapshotId, firstTier, secondTier = []) => ({
  snapshotId,
  fronts: [
    {
      frontId: 'price-intelligence',
      tiers: [firstTier, secondTier],
    },
  ],
});

test('the first snapshot establishes a baseline without emitting events', () => {
  assert.deepEqual(
    createParetoChangeEvents({
      current: document('snapshot-first', ['model-a']),
      occurredAt,
    }),
    [],
  );
});

test('changes below the outermost front do not emit events', () => {
  assert.deepEqual(
    createParetoChangeEvents({
      previous: document('snapshot-before', ['model-a'], ['model-b']),
      current: document('snapshot-after', ['model-a'], ['model-c']),
      occurredAt,
    }),
    [],
  );
});

test('front changes produce deterministic versioned events', () => {
  const previous = document('snapshot-before', ['model-b', 'model-a']);
  const current = document('snapshot-after', ['model-c', 'model-b']);
  const [event] = createParetoChangeEvents({ previous, current, occurredAt });

  assert.deepEqual(event, {
    schemaVersion: 1,
    eventId: event.eventId,
    type: 'pareto.front.changed',
    occurredAt,
    fromSnapshot: 'snapshot-before',
    toSnapshot: 'snapshot-after',
    frontId: 'price-intelligence',
    addedModelIds: ['model-c'],
    removedModelIds: ['model-a'],
  });
  assert.match(event.eventId, /^sha256:[a-f0-9]{64}$/);

  const [sameIdentity] = createParetoChangeEvents({
    previous: document('different-before', ['model-a', 'model-b']),
    current: document('different-after', ['model-b', 'model-c']),
    occurredAt: '2026-08-14T13:30:00.000Z',
  });
  assert.equal(sameIdentity.eventId, event.eventId);
});
