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
const pareto = (snapshotId, tier) => ({
  snapshotId,
  fronts: [
    {
      frontId: 'price-intelligence',
      objectives: [
        { key: 'price', dir: 'min' },
        { key: 'intelligence', dir: 'max' },
      ],
      tiers: [tier],
    },
  ],
});

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
  });
  assert.equal(first.eventCount, 0);
  assert.deepEqual(
    firestore.documents.get('pareto-state/price-intelligence').tiers,
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
  });

  assert.equal(second.eventCount, 1);
  const [event] = await state.listPendingEvents(10);
  assert.equal(event.fromSnapshot, 'snapshot-1');
  assert.equal(event.toSnapshot, 'snapshot-2');
  assert.deepEqual(event.addedModelIds, ['model-b']);

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
  });

  const resumed = await state.claimExecution({
    executionId: 'execution-2',
    claimedAt: '2026-08-14T12:06:00.000Z',
    leaseExpiresAt: '2026-08-14T12:21:00.000Z',
  });
  assert.equal(resumed.action, 'resume');
  assert.equal(resumed.refresh.executionId, 'execution-1');
});
