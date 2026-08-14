import { dataSourceMode, fetchModels, fetchUsage } from './api.js';
import { METRICS, TIERS, objectiveFor } from './metrics.js';
import { paretoFronts } from './pareto.js';
import { renderChart } from './chart.js';

const dom = {
  meta: document.getElementById('meta'),
  quota: document.getElementById('quota'),
  xMetric: document.getElementById('x-metric'),
  yMetric: document.getElementById('y-metric'),
  search: document.getElementById('search'),
  tierPicker: document.getElementById('tier-picker'),
  tierSummary: document.getElementById('tier-summary'),
  tierList: document.getElementById('tier-list'),
  tiersAll: document.getElementById('tiers-all'),
  tiersNone: document.getElementById('tiers-none'),
  creatorPicker: document.getElementById('creator-picker'),
  creatorSummary: document.getElementById('creator-summary'),
  creatorList: document.getElementById('creator-list'),
  creatorsAll: document.getElementById('creators-all'),
  creatorsNone: document.getElementById('creators-none'),
  logScale: document.getElementById('log-scale'),
  viewChart: document.getElementById('view-chart'),
  viewTable: document.getElementById('view-table'),
  usage: document.getElementById('usage'),
  refresh: document.getElementById('refresh'),
  chartCard: document.getElementById('chart-card'),
  tableCard: document.getElementById('table-card'),
  chart: document.getElementById('chart'),
  legend: document.getElementById('legend'),
  tooltip: document.getElementById('tooltip'),
  tableBody: document.getElementById('table-body'),
};

const state = {
  models: [],
  fronts: [],
  x: 'costPerTask',
  y: 'intelligence',
  /** Empty means "every creator"; anything else is an explicit subset. */
  creators: new Set(),
  /** Empty means "every tier". Holds 0–3 for the fronts and 'rest' for the cloud. */
  tiers: new Set(),
  query: '',
  view: 'chart',
};

/** The tier picker's rows: the four fronts plus everything they dominate. */
const TIER_ROWS = [
  ...TIERS.map((tier, index) => ({ key: index, label: tier.name })),
  { key: 'rest', label: 'Others (dominated)' },
];

