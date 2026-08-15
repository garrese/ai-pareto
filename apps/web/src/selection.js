import { paretoFronts, runnersUp } from './pareto.js';

/**
 * Selects exactly what the default chart will draw: every model on the peeled
 * fronts plus the bounded context immediately behind them.
 */
export function defaultParetoContext(models, objectives, frontCount, runnerLimit) {
  const eligible = models.filter((model) =>
    objectives.every((objective) => Number.isFinite(objective.value(model))),
  );
  const fronts = paretoFronts(eligible, objectives, frontCount);
  const rankedIds = new Set(fronts.flatMap((front) => front.map((model) => model.id)));
  const dominated = eligible.filter((model) => !rankedIds.has(model.id));
  const visible = [...fronts.flat(), ...runnersUp(dominated, objectives, runnerLimit)];
  return {
    modelIds: new Set(visible.map((model) => model.id)),
    dominatedCount: dominated.length,
  };
}

/**
 * A creator checkbox is a parent checkbox for its currently eligible models.
 * Native `indeterminate` state represents a creator with only some models on
 * show; zero selected models is the only fully unchecked state.
 */
export function creatorSelectionStates(models, selectedIds) {
  const states = new Map();
  for (const model of models) {
    if (!model.creatorId) continue;
    const state = states.get(model.creatorId) ?? { total: 0, selected: 0 };
    state.total += 1;
    if (selectedIds.has(model.id)) state.selected += 1;
    states.set(model.creatorId, state);
  }
  return states;
}
