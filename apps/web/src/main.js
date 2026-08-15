import { dataSourceMode, fetchModels, fetchUsage } from './api.js';
import { METRICS, TIERS, objectiveFor } from './metrics.js';
import { paretoFronts, runnersUp } from './pareto.js';
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
  creatorFilter: document.getElementById('creator-filter'),
  creatorEmpty: document.getElementById('creator-empty'),
  modelPicker: document.getElementById('model-picker'),
  modelSummary: document.getElementById('model-summary'),
  modelList: document.getElementById('model-list'),
  modelsAll: document.getElementById('models-all'),
  modelsNone: document.getElementById('models-none'),
  modelFilter: document.getElementById('model-filter'),
  modelEmpty: document.getElementById('model-empty'),
  logScale: document.getElementById('log-scale'),
  showLabels: document.getElementById('show-labels'),
  viewChart: document.getElementById('view-chart'),
  viewTable: document.getElementById('view-table'),
  usage: document.getElementById('usage'),
  controls: document.getElementById('controls'),
  filtersToggle: document.getElementById('filters-toggle'),
  chartCard: document.getElementById('chart-card'),
  tableCard: document.getElementById('table-card'),
  chart: document.getElementById('chart'),
  legend: document.getElementById('legend'),
  tooltip: document.getElementById('tooltip'),
  tableBody: document.getElementById('table-body'),
};

/**
 * How many models off the fronts still get drawn. The full dominated cloud is
 * several hundred marks that bury the fronts they surround; this many keeps the
 * band immediately behind bronze, which is the only part of the cloud anyone
 * reads a Pareto chart for.
 */
const RUNNER_LIMIT = 30;

const state = {
  models: [],
  fronts: [],
  /** The models off the fronts that are still drawn — at most `RUNNER_LIMIT`. */
  runners: [],
  x: 'costPerTask',
  y: 'intelligence',
  /** Creator ids included in the Pareto calculation. */
  creators: new Set(),
  /** Model ids included in the Pareto calculation. */
  modelIds: new Set(),
  /** Visible tiers. Holds 0–2 for the fronts and 'rest' for the runners-up. */
  tiers: new Set(),
  query: '',
  view: 'chart',
};

