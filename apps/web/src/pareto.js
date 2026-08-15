/**
 * Non-dominated sorting.
 *
 * A point dominates another when it is at least as good on every objective and
 * strictly better on at least one. Front 1 is the set nobody dominates; remove
 * it and front 2 is what surfaces next, and so on. Peeling three times gives the
 * gold / silver / bronze tiers.
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

/** Ordered points of a front, ready to connect with direct line segments. */
export function frontPath(front, xObjective, yObjective) {
  return front
    .map((item) => ({ item, x: xObjective.value(item), y: yObjective.value(item) }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
}
