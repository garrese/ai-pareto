import assert from 'node:assert/strict';
import test from 'node:test';

import { frontPath, paretoFronts } from './pareto.js';

const maxX = { value: (point) => point.x, dir: 'max' };
const minY = { value: (point) => point.y, dir: 'min' };

test('frontPath orders models by x and adds no staircase corners', () => {
  const models = [
    { id: 'right', x: 3, y: 1 },
    { id: 'left', x: 1, y: 3 },
    { id: 'middle', x: 2, y: 2 },
  ];

  assert.deepEqual(
    frontPath(models, maxX, minY).map(({ item, x, y }) => ({ id: item.id, x, y })),
    [
      { id: 'left', x: 1, y: 3 },
      { id: 'middle', x: 2, y: 2 },
      { id: 'right', x: 3, y: 1 },
    ],
  );
});

test('paretoFronts still peels dominated models into later tiers', () => {
  const models = [
    { id: 'fast', x: 3, y: 3 },
    { id: 'cheap', x: 1, y: 1 },
    { id: 'dominated', x: 1, y: 3 },
  ];

  assert.deepEqual(
    paretoFronts(models, [maxX, minY], 2).map((front) => front.map(({ id }) => id)),
    [['fast', 'cheap'], ['dominated']],
  );
});
