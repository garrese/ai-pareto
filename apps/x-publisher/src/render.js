const POST_LIMIT = 280;

/** X bills every URL at this length, whatever the URL actually says. */
const URL_WEIGHT = 23;
/** Most emoji are billed as two characters. Everything used here is Latin-1. */
const EMOJI = /\p{Extended_Pictographic}/u;
/** Below this a truncated name stops identifying anything, so we fail instead. */
const MIN_NAME = 24;

const MEDAL = ['🥇', '🥈', '🥉'];

/** Twelve hex characters of the event ID: enough to identify one post of ours. */
export const eventToken = (eventId) => eventId.slice('sha256:'.length, 19);

/** The visible form, used only when there is no link to hide the token inside. */
export const eventMarker = (eventId) => `[aa:${eventToken(eventId)}]`;

/**
 * RFC 3986 percent-encoding. `encodeURIComponent` leaves `!'()*` alone, and X's
 * link parser stops dead at a parenthesis — verified 2026-08-15 on a live post,
 * where the trailing `)` of a model name was cut off the link and left loose in
 * the text. Nearly every model here is named "Something (high)", so this is the
 * common case, not an edge one.
 */
const strictEncode = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Trims to `decimals` and drops trailing zeros — the same rule the site uses. */
const trim = (value, decimals) => String(Number(value.toFixed(decimals)));

/**
 * Formatting is duplicated from apps/web/src/metrics.js on purpose: the two
 * apps share no code and must not, but a post and the page it links to have to
 * show a model's numbers identically. Change one, change the other.
 */
const FORMAT = {
  intelligence: { label: 'intelligence', suffix: '', format: (v) => v.toFixed(1) },
  costPerTask: { label: 'cost', suffix: '/task', format: (v) => `$${trim(v, v >= 1 ? 2 : 4)}` },
  price: { label: 'price', suffix: '/1M', format: (v) => `$${trim(v, v >= 10 ? 0 : v >= 1 ? 2 : 3)}` },
  speed: { label: 'speed', suffix: '', format: (v) => `${v.toFixed(0)} t/s` },
  ttft: { label: 'latency', suffix: '', format: (v) => `${trim(v, 2)} s` },
};

const formatMetric = (key, value) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : (FORMAT[key]?.format(value) ?? String(value));

/** X's weighted count: URLs are flat-rated, emoji count double. */
export function weightedLength(text) {
  let total = 0;
  for (const line of text.split('\n')) {
    if (/^https?:\/\/\S+$/.test(line)) {
      total += URL_WEIGHT + 1;
      continue;
    }
    for (const character of line) total += EMOJI.test(character) ? 2 : 1;
    total += 1;
  }
  return total - 1;
}

const truncate = (name, limit) =>
  [...name].length <= limit ? name : `${[...name].slice(0, limit - 1).join('')}…`;

/**
 * Reading order is fixed — what you get, then what it costs — regardless of the
 * order the objectives happen to be declared in. Sorting on `dir` rather than
 * on position keeps "61.2 intelligence · $0.82/task" stable if a definition is
 * ever rewritten the other way round.
 */
const readingOrder = (objectives) =>
  [...objectives].sort((left, right) => (left.dir === 'max' ? -1 : 0) - (right.dir === 'max' ? -1 : 0));

/** "61.2 intelligence · $0.82/task" — the indented line under the headline. */
function statsLine(model, objectives) {
  return `   ${readingOrder(objectives)
    .map(({ key, dir }) => {
      const value = formatMetric(key, model.metrics?.[key]);
      const spec = FORMAT[key];
      return dir === 'max' ? `${value} ${spec?.label ?? key}` : `${value}${spec?.suffix ?? ''}`;
    })
    .join(' · ')}`;
}

/** "60.9 · $0.8367" — the same figures bare, for a model named inline. */
const inlineStats = (model, objectives) =>
  readingOrder(objectives)
    .map(({ key }) => formatMetric(key, model.metrics?.[key]))
    .join(' · ');

