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
 * Placement is tried in this order, nearest ring first, so a label lands as
 * close to its mark as the crowd allows. `dx`/`dy` are a unit direction.
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
];
/**
 * The outermost ring earns its long leader: without it the three longest names
 * in the crowded corner of the default view go unlabelled.
 */
const LABEL_RINGS = [18, 28, 40, 56, 78];
const COMPACT_LABEL_RINGS = [15, 23, 33, 46, 62];
/** A hard ceiling on labels, so a search for "gpt" cannot carpet the plot. */
const LABEL_LIMIT = 26;

const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

// ── scales ───────────────────────────────────────────────────────────────────

function makeScale({ values, type, range }) {
  const useLog = type === 'log' && values.every((v) => v > 0);
  const project = useLog ? Math.log10 : (v) => v;

  let lo = Math.min(...values.map(project));
  let hi = Math.max(...values.map(project));
  if (lo === hi) {
    lo -= 0.5;
    hi += 0.5;
  }
  const pad = (hi - lo) * 0.06;
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
 * Names marks the way Artificial Analysis does: the label sits clear of its dot
 * with a hairline pointing back at it, rather than on top of it.
 *
 * Placement is greedy — targets are served in the order given, and each takes
 * the nearest free slot. Two rules decide "free": a label may never overlap a
 * label already placed or leave the plot (hard, and a target with no such slot
 * simply goes unnamed — a wrong name is worse than no name), and it should not
 * cover other marks (soft, since the halo keeps it legible either way).
 *
 * @param {object} options
 * @param {SVGElement} options.svg   must already be in the document: widths are measured
 * @param {any[]} options.targets    positions to name, most important first
 * @param {any[]} options.obstacles  every plotted position, labelled or not
 */
function drawLabels({ svg, targets, obstacles, plot, compact }) {
  if (targets.length === 0) return;

  const group = el('g', { class: 'mark-label' });
  svg.append(group);

  const rings = compact ? COMPACT_LABEL_RINGS : LABEL_RINGS;
  const placed = [];

  for (const target of targets) {
    const text = el('text', { 'text-anchor': 'middle' });
    text.textContent = target.model.name;
    group.append(text);

    // getComputedTextLength needs a laid-out subtree; a hidden card gives 0.
    const measured = text.getComputedTextLength?.() ?? 0;
    const width = measured || target.model.name.length * LABEL_CHAR_WIDTH;

    // Only marks that could plausibly fall under this label are worth testing.
    const near = obstacles.filter(
      (p) => Math.abs(p.px - target.px) < 90 && Math.abs(p.py - target.py) < 60,
    );

    let best = null;
    for (const ring of rings) {
      for (const direction of LABEL_DIRECTIONS) {
        const box = labelBox(target, direction, ring, width);
        if (box.x0 < plot.x || box.x1 > plot.x + plot.width) continue;
        if (box.y0 < plot.y || box.y1 > plot.y + plot.height) continue;
        const grown = padded(box);
        if (placed.some((other) => overlaps(other, grown))) continue;

        const covered = near.filter(
          (p) => p.px > grown.x0 && p.px < grown.x1 && p.py > grown.y0 && p.py < grown.y1,
        ).length;
        if (covered === 0) {
          best = { direction, box, grown };
          break;
        }
        if (!best || covered < best.covered) best = { direction, box, grown, covered };
      }
      if (best && best.covered === undefined) break;
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

    // The leader runs from the edge of the mark to the nearest point of the
    // box, so it reads as a pointer and never crosses the text.
    const ax = clamp(target.px, best.box.x0, best.box.x1);
    const ay = clamp(target.py, best.box.y0, best.box.y1);
    const length = Math.hypot(ax - target.px, ay - target.py);
    if (length > 10) {
      const ux = (ax - target.px) / length;
      const uy = (ay - target.py) / length;
      group.insertBefore(
        el('line', {
          x1: target.px + ux * 7,
          y1: target.py + uy * 7,
          x2: target.px + ux * (length - 2),
          y2: target.py + uy * (length - 2),
        }),
        group.firstChild,
      );
    }
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

  fronts.forEach((front, index) => {
    if (!shows(index)) return;
    const path = frontPath(front, xObjective, yObjective);
    if (path.length > 1) {
      const d = path.map((p, i) => `${i === 0 ? 'M' : 'L'}${x.map(p.x)} ${y.map(p.y)}`).join(' ');
      svg.append(el('path', { class: `front-line tier-${index}`, d }));
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
  }));

  // Names -------------------------------------------------------------------
  // Idle, the best front on show is named — that row of models is what the page
  // exists to point at, and the dominated cloud never gets a name because there
  // are hundreds of it. A search takes the labels over: only what matched is
  // named, so the answer to the query is the only thing spelled out.
  let labelled = [];
  if (searching) {
    labelled = positions
      .filter((p) => matches.has(p.model.id))
      // Ranked models are named first, so they win the space when it runs short.
      .sort(
        (a, b) =>
          (tierOf.get(a.model.id) ?? fronts.length) - (tierOf.get(b.model.id) ?? fronts.length) ||
          a.px - b.px,
      );
  } else if (!compact) {
    // A phone has no room for a dozen names; the tooltip still reaches them.
    const topTier = fronts.findIndex((front, index) => shows(index) && front.length > 0);
    if (topTier !== -1) {
      labelled = positions.filter((p) => tierOf.get(p.model.id) === topTier);
      // Most hemmed-in first. Placement is greedy, so whoever goes first takes
      // the closest slot — and a model with room to spare can afford to be
      // served late, while one in the crowd cannot. Left-to-right order names
      // just as many but pushes them further out: 230px of leader line against
      // 183, worst case 66px against 41, on the default view.
      const crowding = new Map(
        labelled.map((p) => [
          p.model.id,
          labelled.filter((q) => Math.hypot(q.px - p.px, q.py - p.py) < 130).length,
        ]),
      );
      labelled.sort((a, b) => crowding.get(b.model.id) - crowding.get(a.model.id) || a.px - b.px);
    }
  }
  drawLabels({
    svg,
    targets: labelled.slice(0, LABEL_LIMIT),
    obstacles: positions,
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
