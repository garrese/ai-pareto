import assert from 'node:assert/strict';
import test from 'node:test';

import { FirestoreCollectorState } from '../src/collector/firestore-state.js';

const clone = (value) => structuredClone(value);

class FakeDocumentSnapshot {
  constructor(reference, value) {
    this.reference = reference;
    this.exists = value !== undefined;
    this.value = value;
  }

  data() {
    return clone(this.value);
  }
}

class FakeDocumentReference {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
  }
}

class FakeQuery {
  constructor(firestore, collectionPath, field, value) {
    this.firestore = firestore;
    this.collectionPath = collectionPath;
    this.field = field;
    this.value = value;
    this.maximum = Infinity;
  }

  limit(maximum) {
    this.maximum = maximum;
    return this;
  }

  async get() {
    const prefix = `${this.collectionPath}/`;
    const docs = [...this.firestore.documents.entries()]
      .filter(([path, value]) => path.startsWith(prefix) && value[this.field] === this.value)
      .slice(0, this.maximum)
      .map(([path, value]) => new FakeDocumentSnapshot(new FakeDocumentReference(this.firestore, path), value));
    return { docs };
  }
}

class FakeCollectionReference {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
  }

  doc(id) {
    return new FakeDocumentReference(this.firestore, `${this.path}/${id}`);
  }

  where(field, operator, value) {
    assert.equal(operator, '==');
    return new FakeQuery(this.firestore, this.path, field, value);
  }
}

class FakeFirestore {
  constructor() {
    this.documents = new Map();
  }

  collection(path) {
    return new FakeCollectionReference(this, path);
  }

  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (reference) =>
        new FakeDocumentSnapshot(reference, this.documents.get(reference.path)),
      set: (reference, value) => writes.push([reference.path, clone(value)]),
    };
    const result = await callback(transaction);
    writes.forEach(([path, value]) => this.documents.set(path, value));
    return result;
  }
}

const manifest = (snapshotId) => ({
  path: 'public/latest.json',
  body: { snapshotId },
});
const FRONT = 'cost-per-task-intelligence';
const pareto = (snapshotId, tier) => ({
  snapshotId,
  fronts: [
    {
      frontId: FRONT,
      objectives: [
        { key: 'costPerTask', dir: 'min' },
        { key: 'intelligence', dir: 'max' },
      ],
      tiers: [tier],
    },
  ],
});
/** Change detection reads names and metrics from the dataset, not from the front. */
const MODELS = [
  { id: 'model-a', name: 'Model A', costPerTask: 0.5, intelligence: 50 },
  { id: 'model-b', name: 'Model B', costPerTask: 0.3, intelligence: 60 },
];

test('Firestore state establishes a baseline and transactionally creates later outbox events', async () => {
  const firestore = new FakeFirestore();
  const state = new FirestoreCollectorState(firestore);

  assert.equal(
    (await state.claimExecution({
      executionId: 'execution-1',
      claimedAt: '2026-08-14T12:00:00.000Z',
      leaseExpiresAt: '2026-08-14T12:15:00.000Z',
    })).action,
    'fetch',
  );
  const first = await state.prepareSnapshot({
    executionId: 'execution-1',
    snapshotId: 'snapshot-1',
    fetchedAt: '2026-08-14T12:00:00.000Z',
    generatedAt: '2026-08-14T12:00:01.000Z',
    modelCount: 1,
    rateLimit: null,
    manifest: manifest('snapshot-1'),
    paretoDocument: pareto('snapshot-1', ['model-a']),
    models: MODELS,
  });
  assert.equal(first.eventCount, 0);
  assert.deepEqual(
    firestore.documents.get(`pareto-state/${FRONT}`).tiers,
    [{ modelIds: ['model-a'] }],
  );
  await state.markSnapshotPublished({
    executionId: 'execution-1',
    snapshotId: 'snapshot-1',
    publishedAt: '2026-08-14T12:00:02.000Z',
  });

  assert.equal(
    (await state.claimExecution({
      executionId: 'execution-2',
      claimedAt: '2026-08-14T16:00:00.000Z',
      leaseExpiresAt: '2026-08-14T16:15:00.000Z',
    })).action,
    'fetch',
  );
  const second = await state.prepareSnapshot({
    executionId: 'execution-2',
    snapshotId: 'snapshot-2',
    fetchedAt: '2026-08-14T16:00:00.000Z',
    generatedAt: '2026-08-14T16:00:01.000Z',
    modelCount: 2,
    rateLimit: { limit: 100, remaining: 90 },
    manifest: manifest('snapshot-2'),
    paretoDocument: pareto('snapshot-2', ['model-a', 'model-b']),
    models: MODELS,
  });

  assert.equal(second.eventCount, 1);
  const [event] = await state.listPendingEvents(10);
  assert.equal(event.fromSnapshot, 'snapshot-1');
  assert.equal(event.toSnapshot, 'snapshot-2');
  assert.equal(event.type, 'pareto.model.moved');
  assert.equal(event.model.name, 'Model B');
  assert.equal(event.previousTier, null);
  assert.deepEqual(event.model.metrics, { costPerTask: 0.3, intelligence: 60 });

  await state.markEventEnqueued(event.eventId, 'message-1', '2026-08-14T16:00:02.000Z');
  assert.deepEqual(await state.listPendingEvents(10), []);
  assert.equal(firestore.documents.get(`outbox-events/${event.eventId}`).status, 'enqueued');
});

