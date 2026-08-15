import { frontPath } from './pareto.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const COMPACT_BREAKPOINT = 520;
const MIN_COMPACT_WIDTH = 260;
const MIN_WIDE_WIDTH = 560;

// `left` is not listed: the gutter is measured from the widest Y tick label the
// current metric actually produces, so a phone does not reserve room for digits
// that are never drawn. Everything else is fixed.
const COMPACT_PAD = { top: 8, right: 8, bottom: 26 };
const WIDE_PAD = { top: 12, right: 20, bottom: 34 };

/** Tick labels are 11px tabular figures, so every glyph is the same width. */
const TICK_CHAR_WIDTH = 6.3;

/** Model-name labels: 11px proportional, so this is only a fallback estimate. */
const LABEL_CHAR_WIDTH = 5.9;
const LABEL_HEIGHT = 13;
/** Keeps neighbouring labels from touching, and the leader lines apart. */
const LABEL_GAP = 3;

/**
 * What a candidate position costs, in arbitrary units of clutter. Zero is a
 * clean slot and placement stops looking the moment it finds one.
 *
 * The front lines dominate the scale on purpose: a name laid across a frontier
 * hides the one thing the chart is drawing, and it reads as if the curve itself
 * were annotated. A leader crossing one is the same mistake in miniature. Marks
 * are cheaper — the label's halo keeps it readable over them — but a ranked
 * mark is a datum someone came to look at, where the dominated cloud is texture.
 */
const CROSS_FRONT_COST = 10;
const CROSS_FRONT_LEADER_COST = 4;
const COVER_RANKED_COST = 3;
const COVER_CLOUD_COST = 1;
/**
 * Placement is tried in this order, nearest ring first, so a label lands as
 * close to its mark as the crowd allows and in the tidiest direction that is
 * free. `dx`/`dy` are a unit direction; the halves of the compass come last
 * because a leader at 22.5° looks incidental next to one straight up.
 */
const LABEL_DIRECTIONS = [
  { dx: 0, dy: -1, anchor: 'middle' },
  { dx: 0, dy: 1, anchor: 'middle' },
  { dx: 1, dy: 0, anchor: 'start' },
  { dx: -1, dy: 0, anchor: 'end' },
  { dx: 0.72, dy: -0.72, anchor: 'start' },
  { dx: -0.72, dy: -0.72, anchor: 'end' },
  { dx: 0.72, dy: 0.72, anchor: 'start' },
  { dx: -0.72, dy: 0.72, anchor: 'end' },
  { dx: 0.38, dy: -0.92, anchor: 'start' },
  { dx: -0.38, dy: -0.92, anchor: 'end' },
  { dx: 0.92, dy: -0.38, anchor: 'start' },
  { dx: -0.92, dy: -0.38, anchor: 'end' },
  { dx: 0.38, dy: 0.92, anchor: 'start' },
  { dx: -0.38, dy: 0.92, anchor: 'end' },
  { dx: 0.92, dy: 0.38, anchor: 'start' },
  { dx: -0.92, dy: 0.38, anchor: 'end' },
];
/**
 * The outermost ring earns its long leader: without it the longest names in the
 * crowded corner of the default view go unlabelled. A seventh ring at 104px was
 * tried and rejected — it recovered one more name at 1280px and stretched the
 * worst leader from 66px to 89px, which reads as a caption for nothing.
 */
const LABEL_RINGS = [18, 28, 40, 56, 78];
const COMPACT_LABEL_RINGS = [15, 23, 33, 46, 62];
/** A hard ceiling on labels, so a search for "gpt" cannot carpet the plot. */
const LABEL_LIMIT = 26;
/**
 * Past this many matches, a search names only what sits on a front. A broad
 * query matches most of the dominated cloud, and naming all of it buries the
 * handful of matches anyone was looking for.
 */
const LABEL_RANKED_ONLY_ABOVE = 10;

/**
 * Room the vertical scale keeps clear above the highest mark and below the
 * lowest, in pixels — exactly one nearest-ring label, so a mark at either end
 * of the data has somewhere to put its name.
 *
 * Marks land on those edges constantly: the extremes of a Pareto front are the
 * whole point of drawing one, and the 6% proportional padding left them about
 * 19px of sky, which is not a label. The reservation is unconditional rather
 * than tied to the names checkbox, so toggling names does not move every point
 * on the chart.
 */
