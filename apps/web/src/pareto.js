/**
 * Non-dominated sorting.
 *
 * A point dominates another when it is at least as good on every objective and
 * strictly better on at least one. Front 1 is the set nobody dominates; remove
 * it and front 2 is what surfaces next, and so on. Peeling four times gives the
 * gold / silver / bronze / chocolate tiers.
 */

/** @typedef {{ value: (item: any) => number, dir: 'max' | 'min' }} Objective */

function dominates(a, b, dirs) {
  let strictlyBetter = false;
  for (let i = 0; i < dirs.length; i++) {
    const better = dirs[i] === 'max' ? a[i] > b[i] : a[i] < b[i];
    const worse = dirs[i] === 'max' ? a[i] < b[i] : a[i] > b[i];
    if (worse) return false;
    if (better) strictlyBetter = true;
  }
  return strictlyBetter;
}

/**
 * @param {any[]} items
 * @param {Objective[]} objectives
 * @param {number} maxFronts
 * @returns {any[][]} one array per front, outermost first
 */
export function paretoFronts(items, objectives, maxFronts = 4) {
  const dirs = objectives.map((o) => o.dir);
  const points = items.map((item) => objectives.map((o) => o.value(item)));

  let remaining = items.map((_, i) => i).filter((i) => points[i].every(Number.isFinite));
  const fronts = [];

  while (fronts.length < maxFronts && remaining.length > 0) {
    const front = remaining.filter(
      (i) => !remaining.some((j) => j !== i && dominates(points[j], points[i], dirs)),
    );
    // Degenerate objectives could in principle leave nothing to peel; stop
    // rather than loop forever.
    if (front.length === 0) break;

    fronts.push(front.map((i) => items[i]));
    const inFront = new Set(front);
    remaining = remaining.filter((i) => !inFront.has(i));
  }

  return fronts;
}

/**
 * Ordered points of a front, plus the staircase corners that make the trade-off
 * boundary explicit: between two neighbouring models the best you can reach is
 * the weaker of the two on each axis.
 */
export function frontStaircase(front, xObjective, yObjective) {
  const points = front
    .map((item) => ({ item, x: xObjective.value(item), y: yObjective.value(item) }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

  if (points.length < 2) return points;

  const worseOrEqual = (candidate, reference, dir) =>
    dir === 'max' ? candidate <= reference : candidate >= reference;

  const path = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    // Of the two corners between prev and curr, exactly one is reachable: the
    // one that is no better than both neighbours on both axes.
    const corner =
      worseOrEqual(curr.y, prev.y, yObjective.dir) && worseOrEqual(prev.x, curr.x, xObjective.dir)
        ? { x: prev.x, y: curr.y }
        : { x: curr.x, y: prev.y };

    path.push({ ...corner, corner: true }, curr);
  }
  return path;
}
