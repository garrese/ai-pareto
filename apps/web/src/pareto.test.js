import assert from 'node:assert/strict';
import test from 'node:test';

import { frontPath, paretoFronts, runnersUp } from './pareto.js';

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

test('runnersUp takes whole fronts in peeling order until the limit', () => {
  // Three nested fronts of one model each, listed worst first so the result
  // cannot come out right by accident.
  const models = [
    { id: 'third', x: 1, y: 3 },
    { id: 'second', x: 2, y: 2 },
    { id: 'first', x: 3, y: 1 },
  ];

  assert.deepEqual(
    runnersUp(models, [maxX, minY], 2).map(({ id }) => id),
    ['first', 'second'],
  );
  assert.equal(runnersUp(models, [maxX, minY], 0).length, 0);
  assert.equal(runnersUp(models, [maxX, minY], 99).length, 3);
});

test('runnersUp spreads an overflowing front instead of cutting its tail off', () => {
  // One front of five: more x costs more y, so nobody dominates anybody. Room
  // for three, and the two ends must survive.
  const front = [
    { id: 'a', x: 1, y: 1 },
    { id: 'b', x: 2, y: 2 },
    { id: 'c', x: 3, y: 3 },
    { id: 'd', x: 4, y: 4 },
    { id: 'e', x: 5, y: 5 },
  ];

  assert.deepEqual(
    runnersUp(front, [maxX, minY], 3).map(({ id }) => id),
    ['a', 'c', 'e'],
  );
});

test('runnersUp stops rather than spinning on models missing an objective', () => {
  const models = [
    { id: 'measured', x: 1, y: 1 },
    { id: 'unmeasured', x: null, y: 2 },
  ];

  assert.deepEqual(
    runnersUp(models, [maxX, minY], 10).map(({ id }) => id),
    ['measured'],
  );
});