const edgeMargin = (compact) =>
  (compact ? COMPACT_LABEL_RINGS : LABEL_RINGS)[0] + LABEL_HEIGHT / 2 + 2;

const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

// ── scales ───────────────────────────────────────────────────────────────────

/**
 * @param {object} options
 * @param {number} [options.margin]  pixels to keep clear beyond the extreme values,
 *   on top of the proportional padding, ignored if the range is too short to give it
 */
function makeScale({ values, type, range, margin = 0 }) {
  const useLog = type === 'log' && values.every((v) => v > 0);
  const project = useLog ? Math.log10 : (v) => v;

  let lo = Math.min(...values.map(project));
  let hi = Math.max(...values.map(project));
  if (lo === hi) {
    lo -= 0.5;
    hi += 0.5;
  }

  // Padding the domain also stretches it, so the pixel margin it buys is less
  // than the padding itself: solving p / (span + 2p) = margin / pixels for p is
  // what actually leaves `margin` clear once the padded domain is mapped back.
  const span = hi - lo;
  const pixels = Math.abs(range[1] - range[0]);
  const reserved = pixels > 2 * margin + 1 ? (margin * span) / (pixels - 2 * margin) : 0;

  const pad = Math.max(span * 0.06, reserved);
  lo -= pad;
  hi += pad;

  const [r0, r1] = range;
  return {
    map: (v) => r0 + ((project(v) - lo) / (hi - lo)) * (r1 - r0),
    ticks: (target) => (useLog ? logTicks(lo, hi, target) : linearTicks(lo, hi, target)),
  };
}

function linearTicks(lo, hi, target = 7) {
  const rawStep = (hi - lo) / target;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function logTicks(lo, hi, target = 7) {
  const ticks = [];
  for (let exp = Math.floor(lo); exp <= Math.ceil(hi); exp++) {
    for (const mantissa of [1, 2, 5]) {
      const value = mantissa * 10 ** exp;
      const projected = Math.log10(value);
      if (projected >= lo && projected <= hi) ticks.push(value);
    }
  }
  if (ticks.length <= 2) return linearTicks(10 ** lo, 10 ** hi, target);
  if (ticks.length <= target) return ticks;

  return [
    ...new Set(
      Array.from(
        { length: target },
        (_, index) => ticks[Math.round((index * (ticks.length - 1)) / (target - 1))],
      ),
    ),
  ];
}

// ── labels ───────────────────────────────────────────────────────────────────

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const covers = (box, point) =>
  point.px > box.x0 && point.px < box.x1 && point.py > box.y0 && point.py < box.y1;

/**
 * Liang–Barsky: does any part of the segment fall inside the axis-aligned box?
 * Clips the parametric segment against each of the four slabs in turn and gives
 * up as soon as the surviving interval is empty.
 */
function segmentHitsBox(segment, box) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  let enter = 0;
  let exit = 1;

  for (const [edge, distance] of [
    [-dx, segment.x1 - box.x0],
    [dx, box.x1 - segment.x1],
    [-dy, segment.y1 - box.y0],
    [dy, box.y1 - segment.y1],
  ]) {
    if (edge === 0) {
      if (distance < 0) return false; // Parallel to this slab and outside it.
      continue;
    }
    const t = distance / edge;
    if (edge < 0) {
      if (t > exit) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < exit) exit = t;
    }
  }
  return true;
}

const side = (a, b, p) => Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));

/** True only for a proper crossing — segments that merely touch end to end do not count. */
function segmentsCross(a, b) {
  const p = { x: a.x1, y: a.y1 };
  const q = { x: a.x2, y: a.y2 };
  const r = { x: b.x1, y: b.y1 };
  const s = { x: b.x2, y: b.y2 };
  return side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0;
}

/** The box a label would occupy if placed in `direction` at `ring` pixels out. */
function labelBox(target, direction, ring, width) {
  const cx = target.px + direction.dx * ring;
  const cy = target.py + direction.dy * ring;
  const x0 =
    direction.anchor === 'middle' ? cx - width / 2 : direction.anchor === 'start' ? cx : cx - width;
  return { cx, cy, x0, x1: x0 + width, y0: cy - LABEL_HEIGHT / 2, y1: cy + LABEL_HEIGHT / 2 };
}

