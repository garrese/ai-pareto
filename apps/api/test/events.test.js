import assert from 'node:assert/strict';
import test from 'node:test';

import { createParetoChangeEvents } from '../src/collector/events.js';

const occurredAt = '2026-08-14T12:30:00.000Z';
const FRONT = 'cost-per-task-intelligence';

const DEFINITIONS = [
  {
    frontId: FRONT,
    published: true,
    objectives: [
      { key: 'costPerTask', dir: 'min' },
      { key: 'intelligence', dir: 'max' },
    ],
  },
  {
    frontId: 'price-intelligence',
    published: false,
    objectives: [
      { key: 'price', dir: 'min' },
      { key: 'intelligence', dir: 'max' },
    ],
  },
];

/** Cheap and clever beats expensive and dim, so higher `i` with lower `c` dominates. */
const model = (id, i, c) => ({ id, name: id.toUpperCase(), intelligence: i, costPerTask: c });

const document = (snapshotId, tiers, frontId = FRONT) => ({
  snapshotId,
  fronts: [{ frontId, tiers }],
});

const run = (previous, current, models, extra = {}) =>
  createParetoChangeEvents({
    previous,
    current,
    models,
    definitions: DEFINITIONS,
    occurredAt,
    ...extra,
  });

test('the first snapshot establishes a baseline without emitting events', () => {
  assert.deepEqual(
    createParetoChangeEvents({
      current: document('snapshot-first', [['a']]),
      models: [model('a', 50, 0.1)],
      definitions: DEFINITIONS,
      occurredAt,
    }),
    [],
  );
});

test('a newly monitored objective set establishes a baseline without an event', () => {
  assert.deepEqual(
    run({ snapshotId: 'snapshot-before', fronts: [] }, document('snapshot-after', [['a']]), [
      model('a', 50, 0.1),
    ]),
    [],
  );
});

test('an unpublished objective set never produces a post', () => {
  const models = [model('a', 50, 0.1), model('b', 40, 0.2)];
  const events = run(
    document('before', [['b']], 'price-intelligence'),
    document('after', [['a', 'b']], 'price-intelligence'),
    models,
  );
  assert.deepEqual(events, []);
});

test('an arrival in the top front names the model it displaced', () => {
  const models = [model('rival', 60, 0.5), model('old', 55, 0.6), model('filler', 30, 0.01)];
  const [event] = run(
    document('before', [['old', 'filler']]),
    document('after', [['rival', 'filler']], FRONT),
    models,
  );

  assert.equal(event.type, 'pareto.model.moved');
  assert.equal(event.schemaVersion, 2);
  assert.equal(event.tier, 0);
  assert.equal(event.previousTier, null);
  assert.equal(event.model.name, 'RIVAL');
  assert.deepEqual(event.model.metrics, { costPerTask: 0.5, intelligence: 60 });
  assert.deepEqual(
    event.displaced.map(({ name }) => name),
    ['OLD'],
  );
  assert.equal(event.neighbour, null);
  assert.match(event.eventId, /^sha256:[a-f0-9]{64}$/);
});

test('a model that leaves the front but was not beaten on both axes is not called displaced', () => {
  // `other` left the front, but the arrival is dearer AND dimmer than it, so
  // it cannot be the cause. Naming it would assert something untrue.
  const models = [model('arrival', 40, 0.4), model('other', 60, 0.3), model('top', 70, 0.9)];
  const [event] = run(
    document('before', [['other', 'top']]),
    document('after', [['arrival', 'top']]),
    models,
  );

  assert.deepEqual(event.displaced, []);
  assert.equal(event.neighbour.name, 'TOP');
});

test('an arrival that displaces nobody points at the model just ahead of it', () => {
  const models = [model('new', 45, 0.2), model('above', 55, 0.4), model('top', 65, 0.8)];
  const [event] = run(
    document('before', [['above', 'top']]),
    document('after', [['new', 'above', 'top']]),
    models,
  );

  assert.deepEqual(event.displaced, []);
  assert.equal(event.neighbour.name, 'ABOVE');
});

test('an arrival at the head of the front has no neighbour ahead of it', () => {
  const models = [model('new', 99, 0.9), model('below', 55, 0.4)];
  const [event] = run(
    document('before', [['below']]),
    document('after', [['new', 'below']]),
    models,
  );

  assert.deepEqual(event.displaced, []);
  assert.equal(event.neighbour, null);
});

test('a promotion carries the front it climbed from', () => {
  const models = [model('climber', 60, 0.3), model('other', 50, 0.5)];
  const [event] = run(
    document('before', [['other'], ['climber']]),
    document('after', [['climber'], ['other']]),
    models,
  );

  assert.equal(event.tier, 0);
  assert.equal(event.previousTier, 1);
  assert.equal(event.model.name, 'CLIMBER');
  assert.deepEqual(
    event.displaced.map(({ name }) => name),
    ['OTHER'],
  );
});

test('demotions and unchanged members stay silent', () => {
  const models = [model('a', 60, 0.3), model('b', 50, 0.5), model('c', 40, 0.7)];
  // `b` falls from front 1 to front 2 and `c` from 2 to 3: pure wake, no news.
  const events = run(
    document('before', [['a', 'b'], ['c'], []]),
    document('after', [['a'], ['b'], ['c']]),
    models,
  );

  assert.deepEqual(events, []);
});

