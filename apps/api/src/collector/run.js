import { MONITORED_PARETO_FRONTS, TIER_COUNT } from './definitions.js';
import { publishImmutableObjects, publishManifestObject } from './publication.js';
import { createSnapshotArtifacts } from './snapshots.js';

const toIso = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('The collector clock returned an invalid date');
  return date.toISOString();
};

function paretoDocumentFrom(artifacts) {
  const object = artifacts.immutableObjects.find(({ path }) => path.endsWith('/pareto.json'));
  if (!object) throw new Error('Snapshot artifacts do not contain pareto.json');
  return object.body;
}

async function enqueuePendingEvents({ state, eventBus, now, log, limit = 1000 }) {
  let enqueued = 0;

  while (enqueued < limit) {
    const pending = await state.listPendingEvents(Math.min(100, limit - enqueued));
    if (pending.length === 0) return enqueued;

    for (const event of pending) {
      const messageId = await eventBus.publish(event);
      await state.markEventEnqueued(event.eventId, messageId, toIso(now()));
      enqueued += 1;
      log('INFO', 'Outbox event enqueued', { eventId: event.eventId, messageId });
    }
  }

  throw new Error(`Outbox drain exceeded the safety limit of ${limit} events`);
}

/** Runs one recoverable collector execution without binding it to Google Cloud clients. */
export async function runCollector({
  executionId,
  leaseSeconds,
  source,
  storage,
  state,
  eventBus,
  now = () => new Date(),
  log = () => {},
}) {
  const claimedAt = toIso(now());
  const leaseExpiresAt = toIso(new Date(Date.parse(claimedAt) + leaseSeconds * 1000));
  const claim = await state.claimExecution({ executionId, claimedAt, leaseExpiresAt });

  if (claim.action === 'busy') {
    log('INFO', 'Collector skipped because another execution holds the lease', {
      executionId,
      ownerExecutionId: claim.ownerExecutionId,
    });
    return { status: 'busy', fetched: false, enqueued: 0 };
  }

  let ownerExecutionId = executionId;
  let artifacts;
  let fetched = false;

  if (claim.action === 'resume') {
    ownerExecutionId = claim.refresh.executionId;
    artifacts = {
      immutableObjects: [],
      manifestObject: claim.refresh.manifest,
    };
    log('INFO', 'Resuming prepared snapshot publication', {
      executionId: ownerExecutionId,
      snapshotId: claim.refresh.snapshotId,
    });
  } else if (claim.action === 'drain') {
    log('INFO', 'Resuming outbox publication without refetching upstream data', {
      executionId,
      snapshotId: claim.refresh.snapshotId,
    });
    const enqueued = await enqueuePendingEvents({ state, eventBus, now, log });
    return { status: 'completed', fetched: false, enqueued, snapshotId: claim.refresh.snapshotId };
  } else if (claim.action === 'fetch') {
    const result = await source.fetchModels();
    const generatedAt = toIso(now());
    artifacts = createSnapshotArtifacts({
      models: result.models,
      fetchedAt: result.fetchedAt,
      generatedAt,
      paretoDefinitions: MONITORED_PARETO_FRONTS,
      maxFronts: TIER_COUNT,
    });
    fetched = true;

    await publishImmutableObjects(artifacts, storage);
    await state.prepareSnapshot({
      executionId,
      snapshotId: artifacts.snapshotId,
      fetchedAt: result.fetchedAt,
      generatedAt,
      modelCount: result.models.length,
      rateLimit: result.rateLimit ?? null,
      manifest: artifacts.manifestObject,
      paretoDocument: paretoDocumentFrom(artifacts),
      // Change detection needs names and metrics, not just the IDs the Pareto
      // document carries — a post has to say who was displaced and by how much.
      models: result.models,
      definitions: MONITORED_PARETO_FRONTS,
    });
    log('INFO', 'Snapshot prepared', {
      executionId,
      snapshotId: artifacts.snapshotId,
      modelCount: result.models.length,
      pages: result.pages,
    });
  } else {
    throw new Error(`Unsupported collector claim action: ${claim.action}`);
  }

  await publishManifestObject(artifacts, storage);
  await state.markSnapshotPublished({
    executionId: ownerExecutionId,
    snapshotId: artifacts.manifestObject.body.snapshotId,
    publishedAt: toIso(now()),
  });

  const enqueued = await enqueuePendingEvents({ state, eventBus, now, log });
  return {
    status: 'completed',
    fetched,
    enqueued,
    snapshotId: artifacts.manifestObject.body.snapshotId,
  };
}
