import assert from 'node:assert/strict';
import test from 'node:test';

import { createParetoRepresentation, paretoFrontIds } from '../src/collector/pareto.js';

const objectives = [
  { key: 'costPerTask', dir: 'min' },
  { key: 'intelligence', dir: 'max' },
];

const models = [
  { id: 'balanced', costPerTask: 2, intelligence: 10 },
  { id: 'cheap', costPerTask: 1, intelligence: 8 },
  { id: 'dominated', costPerTask: 3, intelligence: 7 },
  { id: 'more-dominated', costPerTask: 4, intelligence: 6 },
  { id: 'unmeasured', costPerTask: null, intelligence: 100 },
];

test('paretoFrontIds peels deterministic fronts and ignores incomplete points', () => {
  assert.deepEqual(paretoFrontIds(models, objectives, 4), [
    ['balanced', 'cheap'],
    ['dominated'],
    ['more-dominated'],
  ]);
});

test('createParetoRepresentation canonicalizes definition order', () => {
  const definitions = [
    { frontId: 'z-front', objectives },
    {
      frontId: 'a-front',
      objectives: [
        { key: 'intelligence', dir: 'max' },
        { key: 'costPerTask', dir: 'min' },
      ],
    },
  ];

  const result = createParetoRepresentation(models, definitions);
  assert.deepEqual(
    result.map(({ frontId }) => frontId),
    ['a-front', 'z-front'],
  );
  assert.deepEqual(result[0].tiers[0], ['balanced', 'cheap']);
});

test('Pareto definitions reject duplicate IDs and invalid directions', () => {
  assert.throws(
    () =>
      createParetoRepresentation(models, [
        { frontId: 'same', objectives },
        { frontId: 'same', objectives },
      ]),
    /unique/,
  );
  assert.throws(
    () => paretoFrontIds(models, [{ key: 'intelligence', dir: 'up' }, objectives[0]]),
    /min\/max/,
  );
});
