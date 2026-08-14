import assert from 'node:assert/strict';
import test from 'node:test';

import { eventMarker, renderPost } from '../src/render.js';

const event = {
  eventId: `sha256:${'a'.repeat(64)}`,
  toSnapshot: 'snapshot-after',
  frontId: 'cost-per-task-intelligence',
  addedModelIds: ['model-a'],
  removedModelIds: ['model-b'],
};

test('post rendering is deterministic and carries a reconciliation marker', () => {
  const first = renderPost(event, 'https://example.test/');
  const second = renderPost(event, 'https://example.test/');
  assert.deepEqual(second, first);
  assert.match(first.text, /Added \(1\): model-a/);
  assert.ok(first.text.endsWith(eventMarker(event.eventId)));
  assert.ok(Array.from(first.text).length <= 280);
});

test('large changes fall back to counts while preserving the marker', () => {
  const modelIds = Array.from({ length: 100 }, (_, index) => `very-long-model-id-${index}`);
  const result = renderPost({ ...event, addedModelIds: modelIds, removedModelIds: modelIds });
  assert.match(result.text, /Added: 100 · Removed: 100/);
  assert.ok(result.text.endsWith(eventMarker(event.eventId)));
  assert.ok(Array.from(result.text).length <= 280);
});
