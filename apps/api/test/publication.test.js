import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publishImmutableObjects,
  publishManifestObject,
  publishSnapshot,
} from '../src/collector/publication.js';

const artifacts = {
  immutableObjects: [
    { path: 'public/snapshots/id/models.json', body: { models: [] } },
    { path: 'public/snapshots/id/pareto.json', body: { fronts: [] } },
  ],
  manifestObject: { path: 'public/latest.json', body: { snapshotId: 'id' } },
};

test('the manifest is published only after every immutable object', async () => {
  const completed = [];
  const storage = {
    async putImmutable(path) {
      await new Promise((resolve) => setTimeout(resolve, path.includes('models') ? 5 : 1));
      completed.push(path);
    },
    async putManifest(path) {
      completed.push(path);
    },
  };

  await publishSnapshot(artifacts, storage);

  assert.equal(completed.at(-1), 'public/latest.json');
  assert.deepEqual(new Set(completed.slice(0, -1)), new Set(artifacts.immutableObjects.map(({ path }) => path)));
});

test('an immutable write failure leaves the manifest untouched', async () => {
  let manifestWritten = false;
  const storage = {
    async putImmutable(path) {
      if (path.includes('pareto')) throw new Error('upload failed');
    },
    async putManifest() {
      manifestWritten = true;
    },
  };

  await assert.rejects(() => publishSnapshot(artifacts, storage), /upload failed/);
  assert.equal(manifestWritten, false);
});

test('immutable objects and the manifest can be published in separate phases', async () => {
  const calls = [];
  const storage = {
    async putImmutable(path) {
      calls.push(['immutable', path]);
    },
    async putManifest(path) {
      calls.push(['manifest', path]);
    },
  };

  await publishImmutableObjects(artifacts, storage);
  assert.equal(calls.some(([kind]) => kind === 'manifest'), false);

  await publishManifestObject(artifacts, storage);
  assert.deepEqual(calls.at(-1), ['manifest', 'public/latest.json']);
});