/** The tier picker's rows: the fronts plus the runners-up drawn behind them. */
const TIER_ROWS = [
  ...TIERS.map((tier, index) => ({ key: index, label: tier.name })),
  { key: 'rest', label: 'Closest to a front' },
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

/**
 * Creators and models both filter the *input*, so the fronts are recomputed for
 * whatever is left — pick five models and you get the fronts among those five.
 * Tiers filter only what is drawn, because recomputing there would promote
 * silver into gold's place the moment gold was hidden.
 */
function currentSlice() {
  return state.models.filter(
    (model) => state.creators.has(model.creatorId) && state.modelIds.has(model.id),
  );
}

/** Null when everything is shown, so the chart can skip the filtering entirely. */
function visibleTiers() {
  return state.tiers.size === TIER_ROWS.length ? null : state.tiers;
}

const tierShown = (tier) => {
  const visible = visibleTiers();
  return !visible || visible.has(tier);
};

const hits = (model, query) =>
  model.name.toLowerCase().includes(query) ||
  (model.creator ?? '').toLowerCase().includes(query);

/** Ids whose name or creator contains the query, or null when the box is empty. */
function currentMatches(models) {
  const query = state.query.trim().toLowerCase();
  if (!query) return null;
  return new Set(models.filter((m) => hits(m, query)).map((m) => m.id));
}

// ── rendering ────────────────────────────────────────────────────────────────

function renderLegend(fronts, restCount, dominatedCount, matchCount) {
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

  // The count alone would read as the whole field. Saying how many dominated
  // models there are is the only place the reader learns the plot is a subset.
  const other = document.createElement('li');
  if (!tierShown('rest')) other.className = 'is-hidden';
  const otherLabel = document.createElement('span');
  otherLabel.textContent =
    restCount < dominatedCount
      ? `Closest to a front, of ${dominatedCount} dominated`
      : 'Dominated by the tiers above';
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

const byIntelligence = (a, b) => (b.intelligence ?? -Infinity) - (a.intelligence ?? -Infinity);

/** `tierIndex` is null for a runner-up: on show, but on none of the fronts. */
function tableRow(model, tierIndex, matches) {
  const row = document.createElement('tr');
  if (matches?.has(model.id)) row.className = 'is-match';

  // The colour carries the tier; the rank is there so it never rests on
  // colour alone, and "1st" costs a fraction of the width "Gold" does.
  const tierCell = document.createElement('td');
  const tierLabel = document.createElement('span');
  tierLabel.className = 'tier-cell';
  const text = document.createElement('span');
  text.textContent = tierIndex === null ? '—' : TIERS[tierIndex].rank;
  text.title = tierIndex === null ? 'Closest to a front' : TIERS[tierIndex].name;
  tierLabel.append(tierIndex === null ? dot('var(--rest-mark)') : dot(tierColor(tierIndex)), text);
  tierCell.append(tierLabel);

  const nameCell = document.createElement('th');
  nameCell.scope = 'row';
  nameCell.textContent = model.name;

  row.append(tierCell, nameCell);

  for (const key of ['intelligence', 'costPerTask', 'price', 'speed', 'ttft']) {
    const cell = document.createElement('td');
    cell.className = 'num';
    cell.textContent = Number.isFinite(model[key]) ? METRICS[key].format(model[key]) : '—';
    row.append(cell);
  }

  // Creator is the widest column and the least often scanned, so it sits last.
  const creatorCell = document.createElement('td');
  creatorCell.className = 'creator';
  creatorCell.textContent = model.creator ?? '—';
  row.append(creatorCell);

  return row;
}

/**
 * Everything the chart draws, in words. The runners-up are listed too now that
 * they are a bounded thirty rather than the whole dominated field.
 */
function renderTable(fronts, runners, matches) {
  dom.tableBody.replaceChildren();

  fronts.forEach((front, index) => {
    if (!tierShown(index)) return;
    for (const model of [...front].sort(byIntelligence)) {
      dom.tableBody.append(tableRow(model, index, matches));
    }
  });

  if (tierShown('rest')) {
    for (const model of [...runners].sort(byIntelligence)) {
      dom.tableBody.append(tableRow(model, null, matches));
    }
  }
}

function render() {
  const slice = currentSlice();
  const eligible = slice.filter(
    (m) => Number.isFinite(m[state.x]) && Number.isFinite(m[state.y]),
  );

  const objectives = [objectiveFor(state.x), objectiveFor(state.y)];
  state.fronts = paretoFronts(eligible, objectives, TIERS.length);

  // The fronts keep every model they claim; the cloud behind them is cut down to
  // the ones nearest to joining a front, which is what `runnersUp` peels for.
  const ranked = new Set(state.fronts.flatMap((front) => front.map((m) => m.id)));
  const dominated = eligible.filter((m) => !ranked.has(m.id));
  state.runners = runnersUp(dominated, objectives, RUNNER_LIMIT);

  const rest = [...state.runners];

  // Whatever was searched for is drawn even if the cut left it out. Every bot
  // post links here by model name, and a link that highlights nothing reads as
  // "that model is not in this data" rather than "that model is not on a front".
  const query = state.query.trim().toLowerCase();
  if (query) {
    const kept = new Set(rest.map((m) => m.id));
    rest.push(...dominated.filter((m) => !kept.has(m.id) && hits(m, query)));
  }

  const shown = [...state.fronts.flat(), ...rest];
  const matches = currentMatches(shown);

  updateTierCounts(state.fronts, rest.length);
  renderLegend(state.fronts, rest.length, dominated.length, matches ? matches.size : null);
  renderChart({
    container: dom.chart,
    models: shown,
    fronts: state.fronts,
    xMetric: metricFor(state.x),
    yMetric: metricFor(state.y),
    matches,
    visibleTiers: visibleTiers(),
    showLabels: dom.showLabels.checked,
    onHover: renderTooltip,
  });
  renderTable(state.fronts, rest, matches);
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
    chosen === TIER_ROWS.length
      ? 'All tiers'
      : chosen === 0
        ? 'No tiers'
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
    box.checked = true;
    state.tiers.add(key);
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

// ── searchable pickers ───────────────────────────────────────────────────────

/**
 * Sixty creators and six hundred models are both more than anyone scrolls
 * through. Rows are built once and hidden as you type: cheap to keep around,
 * expensive to rebuild on every keystroke.
 *
 * The action buttons then apply to what the filter leaves visible — otherwise
 * "Clear" would silently undo choices the reader cannot see — and relabel
 * themselves while a query is up so the narrower scope is not a surprise.
 */
function bindPickerFilter({ input, list, empty, all, none }) {
  const allLabel = all.textContent;
  const noneLabel = none.textContent;

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    let shown = 0;
    for (const row of list.children) {
      const hit = !query || row.dataset.search.includes(query);
      row.hidden = !hit;
      if (hit) shown += 1;
    }
    empty.hidden = shown > 0 || list.children.length === 0;
    all.textContent = query ? 'Select matches' : allLabel;
    none.textContent = query ? 'Clear matches' : noneLabel;
  });
}

const visibleBoxes = (list) => [...list.querySelectorAll('.picker-row:not([hidden]) input')];

function updateCreatorSummary() {
  const total = dom.creatorList.querySelectorAll('input').length;
  const chosen = state.creators.size;
  dom.creatorSummary.textContent =
    chosen === total
      ? 'All creators'
      : chosen === 0
        ? 'No creators'
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
    row.dataset.search = name.toLowerCase();

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = id;
    box.checked = true;
    state.creators.add(id);
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
  for (const box of visibleBoxes(dom.creatorList)) {
    box.checked = selected;
    if (selected) state.creators.add(box.value);
    else state.creators.delete(box.value);
  }
  updateCreatorSummary();
  render();
}

function updateModelSummary() {
  const total = dom.modelList.children.length;
  const chosen = state.modelIds.size;
  dom.modelSummary.textContent =
    chosen === total
      ? 'All models'
      : chosen === 0
        ? 'No models'
        : chosen === 1
          ? (state.models.find((m) => state.modelIds.has(m.id))?.name ?? '1 model')
          : `${chosen} of ${total} models`;
}

/**
 * Every model the payload holds, brightest first — which axes a model can be
 * plotted on changes with the axis pickers, so the list cannot be narrowed to
 * the plottable ones without rebuilding it on every axis change. The badge is
 * the intelligence index, the one figure that makes the ordering legible.
 */
function fillModelList(models) {
  const sorted = [...models].sort(
    (a, b) => byIntelligence(a, b) || a.name.localeCompare(b.name),
  );

  dom.modelList.replaceChildren();
  for (const model of sorted) {
    const row = document.createElement('label');
    row.className = 'picker-row';
    row.dataset.search = `${model.name} ${model.creator ?? ''}`.toLowerCase();

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = model.id;
    box.checked = true;
    state.modelIds.add(model.id);
    box.addEventListener('change', () => {
      if (box.checked) state.modelIds.add(model.id);
      else state.modelIds.delete(model.id);
      updateModelSummary();
      render();
    });

    // The creator sits under the name: half the models here are called
    // something-mini and the maker is what tells two of them apart.
    const text = document.createElement('span');
    text.className = 'picker-text';
    const name = document.createElement('span');
    name.textContent = model.name;
    const creator = document.createElement('span');
    creator.className = 'picker-note';
    creator.textContent = model.creator ?? 'Unknown creator';
    text.append(name, creator);

    const badge = document.createElement('span');
    badge.className = 'count';
    badge.textContent = Number.isFinite(model.intelligence)
      ? METRICS.intelligence.format(model.intelligence)
      : '—';

    row.append(box, text, badge);
    dom.modelList.append(row);
  }

  updateModelSummary();
}

function setAllModels(selected) {
  for (const box of visibleBoxes(dom.modelList)) {
    box.checked = selected;
    if (selected) state.modelIds.add(box.value);
    else state.modelIds.delete(box.value);
  }
  updateModelSummary();
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

/**
 * Narrow screens open on the data, not on a screenful of filters. The button is
 * hidden on wide layouts, where the controls row is always laid out anyway.
 */
function setFiltersOpen(open) {
  dom.controls.classList.toggle('is-open', open);
  dom.filtersToggle.setAttribute('aria-expanded', String(open));
  dom.filtersToggle.textContent = open ? 'Hide filters' : 'Show filters';
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
  dom.modelsAll.addEventListener('click', () => setAllModels(true));
  dom.modelsNone.addEventListener('click', () => setAllModels(false));
  bindPickerFilter({
    input: dom.creatorFilter,
    list: dom.creatorList,
    empty: dom.creatorEmpty,
    all: dom.creatorsAll,
    none: dom.creatorsNone,
  });
  bindPickerFilter({
    input: dom.modelFilter,
    list: dom.modelList,
    empty: dom.modelEmpty,
    all: dom.modelsAll,
    none: dom.modelsNone,
  });
  dom.logScale.addEventListener('change', render);
  dom.showLabels.addEventListener('change', render);
  dom.viewChart.addEventListener('click', () => setView('chart'));
  dom.viewTable.addEventListener('click', () => setView('table'));
  dom.filtersToggle.addEventListener('click', () =>
    setFiltersOpen(!dom.controls.classList.contains('is-open')),
  );
  dom.usage.addEventListener('click', showUsage);

  // Close a dropdown when clicking outside it.
  document.addEventListener('click', (event) => {
    for (const picker of [dom.tierPicker, dom.creatorPicker, dom.modelPicker]) {
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

/** The collector refreshes upstream on its own schedule; the page just reads it. */
async function load() {
  // Hold the previous render at reduced opacity rather than flashing a skeleton.
  dom.chartCard.classList.add('is-loading');

  try {
    const payload = await fetchModels();
    state.models = payload.models;
    dom.meta.classList.remove('is-error');
    dom.meta.textContent = describe(payload);

    if (!dom.creatorList.children.length) fillCreatorList(payload.models);
    if (!dom.modelList.children.length) fillModelList(payload.models);
    render();
  } catch (err) {
    dom.meta.classList.add('is-error');
    dom.meta.textContent = err.message;
  } finally {
    dom.chartCard.classList.remove('is-loading');
  }
}

/**
 * `?highlight=<model name>` pre-fills the search box, so a link from the X bot
 * lands with the model it is about ringed in the chart and marked in the table.
 * It highlights rather than filters, so the reader still sees the whole field.
 */
function applyHighlightParameter() {
  const requested = new URLSearchParams(globalThis.location?.search ?? '').get('highlight');
  if (!requested) return false;
  dom.search.value = requested;
  state.query = requested;
  return true;
}

/**
 * The same screens that fold the filters away start with names off: a dozen of
 * them on a phone-width plot would be the chart rather than an annotation of
 * it. A link from the bot turns them on anyway, whatever the screen — the name
 * is the entire reason that link was followed.
 */
function setNameDefault(highlighted) {
  const cramped =
    globalThis.matchMedia?.(
      '(max-width: 720px), (orientation: landscape) and (max-height: 500px) and (max-width: 960px)',
    ).matches ?? false;
  dom.showLabels.checked = highlighted || !cramped;
}

fillMetricSelects();
fillTierList();
bindControls();
setNameDefault(applyHighlightParameter());
setFiltersOpen(false);
try {
  if (dataSourceMode() === 'snapshot') dom.usage.hidden = true;
} catch {
  // load() renders configuration errors in the existing status region.
}
setView('chart');
load();
