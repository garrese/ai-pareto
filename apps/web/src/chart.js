import { frontPath } from './pareto.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const COMPACT_BREAKPOINT = 520;
const MIN_COMPACT_WIDTH = 260;
const MIN_WIDE_WIDTH = 560;
const COMPACT_PAD = { top: 10, right: 10, bottom: 30, left: 52 };
const WIDE_PAD = { top: 12, right: 20, bottom: 34, left: 64 };

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
  const plot = {
    x: pad.left,
    y: pad.top,
    width: width - pad.left - pad.right,
    height: height - pad.top - pad.bottom,
  };

  const x = makeScale({
    values: plotted.map((m) => m[xMetric.key]),
    type: xMetric.scale,
    range: [plot.x, plot.x + plot.width],
  });
  const y = makeScale({
    values: plotted.map((m) => m[yMetric.key]),
    type: yMetric.scale,
    range: [plot.y + plot.height, plot.y],
  });

  // Roughly one label per 110px horizontally, one per 60px vertically.
  const xTicks = x.ticks(Math.max(compact ? 3 : 4, Math.round(plot.width / 110)));
  const yTicks = y.ticks(Math.max(4, Math.round(plot.height / 60)));

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: 'img',
    'aria-label':
      `Scatter plot of ${plotted.length} language models, ` +
      `${xMetric.axisLabel} against ${yMetric.axisLabel}, ` +
      `with the first four Pareto fronts highlighted. A table view lists the same data.`,
  });
  if (matches) svg.classList.add('is-searching');

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
      y: plot.y + plot.height + 20,
      'text-anchor': 'middle',
    });
    label.textContent = xMetric.format(tick);
    tickLabels.append(label);
  }
  for (const tick of yTicks) {
    const label = el('text', { x: plot.x - 10, y: y.map(tick) + 4, 'text-anchor': 'end' });
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

  // Hover layer -------------------------------------------------------------
  const highlight = el('circle', { class: 'hover-ring', r: 9, opacity: 0 });
  svg.append(highlight);

  const positions = plotted.map((model) => ({
    model,
    px: x.map(model[xMetric.key]),
    py: y.map(model[yMetric.key]),
  }));

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
  viewport.append(svg);
}
