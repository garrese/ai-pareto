import assert from 'node:assert/strict';
import test from 'node:test';

import { creatorSelectionStates, defaultParetoContext } from './selection.js';

const maxX = { value: (point) => point.x, dir: 'max' };
const minY = { value: (point) => point.y, dir: 'min' };

test('default model checks match the peeled fronts plus the bounded context', () => {
  const models = [
    { id: 'front', x: 5, y: 1 },
    { id: 'second', x: 4, y: 2 },
    { id: 'third', x: 3, y: 3 },
    { id: 'runner', x: 2, y: 4 },
    { id: 'outside', x: 1, y: 5 },
    { id: 'unmeasured', x: null, y: 0 },
  ];

  const context = defaultParetoContext(models, [maxX, minY], 3, 1);
  assert.deepEqual([...context.modelIds], ['front', 'second', 'third', 'runner']);
  assert.equal(context.dominatedCount, 2);
});

test('creator state distinguishes all, some, and no selected models', () => {
  const models = [
    { id: 'a-1', creatorId: 'a' },
    { id: 'a-2', creatorId: 'a' },
    { id: 'b-1', creatorId: 'b' },
    { id: 'c-1', creatorId: 'c' },
  ];

  assert.deepEqual(
    creatorSelectionStates(models, new Set(['a-1', 'b-1'])),
    new Map([
      ['a', { total: 2, selected: 1 }],
      ['b', { total: 1, selected: 1 }],
      ['c', { total: 1, selected: 0 }],
    ]),
  );
});
