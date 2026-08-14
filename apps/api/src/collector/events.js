import { sha256 } from './canonical.js';

const EVENT_SCHEMA_VERSION = 1;
const EVENT_TYPE = 'pareto.front.changed';

function firstTierByFront(document) {
  return new Map(
    (document?.fronts ?? []).map((front) => [
      front.frontId,
      [...new Set(front.tiers?.[0] ?? [])].sort((left, right) => left.localeCompare(right)),
    ]),
  );
}

const difference = (left, right) => left.filter((modelId) => !right.has(modelId));

/**
 * Compares the outermost tier for every configured objective set. The first
 * observed snapshot establishes a baseline and intentionally emits no event.
 */
export function createParetoChangeEvents({ previous = null, current, occurredAt }) {
  if (!current?.snapshotId) throw new Error('The current Pareto document requires a snapshotId');
  if (typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt))) {
    throw new Error('occurredAt must be an ISO-8601 date string');
  }
  if (!previous) return [];

  const beforeByFront = firstTierByFront(previous);
  const afterByFront = firstTierByFront(current);
  const frontIds = [...new Set([...beforeByFront.keys(), ...afterByFront.keys()])].sort((left, right) =>
    left.localeCompare(right),
  );

  return frontIds.flatMap((frontId) => {
    const before = beforeByFront.get(frontId) ?? [];
    const after = afterByFront.get(frontId) ?? [];
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const addedModelIds = difference(after, beforeSet);
    const removedModelIds = difference(before, afterSet);

    if (addedModelIds.length === 0 && removedModelIds.length === 0) return [];

    const identity = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      type: EVENT_TYPE,
      frontId,
      before,
      after,
    };

    return [
      {
        schemaVersion: EVENT_SCHEMA_VERSION,
        eventId: `sha256:${sha256(identity)}`,
        type: EVENT_TYPE,
        occurredAt,
        fromSnapshot: previous.snapshotId,
        toSnapshot: current.snapshotId,
        frontId,
        addedModelIds,
        removedModelIds,
      },
    ];
  });
}
