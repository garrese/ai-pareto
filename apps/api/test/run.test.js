import assert from 'node:assert/strict';
import test from 'node:test';

import { runCollector } from '../src/collector/run.js';

const models = [
  { id: 'model-a', intelligence: 10, price: 1, costPerTask: 0.2 },
  { id: 'model-b', intelligence: 12, price: 2, costPerTask: 0.3 },
];
const pendingEvent = {
  schemaVersion: 1,
  eventId: 'sha256:event',
  type: 'pareto.front.changed',
  occurredAt: '2026-08-14T12:00:00.000Z',
  fromSnapshot: 'snapshot-old',
  toSnapshot: 'snapshot-new',
  frontId: 'price-intelligence',
  addedModelIds: ['model-a'],
  removedModelIds: [],
};

test('collector prepares state before exposing the manifest and then drains the outbox', async () => {
  const calls = [];
  let pending = true;
  const state = {
    async claimExecution() {
      calls.push('claim');
      return { action: 'fetch' };
    },
    async prepareSnapshot() {
      calls.push('prepare');
    },
    async markSnapshotPublished() {
      calls.push('mark-published');
    },
    async listPendingEvents() {
      calls.push('list-outbox');
      if (!pending) return [];
      return [pendingEvent];
    },
    async markEventEnqueued() {
      calls.push('mark-enqueued');
      pending = false;
    },
  };

  const result = await runCollector({
    executionId: 'execution-1',
    leaseSeconds: 900,
    source: {
      async fetchModels() {
        calls.push('fetch');
        return {
          models,
          fetchedAt: '2026-08-14T12:00:00.000Z',
          pages: 1,
          rateLimit: { limit: 100, remaining: 99 },
        };
      },
    },
    storage: {
      async putImmutable(path) {
        calls.push(`immutable:${path.split('/').at(-1)}`);
      },
      async putManifest() {
        calls.push('manifest');
      },
    },
    state,
    eventBus: {
      async publish() {
        calls.push('publish-event');
        return 'message-1';
      },
    },
    now: () => new Date('2026-08-14T12:00:00.000Z'),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.fetched, true);
  assert.equal(result.enqueued, 1);
  assert.ok(calls.indexOf('prepare') > calls.indexOf('immutable:pareto.json'));
  assert.ok(calls.indexOf('manifest') > calls.indexOf('prepare'));
  assert.ok(calls.indexOf('mark-published') > calls.indexOf('manifest'));
  assert.ok(calls.indexOf('publish-event') > calls.indexOf('mark-published'));
});

test('a prepared snapshot resumes at the manifest without fetching or rewriting immutable data', async () => {
  const calls = [];
  const manifest = {
    path: 'public/latest.json',
    body: { snapshotId: 'snapshot-prepared' },
  };
  const result = await runCollector({
    executionId: 'execution-new',
    leaseSeconds: 900,
    source: { async fetchModels() { throw new Error('must not fetch'); } },
    storage: {
      async putImmutable() {
        throw new Error('must not write immutable objects');
      },
      async putManifest(path, body) {
        calls.push(['manifest', path, body.snapshotId]);
      },
    },
    state: {
      async claimExecution() {
        return {
          action: 'resume',
          refresh: {
            executionId: 'execution-original',
            snapshotId: 'snapshot-prepared',
            manifest,
          },
        };
      },
      async markSnapshotPublished(input) {
        calls.push(['mark', input.executionId, input.snapshotId]);
      },
      async listPendingEvents() {
        return [];
      },
    },
    eventBus: { async publish() { throw new Error('nothing to publish'); } },
    now: () => new Date('2026-08-14T12:00:00.000Z'),
  });

  assert.equal(result.fetched, false);
  assert.deepEqual(calls[0], ['manifest', 'public/latest.json', 'snapshot-prepared']);
  assert.deepEqual(calls[1], ['mark', 'execution-original', 'snapshot-prepared']);
});

test('a Pub/Sub retry for the same execution drains the outbox without refetching', async () => {
  let status = 'new';
  let fetches = 0;
  let publishAttempts = 0;
  let pending = true;
  let manifest;
  let snapshotId;
  const state = {
    async claimExecution() {
      if (status === 'complete') {
        return { action: 'drain', refresh: { snapshotId } };
      }
      status = 'running';
      return { action: 'fetch' };
    },
    async prepareSnapshot(input) {
      status = 'prepared';
      manifest = input.manifest;
      snapshotId = input.snapshotId;
    },
    async markSnapshotPublished() {
      status = 'complete';
    },
    async listPendingEvents() {
      return pending ? [pendingEvent] : [];
    },
    async markEventEnqueued() {
      pending = false;
    },
  };
  const input = {
    executionId: 'execution-1',
    leaseSeconds: 900,
    source: {
      async fetchModels() {
        fetches += 1;
        return { models, fetchedAt: '2026-08-14T12:00:00.000Z', pages: 1 };
      },
    },
    storage: {
      async putImmutable() {},
      async putManifest(_path, body) {
        assert.equal(body.snapshotId, manifest?.body.snapshotId ?? body.snapshotId);
      },
    },
    state,
    eventBus: {
      async publish() {
        publishAttempts += 1;
        if (publishAttempts === 1) throw new Error('Pub/Sub unavailable');
        return 'message-2';
      },
    },
    now: () => new Date('2026-08-14T12:00:00.000Z'),
  };

  await assert.rejects(() => runCollector(input), /Pub\/Sub unavailable/);
  const retried = await runCollector(input);

  assert.equal(retried.fetched, false);
  assert.equal(retried.enqueued, 1);
  assert.equal(fetches, 1);
  assert.equal(publishAttempts, 2);
});

test('a refresh logs real data changes, every changed front, and the publication decision', async () => {
  const logs = [];
  const publicationEvent = {
    schemaVersion: 2,
    eventId: `sha256:${'a'.repeat(64)}`,
    type: 'pareto.model.moved',
    fromSnapshot: 'snapshot-previous',
    toSnapshot: 'snapshot-current',
    frontId: 'cost-per-task-intelligence',
    tier: 0,
    previousTier: null,
    model: { id: 'model-b', name: 'Model B', metrics: {} },
    displaced: [],
    neighbour: null,
  };
  const previousModels = {
    snapshotId: 'snapshot-previous',
    models: [{ id: 'model-a', intelligence: 9, price: 1, costPerTask: 0.2 }],
  };
  const previousPareto = {
    snapshotId: 'snapshot-previous',
    fronts: [
      {
        frontId: 'cost-per-task-intelligence',
        objectives: [],
        tiers: [['model-a'], [], []],
      },
      { frontId: 'price-intelligence', objectives: [], tiers: [['model-a'], [], []] },
    ],
  };

  await runCollector({
    executionId: 'execution-audit',
    leaseSeconds: 900,
    source: {
      async fetchModels() {
        return { models, fetchedAt: '2026-08-14T12:00:00.000Z', pages: 1 };
      },
    },
    storage: {
      async getJson(path) {
        return path.endsWith('/models.json') ? previousModels : previousPareto;
      },
      async putImmutable() {},
      async putManifest() {},
    },
    state: {
      async claimExecution() {
        return { action: 'fetch', previousSnapshotId: 'snapshot-previous' };
      },
      async prepareSnapshot() {
        return { eventCount: 1, events: [publicationEvent] };
      },
      async markSnapshotPublished() {},
      async listPendingEvents() {
        return [];
      },
    },
    eventBus: { async publish() { throw new Error('nothing to publish'); } },
    now: () => new Date('2026-08-14T12:00:01.000Z'),
    log(severity, message, fields) {
      logs.push({ severity, message, ...fields });
    },
  });

  const dataChange = logs.find(({ event }) => event === 'data.refresh.changed');
  assert.equal(dataChange.changes.addedCount, 1);
  assert.equal(dataChange.changes.updatedCount, 1);
  assert.equal(logs.filter(({ event }) => event === 'pareto.front.changed').length, 2);
  assert.equal(
    logs.find(({ event }) => event === 'pareto.publication.planned').eventId,
    publicationEvent.eventId,
  );
});