function moveLines(event, { nameLimit = Infinity, displacedStats = true, ownStats = true } = {}) {
  const { tier, previousTier, model, displaced, neighbour, objectives } = event;
  const name = truncate(model.name, nameLimit);
  const place = previousTier === null
    ? `enters Pareto front ${tier + 1}`
    : `climbs from front ${previousTier + 1} to front ${tier + 1}`;

  const lines = [`${MEDAL[tier]} ${name} ${place}`];
  if (ownStats) lines.push(statsLine(model, objectives));

  if (displaced.length === 1) {
    const other = truncate(displaced[0].name, nameLimit);
    lines.push(
      displacedStats
        ? `Displaces ${other} (${inlineStats(displaced[0], objectives)}).`
        : `Displaces ${other}.`,
    );
  } else if (displaced.length > 1) {
    lines.push(
      `Displaces ${displaced.length} models, ${truncate(displaced[0].name, nameLimit)} among them.`,
    );
  } else if (neighbour) {
    lines.push(`Sits just under ${truncate(neighbour.name, nameLimit)}.`);
  } else {
    lines.push('Tops the front — nothing above it.');
  }

  return lines;
}

function digestLines(event, { nameLimit = Infinity } = {}) {
  const { moveCount, perTier, headline, objectives } = event;
  const shape = perTier
    .map((count, tier) => (count > 0 ? `${MEDAL[tier]} ${count}` : null))
    .filter(Boolean)
    .join(' · ');
  return [
    `📊 ${moveCount} models moved up into the Pareto fronts`,
    `   ${shape}`,
    `Leading the batch: ${truncate(headline.model.name, nameLimit)} (${inlineStats(headline.model, objectives)}).`,
  ];
}

/**
 * Renders one post and guarantees it fits.
 *
 * When it does not fit, detail is dropped in a fixed order, cheapest loss
 * first: the displaced model's numbers, then the subject's own numbers, then
 * the names are truncated. Names are never silently cut before the numbers go,
 * because a wrong-looking name is worse than a missing figure.
 */
export function renderPost(event, publicSiteUrl = null) {
  const token = eventToken(event.eventId);
  const link = highlightUrl(event, publicSiteUrl, token);
  // The token has to survive in something the API gives back, or a post of ours
  // cannot be recognised as ours. Riding in the link keeps it out of the reader's
  // way; without a link there is nowhere to hide it, so it goes back on show.
  const marker = link ? null : eventMarker(event.eventId);
  const isDigest = event.type === 'pareto.scan.digest';
  const build = (options) =>
    [...(isDigest ? digestLines(event, options) : moveLines(event, options)), link, marker]
      .filter(Boolean)
      .join('\n');

  const ladder = [
    {},
    { displacedStats: false },
    { displacedStats: false, ownStats: false },
  ];

  for (const options of ladder) {
    const text = build(options);
    if (weightedLength(text) <= POST_LIMIT) return { text, marker, token };
  }

  const last = { displacedStats: false, ownStats: false };
  const longest = Math.max(
    ...[event.model?.name, event.headline?.model?.name, event.displaced?.[0]?.name, event.neighbour?.name]
      .filter(Boolean)
      .map((name) => [...name].length),
  );
  for (let limit = longest - 1; limit >= MIN_NAME; limit--) {
    const text = build({ ...last, nameLimit: limit });
    if (weightedLength(text) <= POST_LIMIT) return { text, marker, token };
  }

  throw new Error('Rendered X post exceeds 280 characters even with names truncated');
}

/**
 * Deep-links to the model highlighted on the site. The site reads `highlight`
 * into its search box, so the reader lands with the model ringed in the chart
 * instead of having to find it, and `e` carries the event token so the post can
 * still be recognised as ours. X flat-rates every URL at 23 characters, so
 * neither parameter costs anything.
 */
function highlightUrl(event, publicSiteUrl, token) {
  if (!publicSiteUrl) return null;
  const name = event.type === 'pareto.scan.digest' ? event.headline?.model?.name : event.model?.name;
  const root = publicSiteUrl.replace(/\/+$/, '');
  const query = [name ? `highlight=${strictEncode(name)}` : null, `e=${strictEncode(token)}`]
    .filter(Boolean)
    .join('&');
  return `${root}/?${query}`;
}