const tierColor = (index) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--tier-${index}`).trim();

const dot = (color) => {
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = color;
  return swatch;
};

/** The log toggle only downgrades to linear; a naturally linear metric stays linear. */
function metricFor(key) {
  const metric = METRICS[key];
  return dom.logScale.checked ? metric : { ...metric, scale: 'linear' };
}

function currentSlice() {
  return state.creators.size === 0
    ? state.models
    : state.models.filter((m) => state.creators.has(m.creatorId));
}

/** Null when everything is shown, so the chart can skip the filtering entirely. */
function visibleTiers() {
  return state.tiers.size === 0 || state.tiers.size === TIER_ROWS.length ? null : state.tiers;
}

const tierShown = (tier) => {
  const visible = visibleTiers();
  return !visible || visible.has(tier);
};

/** Ids whose name or creator contains the query, or null when the box is empty. */
function currentMatches(models) {
  const query = state.query.trim().toLowerCase();
  if (!query) return null;
  return new Set(
    models
      .filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          (m.creator ?? '').toLowerCase().includes(query),
      )
      .map((m) => m.id),
  );
}

// ── rendering ────────────────────────────────────────────────────────────────

function renderLegend(fronts, restCount, matchCount) {
  dom.legend.replaceChildren();

  TIERS.forEach((tier, index) => {
    const item = document.createElement('li');
    if (!tierShown(index)) item.className = 'is-hidden';
    const label = document.createElement('span');
    label.textContent = `${tier.name} — front ${index + 1}`;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${fronts[index]?.length ?? 0}`;
    item.append(dot(tierColor(index)), label, count);
    dom.legend.append(item);
  });

  const other = document.createElement('li');
  if (!tierShown('rest')) other.className = 'is-hidden';
  const otherLabel = document.createElement('span');
  otherLabel.textContent = 'Dominated by the tiers above';
  const otherCount = document.createElement('span');
  otherCount.className = 'count';
  otherCount.textContent = `${restCount}`;
  other.append(dot('var(--rest-mark)'), otherLabel, otherCount);
  dom.legend.append(other);

  if (matchCount !== null) {
    const match = document.createElement('li');
    match.className = 'legend-match';
    const label = document.createElement('span');
    label.textContent = `Matching “${state.query.trim()}”`;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${matchCount}`;
    match.append(label, count);
    dom.legend.append(match);
  }
}

function renderTooltip(model, tierIndex, event) {
  if (!model || !event) {
    dom.tooltip.hidden = true;
    return;
  }

  dom.tooltip.replaceChildren();

  const name = document.createElement('div');
  name.className = 'tip-name';
  name.textContent = model.name;

  const creator = document.createElement('div');
  creator.className = 'tip-creator';
  creator.textContent = model.creator ?? 'Unknown creator';

  dom.tooltip.append(name, creator);

  if (tierIndex !== null && tierIndex !== undefined) {
    const tier = document.createElement('div');
    tier.className = 'tip-tier';
    const text = document.createElement('span');
    text.textContent = `${TIERS[tierIndex].name} — front ${tierIndex + 1}`;
    tier.append(dot(tierColor(tierIndex)), text);
    dom.tooltip.append(tier);
  }

  const list = document.createElement('dl');
  for (const metric of Object.values(METRICS)) {
    const value = model[metric.key];
    const dt = document.createElement('dt');
    dt.textContent = metric.label;
    const dd = document.createElement('dd');
    dd.textContent = Number.isFinite(value) ? metric.format(value) : '—';
    list.append(dt, dd);
  }
  dom.tooltip.append(list);

  dom.tooltip.hidden = false;
  const box = dom.tooltip.getBoundingClientRect();
  const left = Math.min(event.clientX + 16, window.innerWidth - box.width - 12);
  const top = Math.min(event.clientY + 16, window.innerHeight - box.height - 12);
  dom.tooltip.style.left = `${Math.max(12, left)}px`;
  dom.tooltip.style.top = `${Math.max(12, top)}px`;
}

function renderTable(fronts, matches) {
  dom.tableBody.replaceChildren();

  fronts.forEach((front, index) => {
    if (!tierShown(index)) return;
    const sorted = [...front].sort(
      (a, b) => (b.intelligence ?? -Infinity) - (a.intelligence ?? -Infinity),
    );

    for (const model of sorted) {
      const row = document.createElement('tr');
      if (matches?.has(model.id)) row.className = 'is-match';

      const tierCell = document.createElement('td');
      const tierLabel = document.createElement('span');
      tierLabel.className = 'tier-cell';
      const text = document.createElement('span');
      text.textContent = TIERS[index].name;
      tierLabel.append(dot(tierColor(index)), text);
      tierCell.append(tierLabel);

      const nameCell = document.createElement('th');
      nameCell.scope = 'row';
      nameCell.textContent = model.name;

      const creatorCell = document.createElement('td');
      creatorCell.textContent = model.creator ?? '—';

      row.append(tierCell, nameCell, creatorCell);

      for (const key of ['intelligence', 'price', 'costPerTask', 'speed', 'ttft']) {
        const cell = document.createElement('td');
        cell.className = 'num';
        cell.textContent = Number.isFinite(model[key]) ? METRICS[key].format(model[key]) : '—';
        row.append(cell);
      }

      dom.tableBody.append(row);
    }
  });
}

function render() {
  const slice = currentSlice();
  const eligible = slice.filter(
    (m) => Number.isFinite(m[state.x]) && Number.isFinite(m[state.y]),
  );

  state.fronts = paretoFronts(eligible, [objectiveFor(state.x), objectiveFor(state.y)], 4);
  const ranked = state.fronts.reduce((total, front) => total + front.length, 0);
  const matches = currentMatches(eligible);

  const restCount = eligible.length - ranked;
  updateTierCounts(state.fronts, restCount);
  renderLegend(state.fronts, restCount, matches ? matches.size : null);
  renderChart({
    container: dom.chart,
    models: eligible,
    fronts: state.fronts,
    xMetric: metricFor(state.x),
    yMetric: metricFor(state.y),
    matches,
    visibleTiers: visibleTiers(),
    onHover: renderTooltip,
  });
  renderTable(state.fronts, matches);
}

// ── controls ─────────────────────────────────────────────────────────────────

function fillMetricSelects() {
  for (const [select, selected] of [
    [dom.xMetric, state.x],
    [dom.yMetric, state.y],
  ]) {
    select.replaceChildren();
    for (const metric of Object.values(METRICS)) {
      const option = document.createElement('option');
      option.value = metric.key;
      option.textContent = metric.label;
      option.selected = metric.key === selected;
      select.append(option);
    }
  }
}

function updateTierSummary() {
  const chosen = state.tiers.size;
  dom.tierSummary.textContent =
    chosen === 0 || chosen === TIER_ROWS.length
      ? 'All tiers'
      : chosen === 1
        ? (TIER_ROWS.find((row) => state.tiers.has(row.key))?.label ?? '1 tier')
        : `${chosen} of ${TIER_ROWS.length} tiers`;
}

/** Counts depend on the axes and the creator filter, so they are refreshed per render. */
function updateTierCounts(fronts, restCount) {
  for (const badge of dom.tierList.querySelectorAll('.count')) {
    const key = badge.dataset.tier;
    badge.textContent = `${key === 'rest' ? restCount : (fronts[Number(key)]?.length ?? 0)}`;
  }
}

function fillTierList() {
  dom.tierList.replaceChildren();

  for (const { key, label } of TIER_ROWS) {
    const row = document.createElement('label');
    row.className = 'picker-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = String(key);
    box.addEventListener('change', () => {
      if (box.checked) state.tiers.add(key);
      else state.tiers.delete(key);
      updateTierSummary();
      render();
    });

    const swatch = key === 'rest' ? dot('var(--rest-mark)') : dot(tierColor(key));
    const text = document.createElement('span');
    text.textContent = label;
    const badge = document.createElement('span');
    badge.className = 'count';
    badge.dataset.tier = String(key);

    row.append(box, swatch, text, badge);
    dom.tierList.append(row);
  }

  updateTierSummary();
}

function setAllTiers(selected) {
  state.tiers.clear();
  for (const box of dom.tierList.querySelectorAll('input')) {
    box.checked = selected;
    if (selected) state.tiers.add(box.value === 'rest' ? 'rest' : Number(box.value));
  }
  updateTierSummary();
  render();
}

function updateCreatorSummary() {
  const total = dom.creatorList.querySelectorAll('input').length;
  const chosen = state.creators.size;
  dom.creatorSummary.textContent =
    chosen === 0 || chosen === total
      ? 'All creators'
      : chosen === 1
        ? (state.models.find((m) => state.creators.has(m.creatorId))?.creator ?? '1 creator')
        : `${chosen} of ${total} creators`;
}

function fillCreatorList(models) {
  const counts = new Map();
  for (const model of models) {
    if (!model.creatorId) continue;
    const entry = counts.get(model.creatorId) ?? { name: model.creator, count: 0 };
    entry.count += 1;
    counts.set(model.creatorId, entry);
  }

  const sorted = [...counts].sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name));

  dom.creatorList.replaceChildren();
  for (const [id, { name, count }] of sorted) {
    const row = document.createElement('label');
    row.className = 'picker-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = id;
    box.addEventListener('change', () => {
      if (box.checked) state.creators.add(id);
      else state.creators.delete(id);
      updateCreatorSummary();
      render();
    });

    const text = document.createElement('span');
    text.textContent = name;
    const badge = document.createElement('span');
    badge.className = 'count';
    badge.textContent = `${count}`;

    row.append(box, text, badge);
    dom.creatorList.append(row);
  }

  updateCreatorSummary();
}

function setAllCreators(selected) {
  state.creators.clear();
  for (const box of dom.creatorList.querySelectorAll('input')) {
    box.checked = selected;
    if (selected) state.creators.add(box.value);
  }
  updateCreatorSummary();
  render();
}

function setView(view) {
  state.view = view;
  const isChart = view === 'chart';
  dom.chartCard.hidden = !isChart;
  dom.tableCard.hidden = isChart;
  dom.viewChart.classList.toggle('is-active', isChart);
  dom.viewTable.classList.toggle('is-active', !isChart);
  dom.viewChart.setAttribute('aria-pressed', String(isChart));
  dom.viewTable.setAttribute('aria-pressed', String(!isChart));
  if (isChart) render();
}

/** X and Y must differ, otherwise every point sits on a diagonal. */
function swapIfCollision(changed) {
  if (state.x !== state.y) return;
  const fallback = Object.keys(METRICS).find((key) => key !== state.y);
  if (changed === 'x') {
    state.y = fallback;
    dom.yMetric.value = fallback;
  } else {
    state.x = fallback;
    dom.xMetric.value = fallback;
  }
}

function bindControls() {
  dom.xMetric.addEventListener('change', () => {
    state.x = dom.xMetric.value;
    swapIfCollision('x');
    render();
  });
  dom.yMetric.addEventListener('change', () => {
    state.y = dom.yMetric.value;
    swapIfCollision('y');
    render();
  });
  dom.search.addEventListener('input', () => {
    state.query = dom.search.value;
    render();
  });
  dom.tiersAll.addEventListener('click', () => setAllTiers(true));
  dom.tiersNone.addEventListener('click', () => setAllTiers(false));
  dom.creatorsAll.addEventListener('click', () => setAllCreators(true));
  dom.creatorsNone.addEventListener('click', () => setAllCreators(false));
  dom.logScale.addEventListener('change', render);
  dom.viewChart.addEventListener('click', () => setView('chart'));
  dom.viewTable.addEventListener('click', () => setView('table'));
  dom.refresh.addEventListener('click', () => load({ refresh: true }));
  dom.usage.addEventListener('click', showUsage);

  // Close a dropdown when clicking outside it.
  document.addEventListener('click', (event) => {
    for (const picker of [dom.tierPicker, dom.creatorPicker]) {
      if (picker.open && !picker.contains(event.target)) picker.open = false;
    }
  });

  // The chart is drawn at the container's pixel size, so it has to be redrawn
  // whenever that box changes — including the first time it is laid out, and
  // when the controls row wraps. `lastSize` stops the redraw from observing
  // itself forever.
  let lastSize = '';
  const redrawIfResized = () => {
    const size = `${dom.chart.clientWidth}x${dom.chart.clientHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    if (state.view === 'chart' && state.models.length) render();
  };

  new ResizeObserver(redrawIfResized).observe(dom.chart);

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    dom.tooltip.hidden = true;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redrawIfResized, 120);
  });
}

