import { sha256 } from './canonical.js';
import { MAX_POSTS_PER_SCAN } from './definitions.js';

const EVENT_SCHEMA_VERSION = 2;
const MOVE_TYPE = 'pareto.model.moved';
const DIGEST_TYPE = 'pareto.scan.digest';

/**
 * Only two movements are worth announcing:
 *
 * - an **arrival**, a model that was in none of the peeled fronts and now is
 * - a **promotion**, a model that moved to a strictly better front
 *
 * Everything else is the wake of one of those. A single arrival in front 1
 * pushes models down through fronts 2 and 3, and announcing each of those
 * demotions as its own "entry" retells one piece of news up to five times —
 * measured against the real dataset, one arrival produced five front changes.
 * The displaced models are named inside the post that caused the movement.
 */
const isPublishable = (tier, previousTier) => previousTier === null || tier < previousTier;

function tierIndexByModel(document) {
  const byFront = new Map();
  for (const front of document?.fronts ?? []) {
    const tiers = new Map();
    (front.tiers ?? []).forEach((modelIds, tier) => {
      for (const modelId of modelIds) if (!tiers.has(modelId)) tiers.set(modelId, tier);
    });
    byFront.set(front.frontId, tiers);
  }
  return byFront;
}

/** Objectives are `{ key, dir }`; "better" depends on the direction. */
const beats = (left, right, objective) =>
  objective.dir === 'max'
    ? left[objective.key] > right[objective.key]
    : left[objective.key] < right[objective.key];

const dominates = (candidate, other, objectives) =>
  objectives.every((o) => !beats(other, candidate, o)) &&
  objectives.some((o) => beats(candidate, other, o));

/** The public shape of a model inside an event: enough to render a post. */
const describe = (model, objectives) => ({
  id: model.id,
  name: model.name,
  metrics: Object.fromEntries(objectives.map(({ key }) => [key, model[key] ?? null])),
});

/**
 * The model directly ahead of `model` on the front, along the maximised
 * objective. It always exists unless `model` is now the leader, and it answers
 * "where did it land" for an arrival that displaced nobody.
 */
function neighbourAhead(model, frontModels, objectives) {
  const up = objectives.find(({ dir }) => dir === 'max') ?? objectives[0];
  return (
    frontModels
      .filter((other) => other.id !== model.id && beats(other, model, up))
      .sort((left, right) => left[up.key] - right[up.key])[0] ?? null
  );
}

function moveEvents({ definition, previous, current, models, occurredAt, previousTiers, currentTiers }) {
  const { frontId, objectives } = definition;
  const byId = new Map(models.map((model) => [model.id, model]));
  const currentFront = current.fronts.find((front) => front.frontId === frontId);
  const before = previousTiers.get(frontId);
  const after = currentTiers.get(frontId);

  const events = [];
  for (const [modelId, tier] of after) {
    const previousTier = before.has(modelId) ? before.get(modelId) : null;
    if (!isPublishable(tier, previousTier)) continue;

    const model = byId.get(modelId);
    // A model in the front but absent from the dataset would be a collector
    // bug; skip rather than publish a post with holes in it.
    if (!model) continue;

    const destination = (currentFront.tiers[tier] ?? [])
      .map((id) => byId.get(id))
      .filter(Boolean);

    // Who left this tier because this model beat them on both objectives.
    // Metrics are read from the current dataset throughout, so every number in
    // a post describes the same snapshot.
    const displaced = [...before]
      .filter(([id, previousIndex]) => previousIndex === tier && after.get(id) !== tier)
      .map(([id]) => byId.get(id))
      .filter((other) => other && dominates(model, other, objectives));

    const neighbour = displaced.length === 0 ? neighbourAhead(model, destination, objectives) : null;

    const identity = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      type: MOVE_TYPE,
      frontId,
      tier,
      previousTier,
      modelId,
      after: [...(currentFront.tiers[tier] ?? [])].sort((l, r) => l.localeCompare(r)),
    };

    events.push({
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: `sha256:${sha256(identity)}`,
      type: MOVE_TYPE,
      occurredAt,
      fromSnapshot: previous.snapshotId,
      toSnapshot: current.snapshotId,
      frontId,
      objectives: objectives.map(({ key, dir }) => ({ key, dir })),
      tier,
      previousTier,
      model: describe(model, objectives),
      displaced: displaced
        .map((other) => describe(other, objectives))
        .sort((left, right) => left.id.localeCompare(right.id)),
      neighbour: neighbour ? describe(neighbour, objectives) : null,
    });
  }

  return events.sort((left, right) => left.model.id.localeCompare(right.model.id));
}

/**
 * Collapses a burst into one post. The tier counts carry the shape of the
 * change and the single named model gives it a subject; naming all of them
 * would not fit and would read as a dump.
 */
function digestEvent(moves, { previous, current, occurredAt }) {
  const [frontId] = [...new Set(moves.map((move) => move.frontId))];
  const perTier = [0, 1, 2].map((tier) => moves.filter((move) => move.tier === tier).length);
  const up = moves[0].objectives.find(({ dir }) => dir === 'max') ?? moves[0].objectives[0];
  const headline = [...moves].sort(
    (left, right) =>
      left.tier - right.tier ||
      (right.model.metrics[up.key] ?? -Infinity) - (left.model.metrics[up.key] ?? -Infinity),
  )[0];

  const identity = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    type: DIGEST_TYPE,
    frontId,
    moves: moves.map(({ eventId }) => eventId).sort(),
  };

  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: `sha256:${sha256(identity)}`,
    type: DIGEST_TYPE,
    occurredAt,
    fromSnapshot: previous.snapshotId,
    toSnapshot: current.snapshotId,
    frontId,
    objectives: headline.objectives,
    moveCount: moves.length,
    perTier,
    headline: { tier: headline.tier, model: headline.model },
  };
}

/**
 * Compares the peeled fronts of every published objective set and returns the
 * events to publish. The first observed snapshot establishes a baseline and
 * intentionally emits nothing, as does a newly configured objective set.
 *
 * @param {object} options
 * @param {object|null} options.previous  the previously stored Pareto document
 * @param {object} options.current        the Pareto document just generated
 * @param {object[]} options.models       the current dataset, for names and metrics
 * @param {object[]} options.definitions  monitored objective sets
 * @param {string} options.occurredAt
 */
export function createParetoChangeEvents({
  previous = null,
  current,
  models = [],
  definitions = [],
  occurredAt,
  maxPosts = MAX_POSTS_PER_SCAN,
}) {
  if (!current?.snapshotId) throw new Error('The current Pareto document requires a snapshotId');
  if (typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt))) {
    throw new Error('occurredAt must be an ISO-8601 date string');
  }
  if (!previous) return [];

  const previousTiers = tierIndexByModel(previous);
  const currentTiers = tierIndexByModel(current);

  const moves = definitions
    .filter((definition) => definition.published)
    // A front that either side has never seen establishes its own baseline.
    // Removing a definition is configuration work, not news.
    .filter(({ frontId }) => previousTiers.has(frontId) && currentTiers.has(frontId))
    .flatMap((definition) =>
      moveEvents({
        definition,
        previous,
        current,
        models,
        occurredAt,
        previousTiers,
        currentTiers,
      }),
    )
    .sort((left, right) => left.frontId.localeCompare(right.frontId) || left.tier - right.tier);

  if (moves.length === 0) return [];
  if (moves.length <= maxPosts) return moves;
  return [digestEvent(moves, { previous, current, occurredAt })];
}
