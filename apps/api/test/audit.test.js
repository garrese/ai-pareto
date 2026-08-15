import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeModelChanges, summarizeParetoChanges } from '../src/collector/audit.js';

test('model audit distinguishes real data changes from snapshot timestamp changes', () => {
  const previous = [
    { id: 'a', name: 'Model A', intelligence: 50, price: 1 },
    { id: 'removed', name: 'Removed', intelligence: 20, price: 0.2 },
  ];
  const current = [
    { id: 'a', name: 'Model A', intelligence: 52, price: 1 },
    { id: 'added', name: 'Added', intelligence: 40, price: 0.5 },
  ];

  const summary = summarizeModelChanges(previous, current);
  assert.equal(summary.changeDetected, true);
  assert.equal(summary.addedCount, 1);
  assert.equal(summary.removedCount, 1);
  assert.equal(summary.updatedCount, 1);
  assert.deepEqual(summary.updatedModels[0].changes, [
    { field: 'intelligence', before: 50, after: 52 },
  ]);

  assert.equal(summarizeModelChanges(current, structuredClone(current)).changeDetected, false);
});

test('model audit marks the first observed dataset as a baseline, not hundreds of additions', () => {
  const summary = summarizeModelChanges(null, [{ id: 'a', name: 'Model A' }]);
  assert.equal(summary.baseline, true);
  assert.equal(summary.changeDetected, false);
  assert.equal(summary.afterCount, 1);
  assert.equal(summary.addedCount, 0);
});

test('Pareto audit covers unpublished changes and explains publication eligibility', () => {
  const definitions = [
    { frontId: 'published', published: true },
    { frontId: 'monitored', published: false },
  ];
  const previous = {
    snapshotId: 'before',
    fronts: [
      { frontId: 'published', objectives: [], tiers: [['old'], ['climber']] },
      { frontId: 'monitored', objectives: [], tiers: [['quiet']] },
    ],
  };
  const current = {
    snapshotId: 'after',
    fronts: [
      { frontId: 'published', objectives: [], tiers: [['new', 'climber'], ['old']] },
      { frontId: 'monitored', objectives: [], tiers: [['quiet', 'unpublished']] },
    ],
  };
  const models = ['old', 'climber', 'new', 'quiet', 'unpublished']
    .map((id) => ({ id, name: id.toUpperCase() }));
  const publicationEvents = [{ frontId: 'published', eventId: 'event-new' }];

  const summaries = summarizeParetoChanges({
    previous,
    current,
    previousModels: models,
    currentModels: models,
    definitions,
    publicationEvents,
  });
  const published = summaries.find(({ frontId }) => frontId === 'published');
  assert.equal(published.arrivalCount, 1);
  assert.equal(published.promotionCount, 1);
  assert.equal(published.demotionCount, 1);
  assert.equal(published.plannedPublicationCount, 1);
  assert.equal(
    published.movements.find(({ id }) => id === 'climber').publicationEligible,
    true,
  );

  const monitored = summaries.find(({ frontId }) => frontId === 'monitored');
  assert.equal(monitored.changeDetected, true);
  assert.equal(monitored.publicationEnabled, false);
  assert.equal(monitored.plannedPublicationCount, 0);
  assert.equal(monitored.movements[0].publicationEligible, false);
});
