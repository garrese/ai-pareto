import { summarizeModelChanges, summarizeParetoChanges } from './audit.js';
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
      log('INFO', 'Pareto publication event enqueued', {
        event: 'pareto.publication.enqueued',
        eventId: event.eventId,
        eventType: event.type,
        frontId: event.frontId,
        fromSnapshot: event.fromSnapshot,
        toSnapshot: event.toSnapshot,
        modelId: event.model?.id ?? event.headline?.model?.id ?? null,
        modelName: event.model?.name ?? event.headline?.model?.name ?? null,
        tier: event.tier ?? event.headline?.tier ?? null,
        previousTier: event.previousTier ?? null,
        messageId,
      });
    }
  }

  throw new Error(`Outbox drain exceeded the safety limit of ${limit} events`);
}

async function loadPreviousDocuments({ storage, snapshotId, executionId, log }) {
  if (!snapshotId) return { available: true, models: null, pareto: null };
  if (typeof storage.getJson !== 'function') {
    log('WARNING', 'Previous snapshot comparison is unavailable', {
      event: 'audit.previous.unavailable',
      executionId,
      previousSnapshotId: snapshotId,
      reason: 'Storage adapter does not implement getJson',
    });
    return { available: false, models: null, pareto: null };
  }

  try {
    const basePath = `public/snapshots/${snapshotId}`;
    const [models, pareto] = await Promise.all([
      storage.getJson(`${basePath}/models.json`),
      storage.getJson(`${basePath}/pareto.json`),
    ]);
    if (!Array.isArray(models?.models) || !Array.isArray(pareto?.fronts)) {
      throw new Error('Previous snapshot documents have an invalid shape');
    }
    return { available: true, models, pareto };
  } catch (error) {
    log('WARNING', 'Previous snapshot comparison is unavailable', {
      event: 'audit.previous.unavailable',
      executionId,
      previousSnapshotId: snapshotId,
      errorName: error.name,
      errorMessage: error.message,
    });
    return { available: false, models: null, pareto: null };
  }
}

function logAudit({
  log,
  executionId,
  previousSnapshotId,
  artifacts,
  models,
  previousDocuments,
  publicationEvents,
}) {
  if (!previousDocuments.available) {
    for (const paretoEvent of publicationEvents) {
      log('NOTICE', 'Pareto publication planned', {
        event: 'pareto.publication.planned',
        executionId,
        snapshotId: artifacts.snapshotId,
        eventId: paretoEvent.eventId,
        eventType: paretoEvent.type,
        frontId: paretoEvent.frontId,
        paretoEvent,
      });
    }
    return;
  }

  const modelSummary = summarizeModelChanges(previousDocuments.models?.models ?? null, models);
  const modelMessage = modelSummary.baseline
    ? 'Model data baseline established'
    : modelSummary.changeDetected
      ? 'Model data changes detected'
      : 'Model data unchanged';
  const modelEvent = modelSummary.baseline
    ? 'data.refresh.baseline'
    : modelSummary.changeDetected
      ? 'data.refresh.changed'
      : 'data.refresh.unchanged';
  log('INFO', modelMessage, {
    event: modelEvent,
    executionId,
    previousSnapshotId,
    snapshotId: artifacts.snapshotId,
    changes: modelSummary,
  });

  const currentPareto = paretoDocumentFrom(artifacts);
  const frontSummaries = summarizeParetoChanges({
    previous: previousDocuments.pareto,
    current: currentPareto,
    previousModels: previousDocuments.models?.models ?? [],
    currentModels: models,
    definitions: MONITORED_PARETO_FRONTS,
    publicationEvents,
  });
  for (const summary of frontSummaries.filter(
    ({ baseline, changeDetected }) => baseline || changeDetected,
  )) {
    log(
      'INFO',
      summary.baseline ? 'Pareto front baseline established' : 'Pareto front changes detected',
      {
        event: summary.baseline ? 'pareto.front.baseline' : 'pareto.front.changed',
        executionId,
        previousSnapshotId,
        snapshotId: artifacts.snapshotId,
        ...summary,
      },
    );
  }

  for (const paretoEvent of publicationEvents) {
    log('NOTICE', 'Pareto publication planned', {
      event: 'pareto.publication.planned',
      executionId,
      snapshotId: artifacts.snapshotId,
      eventId: paretoEvent.eventId,
      eventType: paretoEvent.type,
      frontId: paretoEvent.frontId,
      paretoEvent,
    });
  }
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
      event: 'collector.execution.busy',
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
      event: 'collector.snapshot.resume',
      executionId: ownerExecutionId,
      snapshotId: claim.refresh.snapshotId,
    });
  } else if (claim.action === 'drain') {
    log('INFO', 'Resuming outbox publication without refetching upstream data', {
      event: 'collector.outbox.resume',
      executionId,
      snapshotId: claim.refresh.snapshotId,
    });
    const enqueued = await enqueuePendingEvents({ state, eventBus, now, log });
    return { status: 'completed', fetched: false, enqueued, snapshotId: claim.refresh.snapshotId };
  } else if (claim.action === 'fetch') {
    const previousDocuments = await loadPreviousDocuments({
      storage,
      snapshotId: claim.previousSnapshotId,
      executionId,
      log,
    });
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
    const preparation = (await state.prepareSnapshot({
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
    })) ?? {};
    log('INFO', 'Snapshot prepared', {
      event: 'data.snapshot.prepared',
      executionId,
      snapshotId: artifacts.snapshotId,
      modelCount: result.models.length,
      pages: result.pages,
      rateLimit: result.rateLimit ?? null,
      plannedPublicationCount: preparation.eventCount ?? preparation.events?.length ?? 0,
    });
    logAudit({
      log,
      executionId,
      previousSnapshotId: claim.previousSnapshotId ?? null,
      artifacts,
      models: result.models,
      previousDocuments,
      publicationEvents: preparation.events ?? [],
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
