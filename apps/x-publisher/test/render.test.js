import assert from 'node:assert/strict';
import test from 'node:test';

import { renderPost, eventMarker, eventToken, weightedLength } from '../src/render.js';

const SITE = 'https://aipareto.dev';
const EVENT_ID = `sha256:${'9f2c1a77b3d4e5f6'.repeat(4)}`;
const OBJECTIVES = [
  { key: 'costPerTask', dir: 'min' },
  { key: 'intelligence', dir: 'max' },
];

const model = (name, intelligence, costPerTask) => ({
  id: name.toLowerCase().replace(/\W+/g, '-'),
  name,
  metrics: { costPerTask, intelligence },
});

const move = (overrides = {}) => ({
  schemaVersion: 2,
  eventId: EVENT_ID,
  type: 'pareto.model.moved',
  occurredAt: '2026-08-15T08:00:00.000Z',
  fromSnapshot: 'snapshot-a'.padEnd(33, 'a'),
  toSnapshot: 'snapshot-b'.padEnd(33, 'b'),
  frontId: 'cost-per-task-intelligence',
  objectives: OBJECTIVES,
  tier: 0,
  previousTier: null,
  model: model('GPT-6 (high)', 61.2, 0.82),
  displaced: [model('Grok 4.6 (high)', 60.9, 0.8367)],
  neighbour: null,
  ...overrides,
});

// The two longest names on the real fronts as of the 2026-08-15 snapshot.
const LONGEST = 'Claude Fable 5 (Adaptive Reasoning, Max Effort, Opus 4.8 Fallback)';
const SECOND = 'Claude Opus 5 (Adaptive Reasoning, Medium Effort)';

const fits = (text) => weightedLength(text) <= 280;

test('a URL is billed at 23 characters however long it really is', () => {
  const short = `x\n${SITE}`;
  const long = `x\n${SITE}/?highlight=${'a'.repeat(400)}`;
  assert.equal(weightedLength(short), weightedLength(long));
  assert.equal(weightedLength('🥇'), 2);
});

test('the common case reads as the agreed template', () => {
  const { text, marker } = renderPost(move(), SITE);

  assert.equal(
    text,
    [
      '🥇 GPT-6 (high) enters Pareto front 1',
      '   61.2 intelligence · $0.82/task',
      'Displaces Grok 4.6 (high) (60.9 · $0.8367).',
      `${SITE}/?highlight=GPT-6%20%28high%29&e=${eventToken(EVENT_ID)}`,
    ].join('\n'),
  );
  // The token rides in the link, so no bracketed marker litters the body.
  assert.equal(marker, null);
  assert.ok(!text.includes('[aa:'));
  assert.ok(fits(text));
});

test('parentheses are percent-encoded, because X truncates a link at one', () => {
  // Verified against a live post: the trailing ")" was cut off the link and left
  // loose in the text. Almost every model here is named "Something (high)".
  const { text } = renderPost(move({ model: model('Grok 4.6 (high)', 60.9, 0.8367) }), SITE);
  const [link] = text.split('\n').filter((line) => line.startsWith('http'));

  assert.ok(!link.includes('('), `an unencoded parenthesis survived: ${link}`);
  assert.ok(!link.includes(')'), `an unencoded parenthesis survived: ${link}`);
  assert.equal(new URL(link).searchParams.get('highlight'), 'Grok 4.6 (high)');
});

test('the event token travels in the link so a post stays identifiable', () => {
  const { text, token } = renderPost(move(), SITE);
  const [link] = text.split('\n').filter((line) => line.startsWith('http'));

  assert.equal(new URL(link).searchParams.get('e'), token);
  assert.equal(token, eventToken(EVENT_ID));
});

test('numbers are formatted exactly as the site formats them', () => {
  const { text } = renderPost(
    move({
      model: model('Cheap Thing', 48.4, 0.131),
      displaced: [model('Dear Thing', 47.2, 3.14159)],
    }),
    SITE,
  );
  // $0.131 keeps four decimals but drops the trailing zero; $3.14 rounds to two
  // above a dollar; intelligence always shows one decimal.
  assert.match(text, /48\.4 intelligence · \$0\.131\/task/);
  assert.match(text, /\(47\.2 · \$3\.14\)/);
});

test('a promotion says which front it climbed from', () => {
  const { text } = renderPost(
    move({
      previousTier: 1,
      model: model('Kimi K3 (max)', 59.7, 0.55),
      displaced: [model(SECOND, 58.6, 0.7243), model('GPT-5.6 Sol (xhigh)', 59.0, 0.8072)],
    }),
    SITE,
  );

  assert.match(text, /^🥇 Kimi K3 \(max\) climbs from front 2 to front 1$/m);
  assert.match(text, /Displaces 2 models, .+ among them\./);
  assert.ok(fits(text));
});

test('an arrival that displaced nobody points at the model ahead of it', () => {
  const { text } = renderPost(
    move({
      tier: 2,
      model: model('Mistral Large 4', 48.4, 0.131),
      displaced: [],
      neighbour: model('Gemini 3.7 Flash (low)', 50.9, 0.1648),
    }),
    SITE,
  );

  assert.match(text, /^🥉 Mistral Large 4 enters Pareto front 3$/m);
  assert.match(text, /^Sits just under Gemini 3\.7 Flash \(low\)\.$/m);
});

