const DEFAULT_DETAIL_LIMIT = 50;

const byId = (models = []) => new Map(models.map((model) => [model.id, model]));

const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const modelLabel = (model, fallbackId) => ({
  id: model?.id ?? fallbackId,
  name: model?.name ?? fallbackId,
});

function changedFields(previous, current) {
  const fields = [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter((field) => field !== 'id')
    .sort((left, right) => left.localeCompare(right));

  return fields
    .filter((field) => !sameValue(previous[field], current[field]))
    .map((field) => ({
      field,
      before: previous[field] ?? null,
      after: current[field] ?? null,
    }));
}

const limitDetails = (details, limit) => ({
  details: details.slice(0, limit),
  omittedCount: Math.max(0, details.length - limit),
});

/** Compares normalized model data while deliberately ignoring snapshot timestamps. */
export function summarizeModelChanges(previousModels, currentModels, detailLimit = DEFAULT_DETAIL_LIMIT) {
  if (!Array.isArray(currentModels)) throw new Error('currentModels must be an array');
  if (previousModels !== null && !Array.isArray(previousModels)) {
    throw new Error('previousModels must be an array or null');
  }

  if (previousModels === null) {
    return {
      baseline: true,
      changeDetected: false,
      beforeCount: null,
      afterCount: currentModels.length,
      addedCount: 0,
      removedCount: 0,
      updatedCount: 0,
      addedModels: [],
      removedModels: [],
      updatedModels: [],
      omittedDetailCount: 0,
    };
  }

  const previousById = byId(previousModels);
  const currentById = byId(currentModels);
  const added = [...currentById]
    .filter(([id]) => !previousById.has(id))
    .map(([id, model]) => modelLabel(model, id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const removed = [...previousById]
    .filter(([id]) => !currentById.has(id))
    .map(([id, model]) => modelLabel(model, id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const updated = [...currentById]
    .filter(([id]) => previousById.has(id))
    .map(([id, model]) => ({
      ...modelLabel(model, id),
      changes: changedFields(previousById.get(id), model),
    }))
    .filter(({ changes }) => changes.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id));

  const addedLimited = limitDetails(added, detailLimit);
  const removedLimited = limitDetails(removed, detailLimit);
  const updatedLimited = limitDetails(updated, detailLimit);
  const totalChanges = added.length + removed.length + updated.length;

  return {
    baseline: false,
    changeDetected: totalChanges > 0,
    beforeCount: previousModels.length,
    afterCount: currentModels.length,
    addedCount: added.length,
    removedCount: removed.length,
    updatedCount: updated.length,
    addedModels: addedLimited.details,
    removedModels: removedLimited.details,
    updatedModels: updatedLimited.details,
    omittedDetailCount:
      addedLimited.omittedCount + removedLimited.omittedCount + updatedLimited.omittedCount,
  };
}

function tierByModel(front) {
  const tiers = new Map();
  (front?.tiers ?? []).forEach((modelIds, tier) => {
    for (const modelId of modelIds) if (!tiers.has(modelId)) tiers.set(modelId, tier);
  });
  return tiers;
}

const movementKind = (before, after) => {
  if (before === null) return 'arrival';
  if (after === null) return 'exit';
  if (after < before) return 'promotion';
  return 'demotion';
};

/** Summarizes every monitored front, including fronts that are not published. */
export function summarizeParetoChanges({
  previous,
  current,
  previousModels = [],
  currentModels = [],
  definitions = [],
  publicationEvents = [],
  detailLimit = DEFAULT_DETAIL_LIMIT,
}) {
  if (!current?.snapshotId) throw new Error('The current Pareto document requires a snapshotId');

  const previousFronts = new Map((previous?.fronts ?? []).map((front) => [front.frontId, front]));
  const currentFronts = new Map((current.fronts ?? []).map((front) => [front.frontId, front]));
  const definitionById = new Map(definitions.map((definition) => [definition.frontId, definition]));
  const previousById = byId(previousModels);
  const currentById = byId(currentModels);

  return [...currentFronts]
    .map(([frontId, front]) => {
      const previousFront = previousFronts.get(frontId);
      const baseline = !previousFront;
      const before = tierByModel(previousFront);
      const after = tierByModel(front);
      const ids = [...new Set([...before.keys(), ...after.keys()])]
        .sort((left, right) => left.localeCompare(right));
      const movements = baseline
        ? []
        : ids
          .filter((id) => before.get(id) !== after.get(id))
          .map((id) => {
            const previousTier = before.has(id) ? before.get(id) : null;
            const tier = after.has(id) ? after.get(id) : null;
            const kind = movementKind(previousTier, tier);
            const model = currentById.get(id) ?? previousById.get(id);
            return {
              ...modelLabel(model, id),
              kind,
              previousTier,
              tier,
              publicationEligible:
                Boolean(definitionById.get(frontId)?.published) &&
                (kind === 'arrival' || kind === 'promotion'),
            };
          });
      const limited = limitDetails(movements, detailLimit);
      const events = publicationEvents.filter((event) => event.frontId === frontId);
      const counts = Object.fromEntries(
        ['arrival', 'promotion', 'demotion', 'exit'].map((kind) => [
          `${kind}Count`,
          movements.filter((movement) => movement.kind === kind).length,
        ]),
      );

      return {
        frontId,
        objectives: front.objectives,
        publicationEnabled: Boolean(definitionById.get(frontId)?.published),
        baseline,
        changeDetected: movements.length > 0,
        beforeTierCounts: baseline ? null : (previousFront.tiers ?? []).map((tier) => tier.length),
        afterTierCounts: (front.tiers ?? []).map((tier) => tier.length),
        ...counts,
        plannedPublicationCount: events.length,
        movements: limited.details,
        omittedDetailCount: limited.omittedCount,
      };
    })
    .sort((left, right) => left.frontId.localeCompare(right.frontId));
}
