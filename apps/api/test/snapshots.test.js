import assert from 'node:assert/strict';
import test from 'node:test';

import { createSnapshotArtifacts } from '../src/collector/snapshots.js';

const fetchedAt = '2026-08-14T12:00:00.000Z';
const models = [
  { id: 'model-b', intelligence: 10, price: 2 },
  { id: 'model-a', intelligence: 8, price: 1 },
];
const paretoDefinitions = [
  {
    frontId: 'price-intelligence',
    objectives: [
      { key: 'price', dir: 'min' },
      { key: 'intelligence', dir: 'max' },
    ],
  },
];

test('snapshot artifacts are deterministic and keep the manifest separate', () => {
  const first = createSnapshotArtifacts({ models, fetchedAt, paretoDefinitions });
  const reordered = createSnapshotArtifacts({
    models: [...models].reverse(),
    fetchedAt,
    paretoDefinitions,
  });

  assert.deepEqual(reordered, first);
  assert.match(first.snapshotId, /^snapshot-[a-f0-9]{24}$/);
  assert.equal(first.immutableObjects.length, 2);
  assert.ok(
    first.immutableObjects.every(({ path }) =>
      path.startsWith(`public/snapshots/${first.snapshotId}/`),
    ),
  );
  assert.equal(first.manifestObject.path, 'public/latest.json');
  assert.equal(first.manifestObject.body.snapshotId, first.snapshotId);
  assert.deepEqual(
    first.immutableObjects[0].body.models.map(({ id }) => id),
    ['model-a', 'model-b'],
  );
});

test('any immutable payload change produces a different snapshot ID', () => {
  const baseline = createSnapshotArtifacts({ models, fetchedAt, paretoDefinitions });
  const laterGeneration = createSnapshotArtifacts({
    models,
    fetchedAt,
    generatedAt: '2026-08-14T12:00:01.000Z',
    paretoDefinitions,
  });
  const differentDefinition = createSnapshotArtifacts({
    models,
    fetchedAt,
    paretoDefinitions: [
      {
        frontId: 'speed-intelligence',
        objectives: [
          { key: 'price', dir: 'max' },
          { key: 'intelligence', dir: 'max' },
        ],
      },
    ],
  });

  assert.notEqual(laterGeneration.snapshotId, baseline.snapshotId);
  assert.notEqual(differentDefinition.snapshotId, baseline.snapshotId);
});

test('snapshot generation rejects duplicate or missing model IDs', () => {
  assert.throws(
    () => createSnapshotArtifacts({ models: [models[0], models[0]], fetchedAt }),
    /Duplicate model ID/,
  );
  assert.throws(() => createSnapshotArtifacts({ models: [{}], fetchedAt }), /requires/);
});
