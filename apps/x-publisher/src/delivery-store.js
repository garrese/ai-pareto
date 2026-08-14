export class FirestoreDeliveryStore {
  constructor(firestore) {
    this.deliveries = firestore
      .collection('notification-channels')
      .doc('x')
      .collection('deliveries');
    this.firestore = firestore;
  }

  #reference(eventId) {
    return this.deliveries.doc(eventId);
  }

  async claim({ eventId, ownerId, claimedAt, leaseExpiresAt }) {
    const reference = this.#reference(eventId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists ? snapshot.data() : null;

      if (current?.status === 'sent') {
        return { status: 'sent', postId: current.postId };
      }
      if (
        current?.status === 'processing' &&
        Date.parse(current.leaseExpiresAt) > Date.parse(claimedAt)
      ) {
        return { status: 'busy', ownerId: current.ownerId };
      }

      transaction.set(reference, {
        eventId,
        status: 'processing',
        ownerId,
        claimedAt,
        leaseExpiresAt,
        attempts: (current?.attempts ?? 0) + 1,
        firstSeenAt: current?.firstSeenAt ?? claimedAt,
        lastError: null,
      });
      return { status: 'acquired' };
    });
  }

  async markSent({ eventId, ownerId, postId, sentAt, reconciled }) {
    const reference = this.#reference(eventId);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists ? snapshot.data() : null;
      if (current?.status === 'sent') return;
      if (current?.status !== 'processing' || current.ownerId !== ownerId) {
        throw new Error('X delivery lease is no longer owned by this request');
      }

      transaction.set(reference, {
        ...current,
        status: 'sent',
        postId,
        sentAt,
        reconciled,
        leaseExpiresAt: null,
        lastError: null,
      });
    });
  }

  async markFailed({ eventId, ownerId, failedAt, error }) {
    const reference = this.#reference(eventId);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists ? snapshot.data() : null;
      if (current?.status !== 'processing' || current.ownerId !== ownerId) return;

      transaction.set(reference, {
        ...current,
        status: 'failed',
        failedAt,
        leaseExpiresAt: null,
        lastError: String(error).slice(0, 300),
      });
    });
  }
}