// ── data ─────────────────────────────────────────────────────────────────────

function describe(payload) {
  const source =
    payload.cache === 'snapshot'
      ? `published snapshot ${payload.snapshotId.replace(/^snapshot-/, '').slice(0, 8)}`
      : payload.cache === 'hit'
        ? 'from cache'
        : payload.stale
          ? 'stale cache'
          : 'freshly fetched';
  const parts = [
    `${payload.count} models`,
    `updated ${new Date(payload.fetchedAt).toLocaleString()}`,
    source,
  ];
  if (payload.warning) parts.push(`refresh failed: ${payload.warning}`);
  return parts.join(' · ');
}

async function showUsage() {
  dom.usage.disabled = true;
  try {
    const usage = await fetchUsage();
    dom.quota.hidden = false;
    dom.quota.classList.remove('is-error');

    if (usage.remaining === null) {
      dom.quota.textContent =
        `No quota reading yet — the limit is ${usage.limit} requests per 24h window. ` +
        'Fetch data once and the API reports the real figure.';
      return;
    }

    const resets = usage.resetsAt ? new Date(usage.resetsAt).toLocaleString() : 'unknown';
    dom.quota.textContent =
      `${usage.remaining} of ${usage.limit} requests left · window resets ${resets} · ` +
      `${usage.requestsMade} requests made from here · ` +
      `read ${new Date(usage.observedAt).toLocaleString()}`;
  } catch (err) {
    dom.quota.hidden = false;
    dom.quota.classList.add('is-error');
    dom.quota.textContent = err.message;
  } finally {
    dom.usage.disabled = false;
  }
}

async function load({ refresh = false } = {}) {
  dom.refresh.disabled = true;
  // Hold the previous render at reduced opacity rather than flashing a skeleton.
  dom.chartCard.classList.add('is-loading');

  try {
    const payload = await fetchModels({ refresh });
    state.models = payload.models;
    dom.meta.classList.remove('is-error');
    dom.meta.textContent = describe(payload);

    if (!dom.creatorList.children.length) fillCreatorList(payload.models);
    render();
  } catch (err) {
    dom.meta.classList.add('is-error');
    dom.meta.textContent = err.message;
  } finally {
    dom.refresh.disabled = false;
    dom.chartCard.classList.remove('is-loading');
  }
}

fillMetricSelects();
fillTierList();
bindControls();
try {
  if (dataSourceMode() === 'snapshot') dom.usage.hidden = true;
} catch {
  // load() renders configuration errors in the existing status region.
}
setView('chart');
load();
