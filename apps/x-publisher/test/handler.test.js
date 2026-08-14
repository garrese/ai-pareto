import assert from 'node:assert/strict';
import test from 'node:test';

import { createPushHandler } from '../src/handler.js';

const event = {
  schemaVersion: 1,
  eventId: `sha256:${'a'.repeat(64)}`,
  type: 'pareto.front.changed',
  occurredAt: '2026-08-14T12:00:00.000Z',
  fromSnapshot: 'snapshot-before',
  toSnapshot: 'snapshot-after',
  frontId: 'price-intelligence',
  addedModelIds: ['model-a'],
  removedModelIds: [],
};
const envelope = {
  message: {
    data: Buffer.from(JSON.stringify(event)).toString('base64'),
    messageId: 'message-1',
  },
  deliveryAttempt: 1,
};

const handler = ({ claim, find = null, create = { id: 'post-new' } }) => {
  const calls = [];
  const handle = createPushHandler({
    deliveryStore: {
      async claim() {
        calls.push('claim');
        return claim;
      },
      async markSent(input) {
        calls.push(['sent', input]);
      },
      async markFailed(input) {
        calls.push(['failed', input]);
      },
    },
    xClient: {
      async findPostByMarker() {
        calls.push('find');
        if (find instanceof Error) throw find;
        return find;
      },
      async createPost() {
        calls.push('create');
        if (create instanceof Error) throw create;
        return create;
      },
    },
    leaseSeconds: 300,
    now: () => new Date('2026-08-14T12:00:00.000Z'),
  });
  return { handle, calls };
};

test('already sent events acknowledge without calling X', async () => {
  const { handle, calls } = handler({ claim: { status: 'sent', postId: 'post-old' } });
  const result = await handle(envelope, 'request-1');
  assert.equal(result.statusCode, 204);
  assert.equal(result.outcome, 'duplicate');
  assert.deepEqual(calls, ['claim']);
});

test('reconciliation records a matching existing post without creating another', async () => {
  const { handle, calls } = handler({
    claim: { status: 'acquired' },
    find: { id: 'post-existing' },
  });
  const result = await handle(envelope, 'request-1');
  assert.equal(result.outcome, 'reconciled');
  assert.equal(calls.includes('create'), false);
  assert.equal(calls.find((entry) => Array.isArray(entry) && entry[0] === 'sent')[1].reconciled, true);
});

test('a new event publishes once and stores the post ID before acknowledging', async () => {
  const { handle, calls } = handler({ claim: { status: 'acquired' } });
  const result = await handle(envelope, 'request-1');
  assert.equal(result.outcome, 'published');
  assert.ok(calls.indexOf('find') < calls.indexOf('create'));
  const sent = calls.find((entry) => Array.isArray(entry) && entry[0] === 'sent')[1];
  assert.equal(sent.postId, 'post-new');
});

test('delivery failures release the lease and return a retryable response', async () => {
  const { handle, calls } = handler({
    claim: { status: 'acquired' },
    find: new Error('X unavailable'),
  });
  const result = await handle(envelope, 'request-1');
  assert.equal(result.statusCode, 500);
  assert.equal(result.outcome, 'failed');
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === 'failed'));
});

test('invalid events return a non-success response so Pub/Sub can dead-letter them', async () => {
  const { handle, calls } = handler({ claim: { status: 'acquired' } });
  const result = await handle({ message: { data: 'invalid' } }, 'request-1');
  assert.equal(result.statusCode, 400);
  assert.deepEqual(calls, []);
});
