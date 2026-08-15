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

/**
 * Thins a front to `count` items spread along `objective`, keeping both ends.
 * Truncating instead would pile the survivors into whichever corner the data
 * happened to be sorted from.
 */
function spread(front, count, objective) {
  const sorted = [...front].sort((a, b) => objective.value(a) - objective.value(b));
  if (count >= sorted.length) return sorted;
  if (count <= 1) return sorted.slice(0, count);
  const last = sorted.length - 1;
  return Array.from({ length: count }, (_, i) => sorted[Math.round((i * last) / (count - 1))]);
}

/**
 * The `limit` items closest to making a front, out of what the peeled fronts
 * left behind.
 *
 * Peeling simply carries on where `paretoFronts` stopped — front 4, front 5, and
 * so on — which is the only ordering of "nearly good enough" that survives both
 * a change of axes and a change of units. A ratio such as intelligence ÷ cost
 * does not: it is undefined when both objectives point the same way, and because
 * the intelligence index is anchored at zero it ranks a cheap weak model above
 * everything on the gold front. The front that overflows the limit is spread
 * along the first objective rather than cut off.
 *
 * @param {any[]} items       models the fronts did not claim
 * @param {Objective[]} objectives
 * @param {number} limit
 */
export function runnersUp(items, objectives, limit) {
  if (limit <= 0) return [];

  const picked = [];
  let remaining = items;

  while (picked.length < limit && remaining.length > 0) {
    const [front] = paretoFronts(remaining, objectives, 1);
    // Nothing peelable left — the remainder is missing one of the objectives.
    if (!front || front.length === 0) break;

    const room = limit - picked.length;
    picked.push(...(front.length <= room ? front : spread(front, room, objectives[0])));

    const taken = new Set(front);
    remaining = remaining.filter((item) => !taken.has(item));
  }

  return picked;
}

/** Ordered points of a front, ready to connect with direct line segments. */
export function frontPath(front, xObjective, yObjective) {
  return front
    .map((item) => ({ item, x: xObjective.value(item), y: yObjective.value(item) }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
}