const padded = (box) => ({
  x0: box.x0 - LABEL_GAP,
  x1: box.x1 + LABEL_GAP,
  y0: box.y0 - LABEL_GAP,
  y1: box.y1 + LABEL_GAP,
});

/**
 * The hairline from a mark to its label: it runs to the nearest point of the
 * box, so it reads as a pointer and never crosses the text. Null when the label
 * is close enough that a pointer would be a smudge rather than a line.
 */
function leaderFor(target, box) {
  const ax = clamp(target.px, box.x0, box.x1);
  const ay = clamp(target.py, box.y0, box.y1);
  const length = Math.hypot(ax - target.px, ay - target.py);
  if (length <= 10) return null;
  const ux = (ax - target.px) / length;
  const uy = (ay - target.py) / length;
  return {
    x1: target.px + ux * 7,
    y1: target.py + uy * 7,
    x2: target.px + ux * (length - 2),
    y2: target.py + uy * (length - 2),
  };
}

/**
 * Names marks the way Artificial Analysis does: the label sits clear of its dot
 * with a hairline pointing back at it, rather than on top of it.
 *
 * Placement is greedy — targets are served in the order given, and each takes
 * the cheapest slot on the nearest ring that has one. Two rules are absolute: a
 * label may never overlap a label already placed, and it may never leave the
 * plot. A target with no such slot goes unnamed, because a name in the wrong
 * place is worse than no name. Everything else is priced rather than forbidden,
 * so a crowded chart degrades instead of emptying out — see the cost constants.
 *
 * @param {object} options
 * @param {SVGElement} options.svg   must already be in the document: widths are measured
 * @param {any[]} options.targets    positions to name, most important first
 * @param {any[]} options.obstacles  every plotted position, labelled or not
 * @param {any[]} options.segments   the drawn front lines, in chart coordinates
 */
function drawLabels({ svg, targets, obstacles, segments, plot, compact }) {
  if (targets.length === 0) return;

  const group = el('g', { class: 'mark-label' });
  svg.append(group);

  const rings = compact ? COMPACT_LABEL_RINGS : LABEL_RINGS;
  const reach = rings[rings.length - 1];
  const placed = [];

  for (const target of targets) {
    const text = el('text', { 'text-anchor': 'middle' });
    text.textContent = target.model.name;
    group.append(text);

    // getComputedTextLength needs a laid-out subtree; a hidden card gives 0.
    const measured = text.getComputedTextLength?.() ?? 0;
    const width = measured || target.model.name.length * LABEL_CHAR_WIDTH;

    // Only what could plausibly fall under this label is worth testing.
    const span = width + reach;
    const nearMarks = obstacles.filter(
      (p) => Math.abs(p.px - target.px) < span && Math.abs(p.py - target.py) < reach + LABEL_HEIGHT,
    );
    const nearLines = segments.filter(
      (s) =>
        Math.min(s.x1, s.x2) < target.px + span &&
        Math.max(s.x1, s.x2) > target.px - span &&
        Math.min(s.y1, s.y2) < target.py + reach + LABEL_HEIGHT &&
        Math.max(s.y1, s.y2) > target.py - reach - LABEL_HEIGHT,
    );

    let best = null;
    for (const ring of rings) {
      for (const direction of LABEL_DIRECTIONS) {
        const box = labelBox(target, direction, ring, width);
        if (box.x0 < plot.x || box.x1 > plot.x + plot.width) continue;
        if (box.y0 < plot.y || box.y1 > plot.y + plot.height) continue;
        const grown = padded(box);
        if (placed.some((other) => overlaps(other, grown))) continue;

        const leader = leaderFor(target, box);
        let cost = 0;
        for (const p of nearMarks) {
          if (covers(grown, p)) cost += p.ranked ? COVER_RANKED_COST : COVER_CLOUD_COST;
        }
        for (const line of nearLines) {
          if (segmentHitsBox(line, box)) cost += CROSS_FRONT_COST;
          else if (leader && segmentsCross(line, leader)) cost += CROSS_FRONT_LEADER_COST;
        }

        if (!best || cost < best.cost) best = { direction, box, grown, leader, cost };
        if (cost === 0) break;
      }
      if (best?.cost === 0) break;
    }

    if (!best) {
      text.remove();
      continue;
    }

    placed.push(best.grown);
    text.setAttribute('x', best.box.cx);
    // 11px glyphs are ~8px tall, so this sits the ink on the box's centre line.
    text.setAttribute('y', best.box.cy + 4);
    text.setAttribute('text-anchor', best.direction.anchor);

    // Leaders go in front of the group so every label paints over them: the
    // halo has to cut the line where it meets the text.
    if (best.leader) group.insertBefore(el('line', best.leader), group.firstChild);
  }
}