test('one arrival that cascades through every front still produces a single post', () => {
  const models = [
    model('new', 70, 0.05),
    model('gold', 60, 0.3),
    model('silver', 50, 0.5),
    model('bronze', 40, 0.7),
  ];
  const events = run(
    document('before', [['gold'], ['silver'], ['bronze']]),
    document('after', [['new'], ['gold'], ['silver']]),
    models,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].model.name, 'NEW');
});

test('identical movements are idempotent across reruns, and differ when the front differs', () => {
  const models = [model('x', 60, 0.3), model('y', 50, 0.5), model('z', 40, 0.9)];
  const [first] = run(document('before-1', [['y']]), document('after-1', [['x', 'y']]), models);
  const [rerun] = run(document('before-2', [['y']]), document('after-2', [['x', 'y']]), models);
  assert.equal(first.eventId, rerun.eventId);

  const [other] = run(document('before-3', [['y']]), document('after-3', [['x', 'y', 'z']]), models);
  assert.notEqual(other.eventId, first.eventId);
});

test('several arrivals in one scan do not depend on the order the models arrive in', () => {
  // The three beat `victim` on both axes but not each other, so all three land
  // in the same front together — the case where an ordering bug would show.
  const models = [
    model('victim', 50, 0.9),
    model('cheap', 51, 0.2),
    model('middle', 55, 0.5),
    model('rich', 60, 0.8),
  ];
  const before = document('before', [['victim']]);
  const after = document('after', [['cheap', 'middle', 'rich']]);

  const signature = (order) =>
    JSON.stringify(
      run(before, after, order).map((event) => [
        event.eventId,
        event.model.name,
        event.displaced.map(({ name }) => name),
      ]),
    );

  const permutations = [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
    [1, 3, 0, 2],
    [2, 0, 3, 1],
  ].map((indexes) => indexes.map((index) => models[index]));

  const results = new Set(permutations.map(signature));
  assert.equal(results.size, 1, 'the same scan produced different events for different input order');
  assert.equal(run(before, after, models).length, 3);
});

test('the displaced model named in the post is the strongest one, not the first by ID', () => {
  const models = [
    model('winner', 70, 0.1),
    model('aaa-weak', 40, 0.5),
    model('zzz-strong', 65, 0.6),
    model('mmm-middle', 55, 0.7),
  ];
  const [event] = run(
    document('before', [['aaa-weak', 'zzz-strong', 'mmm-middle']]),
    document('after', [['winner']]),
    models,
  );

  assert.deepEqual(
    event.displaced.map(({ name }) => name),
    ['ZZZ-STRONG', 'MMM-MIDDLE', 'AAA-WEAK'],
  );
});

test('two arrivals that both beat the same model may both name it', () => {
  // Both statements are true — each really does beat `victim` on both axes —
  // so neither post is wrong. Attribution is not made exclusive on purpose.
  const models = [model('victim', 50, 0.9), model('cheap', 51, 0.2), model('rich', 60, 0.8)];
  const events = run(
    document('before', [['victim']]),
    document('after', [['cheap', 'rich']]),
    models,
  );

  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.displaced.some(({ name }) => name === 'VICTIM')));
});

test('by default a burst publishes one post per movement', () => {
  const models = Array.from({ length: 7 }, (_, index) => model(`m${index}`, 40 + index, 0.9 - index * 0.1));
  const events = run(
    document('before', [['m0'], [], []]),
    document('after', [['m1', 'm2', 'm3'], ['m4', 'm5'], ['m6']]),
    models,
  );

  assert.equal(events.length, 6);
  assert.ok(events.every((event) => event.type === 'pareto.model.moved'));
});

// The digest path is switched off (DIGEST_BURSTS) but kept working, so these
// two opt in explicitly. If it is ever switched back on, they already cover it.
test('a burst collapses into one digest instead of a wall of posts', () => {
  const models = Array.from({ length: 6 }, (_, index) => model(`m${index}`, 40 + index, 0.9 - index * 0.1));
  const events = run(
    document('before', [['m0'], [], []]),
    document('after', [['m1', 'm2', 'm3'], ['m4', 'm5'], []]),
    models,
    { maxPosts: 4, digestBursts: true },
  );

  assert.equal(events.length, 1);
  const [digest] = events;
  assert.equal(digest.type, 'pareto.scan.digest');
  assert.equal(digest.moveCount, 5);
  assert.deepEqual(digest.perTier, [3, 2, 0]);
  assert.equal(digest.headline.tier, 0);
  assert.equal(digest.headline.model.name, 'M3');
});

test('a batch at exactly the cap is still published individually', () => {
  const models = Array.from({ length: 5 }, (_, index) => model(`m${index}`, 40 + index, 0.9 - index * 0.1));
  const events = run(
    document('before', [['m0'], [], []]),
    document('after', [['m1', 'm2'], ['m3', 'm4'], []]),
    models,
    { maxPosts: 4, digestBursts: true },
  );

  assert.equal(events.length, 4);
  assert.ok(events.every((event) => event.type === 'pareto.model.moved'));
});

test('a front member missing from the dataset is skipped rather than half-rendered', () => {
  const events = run(
    document('before', [['known']]),
    document('after', [['ghost', 'known']]),
    [model('known', 50, 0.5)],
  );
  assert.deepEqual(events, []);
});
