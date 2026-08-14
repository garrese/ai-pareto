import assert from 'node:assert/strict';
import test from 'node:test';

import { FirestoreDeliveryStore } from '../src/delivery-store.js';

class Reference {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
  }

  collection(name) {
    return new Collection(this.firestore, `${this.path}/${name}`);
  }
}

class Collection {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
  }

  doc(id) {
    return new Reference(this.firestore, `${this.path}/${id}`);
  }
}

class FakeFirestore {
  constructor() {
    this.documents = new Map();
  }

  collection(name) {
    return new Collection(this, name);
  }

  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (reference) => {
        const value = this.documents.get(reference.path);
        return {
          exists: value !== undefined,
          data: () => structuredClone(value),
        };
      },
      set: (reference, value) => writes.push([reference.path, structuredClone(value)]),
    };
    const result = await callback(transaction);
    writes.forEach(([path, value]) => this.documents.set(path, value));
    return result;
  }
}

const claim = (store, ownerId, claimedAt = '2026-08-14T12:00:00.000Z') =>
  store.claim({
    eventId: `sha256:${'a'.repeat(64)}`,
    ownerId,
    claimedAt,
    leaseExpiresAt: new Date(Date.parse(claimedAt) + 300_000).toISOString(),
  });

test('delivery store prevents concurrent claims and permanently deduplicates sent events', async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreDeliveryStore(firestore);

  assert.equal((await claim(store, 'owner-1')).status, 'acquired');
  assert.equal((await claim(store, 'owner-2', '2026-08-14T12:01:00.000Z')).status, 'busy');

  await store.markSent({
    eventId: `sha256:${'a'.repeat(64)}`,
    ownerId: 'owner-1',
    postId: 'post-1',
    sentAt: '2026-08-14T12:01:01.000Z',
    reconciled: false,
  });

  assert.deepEqual(await claim(store, 'owner-3', '2026-08-14T13:00:00.000Z'), {
    status: 'sent',
    postId: 'post-1',
  });
});

test('failed and expired deliveries can be claimed again', async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreDeliveryStore(firestore);
  const eventId = `sha256:${'a'.repeat(64)}`;

  await claim(store, 'owner-1');
  await store.markFailed({
    eventId,
    ownerId: 'owner-1',
    failedAt: '2026-08-14T12:00:01.000Z',
    error: 'temporary failure',
  });
  assert.equal((await claim(store, 'owner-2', '2026-08-14T12:00:02.000Z')).status, 'acquired');

  assert.equal((await claim(store, 'owner-3', '2026-08-14T12:06:00.000Z')).status, 'acquired');
});
