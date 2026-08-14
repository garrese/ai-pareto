/** @typedef {{ key: string, dir: 'max' | 'min' }} Objective */

function validateObjectives(objectives) {
  if (!Array.isArray(objectives) || objectives.length < 2) {
    throw new Error('A Pareto definition requires at least two objectives');
  }

  for (const objective of objectives) {
    if (!objective?.key || !['min', 'max'].includes(objective.dir)) {
      throw new Error('Each Pareto objective requires a key and a min/max direction');
    }
  }
}

function dominates(left, right, objectives) {
  let strictlyBetter = false;

  for (const objective of objectives) {
    const leftValue = left[objective.key];
    const rightValue = right[objective.key];
    const better =
      objective.dir === 'max' ? leftValue > rightValue : leftValue < rightValue;
    const worse = objective.dir === 'max' ? leftValue < rightValue : leftValue > rightValue;

    if (worse) return false;
    if (better) strictlyBetter = true;
  }

  return strictlyBetter;
}

/**
 * Peels non-dominated fronts in a deterministic order. Models missing any
 * requested metric are excluded from this particular Pareto definition.
 *
 * @param {object[]} models
 * @param {Objective[]} objectives
 * @param {number} maxFronts
 * @returns {string[][]} model IDs, one sorted array per front
 */
export function paretoFrontIds(models, objectives, maxFronts = 4) {
  validateObjectives(objectives);
  if (!Number.isInteger(maxFronts) || maxFronts < 1) {
    throw new Error('maxFronts must be a positive integer');
  }

  let remaining = models
    .filter(
      (model) =>
        typeof model?.id === 'string' &&
        model.id.length > 0 &&
        objectives.every((objective) => Number.isFinite(model[objective.key])),
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  const fronts = [];
  while (fronts.length < maxFronts && remaining.length > 0) {
    const front = remaining.filter(
      (candidate) =>
        !remaining.some(
          (other) => other !== candidate && dominates(other, candidate, objectives),
        ),
    );

    if (front.length === 0) break;

    const frontIds = front.map((model) => model.id).sort((left, right) => left.localeCompare(right));
    fronts.push(frontIds);
    const selected = new Set(frontIds);
    remaining = remaining.filter((model) => !selected.has(model.id));
  }

  return fronts;
}

/**
 * @param {object[]} models
 * @param {{ frontId: string, objectives: Objective[] }[]} definitions
 * @param {number} maxFronts
 */
export function createParetoRepresentation(models, definitions, maxFronts = 4) {
  const seen = new Set();

  return [...definitions]
    .map((definition) => {
      if (!definition?.frontId || seen.has(definition.frontId)) {
        throw new Error('Pareto front IDs must be non-empty and unique');
      }
      seen.add(definition.frontId);
      validateObjectives(definition.objectives);

      return {
        frontId: definition.frontId,
        objectives: definition.objectives.map(({ key, dir }) => ({ key, dir })),
        tiers: paretoFrontIds(models, definition.objectives, maxFronts),
      };
    })
    .sort((left, right) => left.frontId.localeCompare(right.frontId));
}