test('a new leader with nothing ahead of it says so', () => {
  const { text } = renderPost(move({ displaced: [], neighbour: null }), SITE);
  assert.match(text, /^Tops the front — nothing above it\.$/m);
});

test('the real worst case — the two longest live names — still fits with full detail', () => {
  const { text } = renderPost(
    move({ model: model(LONGEST, 62.1, 3.1396), displaced: [model(SECOND, 58.6, 0.7243)] }),
    SITE,
  );

  assert.ok(fits(text));
  assert.match(text, /Displaces Claude Opus 5 \(Adaptive Reasoning, Medium Effort\) \(58\.6 · \$0\.7243\)\./);
  assert.ok(weightedLength(text) > 220, 'this case is meant to be close to the limit');
});

/**
 * Rather than guess the name length that trips each rung — a guess that rots
 * the moment the wording changes — sweep every length and assert the invariant
 * directly: the post always fits, and detail is only ever lost in the agreed
 * order. A name is never truncated while a number could have gone instead.
 */
test('detail is shed in the agreed order at every possible name length', () => {
  const seen = { full: 0, noDisplacedStats: 0, noStats: 0, truncated: 0 };

  for (let pad = 0; pad <= 260; pad++) {
    const name = `${LONGEST}${'x'.repeat(pad)}`;
    const { text } = renderPost(
      move({ model: model(name, 62.1, 3.1396), displaced: [model(SECOND, 58.6, 0.7243)] }),
      SITE,
    );

    const ownStats = / intelligence · /.test(text);
    const displacedStats = /^Displaces .* · \$/m.test(text);
    const truncated = text.includes('…');

    assert.ok(fits(text), `overflowed at pad ${pad}: ${weightedLength(text)}`);
    if (truncated) {
      assert.ok(!ownStats && !displacedStats, `pad ${pad} cut a name while numbers remained`);
    }
    if (!ownStats) {
      assert.ok(!displacedStats, `pad ${pad} dropped the subject's stats before the displaced one's`);
    }

    if (truncated) seen.truncated++;
    else if (!ownStats) seen.noStats++;
    else if (!displacedStats) seen.noDisplacedStats++;
    else seen.full++;
  }

  // Every rung must actually be exercised, or the sweep proves nothing.
  for (const [rung, count] of Object.entries(seen)) {
    assert.ok(count > 0, `the ${rung} rung was never reached`);
  }
});

test('an absurd name degrades to a truncated but valid post', () => {
  const monstrous = 'A'.repeat(400);
  const { text } = renderPost(
    move({ model: model(monstrous, 1, 1), displaced: [model(monstrous, 1, 1)] }),
    SITE,
  );

  assert.ok(fits(text));
  assert.ok(text.includes('…'));
  assert.match(text, /^🥇 A+…/);
});

test('every tier renders its own medal', () => {
  for (const [tier, medal] of [[0, '🥇'], [1, '🥈'], [2, '🥉']]) {
    const { text } = renderPost(move({ tier }), SITE);
    assert.ok(text.startsWith(medal), `front ${tier + 1} should open with ${medal}`);
  }
});

test('a missing metric renders as a dash rather than NaN or undefined', () => {
  const { text } = renderPost(
    move({ model: { ...model('Half Measured', 50, 0.2), metrics: { costPerTask: null, intelligence: 50 } } }),
    SITE,
  );
  assert.match(text, /50\.0 intelligence · —\/task/);
  assert.ok(!text.includes('NaN') && !text.includes('undefined'));
});

test('without a site to link to, the marker goes back on show', () => {
  // There is nowhere to hide the token, and a post we cannot recognise later is
  // worse than a slightly uglier one.
  const { text, marker } = renderPost(move(), null);

  assert.ok(!text.includes('http'));
  assert.equal(marker, eventMarker(EVENT_ID));
  assert.ok(text.endsWith(marker));
  assert.equal(text.split('\n').length, 4);
});

test('the digest names the batch, its shape and one model', () => {
  const { text } = renderPost(
    {
      schemaVersion: 2,
      eventId: EVENT_ID,
      type: 'pareto.scan.digest',
      occurredAt: '2026-08-15T08:00:00.000Z',
      fromSnapshot: 'a',
      toSnapshot: 'b',
      frontId: 'cost-per-task-intelligence',
      objectives: OBJECTIVES,
      moveCount: 11,
      perTier: [4, 5, 2],
      headline: { tier: 0, model: model('GPT-6 (high)', 61.2, 0.82) },
    },
    SITE,
  );

  assert.ok(fits(text));
  assert.match(text, /^📊 11 models moved up into the Pareto fronts$/m);
  assert.match(text, /🥇 4 · 🥈 5 · 🥉 2/);
  assert.match(text, /Leading the batch: GPT-6 \(high\) \(61\.2 · \$0\.82\)\./);
  assert.match(text, /highlight=GPT-6%20%28high%29/);
});