test('Firestore state resumes prepared work and rejects overlapping live leases', async () => {
  const firestore = new FakeFirestore();
  const state = new FirestoreCollectorState(firestore);
  await state.claimExecution({
    executionId: 'execution-1',
    claimedAt: '2026-08-14T12:00:00.000Z',
    leaseExpiresAt: '2026-08-14T12:15:00.000Z',
  });

  const busy = await state.claimExecution({
    executionId: 'execution-2',
    claimedAt: '2026-08-14T12:05:00.000Z',
    leaseExpiresAt: '2026-08-14T12:20:00.000Z',
  });
  assert.deepEqual(busy, { action: 'busy', ownerExecutionId: 'execution-1' });

  await state.prepareSnapshot({
    executionId: 'execution-1',
    snapshotId: 'snapshot-1',
    fetchedAt: '2026-08-14T12:00:00.000Z',
    generatedAt: '2026-08-14T12:00:01.000Z',
    modelCount: 1,
    rateLimit: null,
    manifest: manifest('snapshot-1'),
    paretoDocument: pareto('snapshot-1', ['model-a']),
    models: MODELS,
  });

  const resumed = await state.claimExecution({
    executionId: 'execution-2',
    claimedAt: '2026-08-14T12:06:00.000Z',
    leaseExpiresAt: '2026-08-14T12:21:00.000Z',
  });
  assert.equal(resumed.action, 'resume');
  assert.equal(resumed.refresh.executionId, 'execution-1');
});

const REFRESH_DOC = 'refresh-state/current';

test('the quota reading survives a claim so a retry can guard against it', async () => {
  const firestore = new FakeFirestore();
  const state = new FirestoreCollectorState(firestore);
  const rateLimit = {
    limit: 100,
    remaining: 2,
    resetsAt: '2026-08-24T18:00:00.000Z',
    source: 'headers',
  };

  // A completed refresh leaves both figures on the document.
  firestore.documents.set(REFRESH_DOC, {
    status: 'complete',
    snapshotId: 'snapshot-previous',
    rateLimit,
    pages: 4,
  });

  const claim = await state.claimExecution({
    executionId: 'execution-next',
    claimedAt: '2026-08-24T12:00:00.000Z',
    leaseExpiresAt: '2026-08-24T12:15:00.000Z',
  });

  assert.equal(claim.action, 'fetch');
  assert.deepEqual(claim.rateLimit, rateLimit);
  assert.equal(claim.pages, 4);

  // And they are still on the running document, which is the case that matters:
  // the next execution after one that died mid-refresh.
  const running = firestore.documents.get(REFRESH_DOC);
  assert.deepEqual(running.rateLimit, rateLimit);
  assert.equal(running.pages, 4);
});

test('a prepared snapshot records what the walk actually cost', async () => {
  const firestore = new FakeFirestore();
  const state = new FirestoreCollectorState(firestore);

  await state.claimExecution({
    executionId: 'execution-1',
    claimedAt: '2026-08-24T12:00:00.000Z',
    leaseExpiresAt: '2026-08-24T12:15:00.000Z',
  });
  await state.prepareSnapshot({
    executionId: 'execution-1',
    snapshotId: 'snapshot-1',
    fetchedAt: '2026-08-24T12:00:00.000Z',
    generatedAt: '2026-08-24T12:00:01.000Z',
    modelCount: MODELS.length,
    rateLimit: { limit: 100, remaining: 96, resetsAt: '2026-08-25T12:00:00.000Z' },
    pages: 5,
    manifest: manifest('snapshot-1'),
    paretoDocument: pareto('snapshot-1', ['model-b']),
    models: MODELS,
  });

  assert.equal(firestore.documents.get(REFRESH_DOC).pages, 5);
});

test('releasing a claim expires the lease without losing what the document held', async () => {
  const firestore = new FakeFirestore();
  const state = new FirestoreCollectorState(firestore);
  firestore.documents.set(REFRESH_DOC, {
    status: 'running',
    executionId: 'execution-deferred',
    claimedAt: '2026-08-24T12:00:00.000Z',
    leaseExpiresAt: '2026-08-24T12:15:00.000Z',
    previousSnapshotId: 'snapshot-previous',
    rateLimit: { limit: 100, remaining: 2 },
    pages: 4,
  });

  await state.releaseExecution({
    executionId: 'execution-deferred',
    releasedAt: '2026-08-24T12:00:01.000Z',
  });

  const released = firestore.documents.get(REFRESH_DOC);
  assert.equal(released.leaseExpiresAt, '2026-08-24T12:00:01.000Z');
  assert.equal(released.previousSnapshotId, 'snapshot-previous');
  assert.equal(released.pages, 4);

  // A later execution is then free to take it, previous snapshot intact.
  const claim = await state.claimExecution({
    executionId: 'execution-later',
    claimedAt: '2026-08-24T16:17:00.000Z',
    leaseExpiresAt: '2026-08-24T16:32:00.000Z',
  });
  assert.equal(claim.action, 'fetch');
  assert.equal(claim.previousSnapshotId, 'snapshot-previous');
});

test('releasing a claim owned by another execution changes nothing', async () => {
  const firestore = new FakeFirestore();
  const state = new FirestoreCollectorState(firestore);
  firestore.documents.set(REFRESH_DOC, {
    status: 'running',
    executionId: 'execution-owner',
    leaseExpiresAt: '2026-08-24T12:15:00.000Z',
  });

  await state.releaseExecution({
    executionId: 'execution-impostor',
    releasedAt: '2026-08-24T12:00:01.000Z',
  });

  assert.equal(firestore.documents.get(REFRESH_DOC).leaseExpiresAt, '2026-08-24T12:15:00.000Z');
});
