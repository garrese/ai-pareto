import { MONITORED_PARETO_FRONTS } from './definitions.js';
import { createParetoChangeEvents } from './events.js';

/** Strips the outbox bookkeeping (status, attempts) back to the event itself. */
const eventFields = ({ status, createdAt, publishAttempts, messageId, enqueuedAt, ...event }) =>
  event;

const frontForFirestore = (front) => ({
  ...front,
  tiers: front.tiers.map((modelIds) => ({ modelIds })),
});

const frontFromFirestore = (front) => ({
  ...front,
  tiers: (front.tiers ?? []).map(({ modelIds }) => modelIds ?? []),
});

export class FirestoreCollectorState {
  constructor(firestore) {
    this.firestore = firestore;
    this.refreshRef = firestore.collection('refresh-state').doc('current');
    this.paretoCollection = firestore.collection('pareto-state');
    this.outboxCollection = firestore.collection('outbox-events');
  }

  async claimExecution({ executionId, claimedAt, leaseExpiresAt }) {
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(this.refreshRef);
      const current = snapshot.exists ? snapshot.data() : null;

      if (current?.status === 'prepared') {
        return { action: 'resume', refresh: current };
      }
      if (current?.status === 'complete' && current.executionId === executionId) {
        return { action: 'drain', refresh: current };
      }
      if (
        current?.status === 'running' &&
        current.executionId !== executionId &&
        Date.parse(current.leaseExpiresAt) > Date.parse(claimedAt)
      ) {
        return { action: 'busy', ownerExecutionId: current.executionId };
      }

      const previousSnapshotId =
        current?.status === 'complete'
          ? current.snapshotId
          : (current?.previousSnapshotId ?? null);
      transaction.set(this.refreshRef, {
        status: 'running',
        executionId,
        claimedAt,
        leaseExpiresAt,
        previousSnapshotId,
      });
      return { action: 'fetch', previousSnapshotId };
    });
  }

  async prepareSnapshot({
    executionId,
    snapshotId,
    fetchedAt,
    generatedAt,
    modelCount,
    rateLimit,
    manifest,
    paretoDocument,
    models = [],
    definitions = MONITORED_PARETO_FRONTS,
  }) {
    return this.firestore.runTransaction(async (transaction) => {
      const refreshSnapshot = await transaction.get(this.refreshRef);
      const refresh = refreshSnapshot.exists ? refreshSnapshot.data() : null;

      if (refresh?.status === 'prepared' && refresh.snapshotId === snapshotId) {
        return { eventCount: refresh.eventIds?.length ?? 0 };
      }
      if (refresh?.status !== 'running' || refresh.executionId !== executionId) {
        throw new Error('Collector execution no longer owns the refresh lease');
      }

      const frontRefs = paretoDocument.fronts.map(({ frontId }) =>
        this.paretoCollection.doc(frontId),
      );
      const frontSnapshots = await Promise.all(frontRefs.map((ref) => transaction.get(ref)));
      const previousFronts = frontSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => frontFromFirestore(snapshot.data()));
      const previous =
        refresh.previousSnapshotId && previousFronts.length > 0
          ? { snapshotId: refresh.previousSnapshotId, fronts: previousFronts }
          : null;
      const events = createParetoChangeEvents({
        previous,
        current: paretoDocument,
        models,
        definitions,
        occurredAt: generatedAt,
      });

      const outboxRefs = events.map((event) => this.outboxCollection.doc(event.eventId));
      const outboxSnapshots = await Promise.all(outboxRefs.map((ref) => transaction.get(ref)));

      paretoDocument.fronts.forEach((front, index) => {
        transaction.set(frontRefs[index], {
          ...frontForFirestore(front),
          snapshotId,
          updatedAt: generatedAt,
        });
      });
      events.forEach((event, index) => {
        if (outboxSnapshots[index].exists) return;
        transaction.set(outboxRefs[index], {
          ...event,
          status: 'pending',
          createdAt: generatedAt,
          publishAttempts: 0,
        });
      });
      transaction.set(this.refreshRef, {
        status: 'prepared',
        executionId,
        snapshotId,
        previousSnapshotId: refresh.previousSnapshotId,
        fetchedAt,
        generatedAt,
        modelCount,
        rateLimit,
        manifest,
        eventIds: events.map(({ eventId }) => eventId),
        leaseExpiresAt: null,
      });

      return { eventCount: events.length };
    });
  }

  async markSnapshotPublished({ executionId, snapshotId, publishedAt }) {
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(this.refreshRef);
      const current = snapshot.exists ? snapshot.data() : null;

      if (current?.status === 'complete' && current.snapshotId === snapshotId) return;
      if (
        current?.status !== 'prepared' ||
        current.executionId !== executionId ||
        current.snapshotId !== snapshotId
      ) {
        throw new Error('Prepared snapshot no longer matches the collector execution');
      }

      transaction.set(this.refreshRef, { ...current, status: 'complete', publishedAt });
    });
  }

  async listPendingEvents(limit) {
    const snapshot = await this.outboxCollection.where('status', '==', 'pending').limit(limit).get();
    return snapshot.docs.map((document) => eventFields(document.data()));
  }

  async markEventEnqueued(eventId, messageId, enqueuedAt) {
    const reference = this.outboxCollection.doc(eventId);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists || snapshot.data().status !== 'pending') return;
      const current = snapshot.data();
      transaction.set(reference, {
        ...current,
        status: 'enqueued',
        messageId,
        enqueuedAt,
        publishAttempts: (current.publishAttempts ?? 0) + 1,
      });
    });
  }
}