// ── rendering ────────────────────────────────────────────────────────────────

/**
 * Draws the scatter plus the tiered Pareto fronts.
 *
 * The viewBox is sized to the container in CSS pixels, so the chart fills the
 * space it is given on any display and label sizes stay true regardless of it.
 *
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {any[]} options.models        every model in the current slice
 * @param {any[][]} options.fronts      up to four fronts, outermost first
 * @param {object} options.xMetric
 * @param {object} options.yMetric
 * @param {Set<string>|null} options.matches  ids matching the search, or null when idle
 * @param {Set<number|'rest'>|null} options.visibleTiers  tiers to draw, or null for all
 * @param {boolean} options.showLabels  whether models are named on the plot
 * @param {(model: any, tierIndex: number|null, event: MouseEvent|null) => void} options.onHover
 */
export function renderChart({
  container,
  models,
  fronts,
  xMetric,
  yMetric,
  matches,
  visibleTiers,
  showLabels,
  onHover,
}) {
  const shows = (tier) => !visibleTiers || visibleTiers.has(tier);
  const tierOf = new Map();
  fronts.forEach((front, index) => front.forEach((model) => tierOf.set(model.id, index)));

  // Hidden tiers leave the plot entirely, so the axes rescale to what is left.
  const plotted = models.filter(
    (m) =>
      Number.isFinite(m[xMetric.key]) &&
      Number.isFinite(m[yMetric.key]) &&
      shows(tierOf.get(m.id) ?? 'rest'),
  );

  container.replaceChildren();

  if (plotted.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'Nothing to plot — every model is filtered out or missing one of the metrics.';
    container.append(empty);
    return;
  }

  const yTitle = document.createElement('div');
  yTitle.className = 'chart-axis-label chart-axis-y';
  yTitle.textContent = `Y · ${yMetric.axisLabel} · ${yMetric.dir === 'min' ? 'lower' : 'higher'} is better`;

  const viewport = document.createElement('div');
  viewport.className = 'chart-plot';

  const xTitle = document.createElement('div');
  xTitle.className = 'chart-axis-label chart-axis-x';
  xTitle.textContent = `X · ${xMetric.axisLabel} · ${xMetric.dir === 'min' ? 'lower' : 'higher'} is better`;
  container.append(yTitle, viewport, xTitle);

  const viewportBox = viewport.getBoundingClientRect();
  const compact = viewportBox.width <= COMPACT_BREAKPOINT;
  const minimumWidth = compact ? MIN_COMPACT_WIDTH : MIN_WIDE_WIDTH;
  const width = Math.max(minimumWidth, Math.floor(viewportBox.width));
  const height = Math.max(240, Math.floor(viewportBox.height));
  const pad = compact ? COMPACT_PAD : WIDE_PAD;
  const plotTop = pad.top;
  const plotHeight = height - pad.top - pad.bottom;

  // The vertical scale is independent of the left gutter, so it can be built
  // first and asked what its labels will say — which is what sets the gutter.
  const y = makeScale({
    values: plotted.map((m) => m[yMetric.key]),
    type: yMetric.scale,
    range: [plotTop + plotHeight, plotTop],
    // Horizontally there is nothing to reserve: a name is 200px wide and a
    // margin that fitted one would be most of the plot, so labels at the sides
    // are placed inwards instead. Vertically a label is 13px and fits.
    margin: edgeMargin(compact),
  });
  const yTicks = y.ticks(Math.max(4, Math.round(plotHeight / 60)));

  const labelGap = compact ? 4 : 8;
  // A degenerate domain can yield no ticks at all; the axis still needs a gutter.
  const widestLabel = yTicks.length
    ? Math.max(...yTicks.map((tick) => yMetric.format(tick).length))
    : 4;
  const left = Math.ceil(widestLabel * TICK_CHAR_WIDTH) + labelGap + 1;

  const plot = {
    x: left,
    y: plotTop,
    width: width - left - pad.right,
    height: plotHeight,
  };

  const x = makeScale({
    values: plotted.map((m) => m[xMetric.key]),
    type: xMetric.scale,
    range: [plot.x, plot.x + plot.width],
  });

  // Roughly one label per 110px horizontally.
  const xTicks = x.ticks(Math.max(compact ? 3 : 4, Math.round(plot.width / 110)));

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: 'img',
    'aria-label':
      `Scatter plot of ${plotted.length} language models, ` +
      `${xMetric.axisLabel} against ${yMetric.axisLabel}, ` +
      `with the first ${fronts.length} Pareto fronts highlighted. A table view lists the same data.`,
  });
  // A search that finds nothing dims nothing: there is no match to look at, so
  // greying the plot would only punish the typing.
  const searching = Boolean(matches && matches.size > 0);
  if (searching) svg.classList.add('is-searching');

  // In the document from here on, because label widths have to be measured.
  viewport.append(svg);

  // Grid + axes -------------------------------------------------------------
  const grid = el('g', { class: 'grid' });
  for (const tick of xTicks) {
    const px = x.map(tick);
    grid.append(el('line', { x1: px, y1: plot.y, x2: px, y2: plot.y + plot.height }));
  }
  for (const tick of yTicks) {
    const py = y.map(tick);
    grid.append(el('line', { x1: plot.x, y1: py, x2: plot.x + plot.width, y2: py }));
  }
  svg.append(grid);

  const axes = el('g', { class: 'axis' });
  axes.append(
    el('line', {
      x1: plot.x,
      y1: plot.y + plot.height,
      x2: plot.x + plot.width,
      y2: plot.y + plot.height,
    }),
    el('line', { x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.height }),
  );
  svg.append(axes);

  const tickLabels = el('g', { class: 'tick-label' });
  for (const tick of xTicks) {
    const label = el('text', {
      x: x.map(tick),
      y: plot.y + plot.height + (compact ? 17 : 20),
      'text-anchor': 'middle',
    });
    label.textContent = xMetric.format(tick);
    tickLabels.append(label);
  }
  for (const tick of yTicks) {
    const label = el('text', { x: plot.x - labelGap, y: y.map(tick) + 4, 'text-anchor': 'end' });
    label.textContent = yMetric.format(tick);
    tickLabels.append(label);
  }
  svg.append(tickLabels);

  // Marks -------------------------------------------------------------------
  const markClass = (model) => (matches && matches.has(model.id) ? 'is-match' : '');

  if (shows('rest')) {
    const rest = el('g', { class: 'mark-rest' });
    for (const model of plotted) {
      if (tierOf.has(model.id)) continue;
      rest.append(
        el('circle', {
          cx: x.map(model[xMetric.key]),
          cy: y.map(model[yMetric.key]),
          r: 3.5,
          class: markClass(model),
        }),
      );
    }
    svg.append(rest);
  }

  const xObjective = { value: (m) => m[xMetric.key], dir: xMetric.dir };
  const yObjective = { value: (m) => m[yMetric.key], dir: yMetric.dir };

  // Kept in chart coordinates as well as drawn: label placement is priced
  // partly on whether a name would be laid across one of these.
  const frontSegments = [];

  fronts.forEach((front, index) => {
    if (!shows(index)) return;
    const path = frontPath(front, xObjective, yObjective);
    if (path.length > 1) {
      const points = path.map((p) => ({ x: x.map(p.x), y: y.map(p.y) }));
      const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
      svg.append(el('path', { class: `front-line tier-${index}`, d }));
      for (let i = 1; i < points.length; i += 1) {
        frontSegments.push({
          x1: points[i - 1].x,
          y1: points[i - 1].y,
          x2: points[i].x,
          y2: points[i].y,
        });
      }
    }
  });

  fronts.forEach((front, index) => {
    if (!shows(index)) return;
    const group = el('g', { class: `mark-tier tier-${index}` });
    for (const model of front) {
      group.append(
        el('circle', {
          cx: x.map(model[xMetric.key]),
          cy: y.map(model[yMetric.key]),
          r: 5.5,
          class: markClass(model),
        }),
      );
    }
    svg.append(group);
  });

  const positions = plotted.map((model) => ({
    model,
    px: x.map(model[xMetric.key]),
    py: y.map(model[yMetric.key]),
    ranked: tierOf.has(model.id),
  }));

  // Names -------------------------------------------------------------------
  // Idle, the best front on show is named — that row of models is what the page
  // exists to point at, and the dominated cloud never gets a name because there
  // are hundreds of it. A search takes the labels over: only what matched is
  // named, so the answer to the query is the only thing spelled out.
  let labelled = [];
  if (!showLabels) {
    labelled = [];
  } else if (searching) {
    labelled = positions.filter((p) => matches.has(p.model.id));
    if (labelled.length > LABEL_RANKED_ONLY_ABOVE) {
      labelled = labelled.filter((p) => p.ranked);
    }
    // Better fronts are named first, so they win the space when it runs short.
    labelled.sort(
      (a, b) =>
        (tierOf.get(a.model.id) ?? fronts.length) - (tierOf.get(b.model.id) ?? fronts.length) ||
        a.px - b.px,
    );
  } else {
    const topTier = fronts.findIndex((front, index) => shows(index) && front.length > 0);
    if (topTier !== -1) {
      labelled = positions.filter((p) => tierOf.get(p.model.id) === topTier);
      const leftmost = Math.min(...labelled.map((p) => p.px));
      const rightmost = Math.max(...labelled.map((p) => p.px));
      // Most hemmed-in first, but the two ends of the front go before anyone.
      // They are the answers to "what is the best there is" and "what is the
      // least I can pay to still be on the front", and the top end sits in the
      // corner where space runs out first — served late it went unnamed.
      // Placement is greedy, so whoever goes first takes the closest slot, and
      // a model with room to spare can afford to wait. Plain left-to-right
      // order names just as many but pushes them further out: 230px of leader
      // line against 183, worst case 66px against 41, on the default view.
      // One past the most crowded a model could possibly be, so the ends
      // outrank everyone without the two of them tying at Infinity.
      const ahead = labelled.length + 1;
      const priority = new Map(
        labelled.map((p) => [
          p.model.id,
          p.px === leftmost || p.px === rightmost
            ? ahead
            : labelled.filter((q) => Math.hypot(q.px - p.px, q.py - p.py) < 130).length,
        ]),
      );
      labelled.sort((a, b) => priority.get(b.model.id) - priority.get(a.model.id) || a.px - b.px);
    }
  }
  drawLabels({
    svg,
    targets: labelled.slice(0, LABEL_LIMIT),
    obstacles: positions,
    segments: frontSegments,
    plot,
    compact,
  });

  // Hover layer -------------------------------------------------------------
  const highlight = el('circle', { class: 'hover-ring', r: 9, opacity: 0 });
  svg.append(highlight);

  const surface = el('rect', {
    x: plot.x,
    y: plot.y,
    width: plot.width,
    height: plot.height,
    fill: 'transparent',
  });

  surface.addEventListener('mousemove', (event) => {
    const rect = svg.getBoundingClientRect();
    const vx = ((event.clientX - rect.left) / rect.width) * width;
    const vy = ((event.clientY - rect.top) / rect.height) * height;

    let best = null;
    let bestDistance = Infinity;
    for (const p of positions) {
      const distance = (p.px - vx) ** 2 + (p.py - vy) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = p;
      }
    }
    // ~28px of slack, so you never have to hit a dot dead centre.
    if (!best || bestDistance > 28 ** 2) {
      highlight.setAttribute('opacity', 0);
      onHover(null, null, event);
      return;
    }
    highlight.setAttribute('cx', best.px);
    highlight.setAttribute('cy', best.py);
    highlight.setAttribute('opacity', 1);
    onHover(best.model, tierOf.get(best.model.id) ?? null, event);
  });

  surface.addEventListener('mouseleave', () => {
    highlight.setAttribute('opacity', 0);
    onHover(null, null, null);
  });

  svg.append(surface);
}
