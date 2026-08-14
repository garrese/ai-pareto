import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchModels, fetchUsage, resolveDataSource } from './api.js';

const snapshotId = 'snapshot-0123456789abcdef01234567';
const manifest = {
  schemaVersion: 1,
  snapshotId,
  fetchedAt: '2026-08-14T10:00:00.000Z',
  publishedAt: '2026-08-14T10:01:00.000Z',
  modelCount: 1,
  modelsPath: `public/snapshots/${snapshotId}/models.json`,
  paretoPath: `public/snapshots/${snapshotId}/pareto.json`,
};
const modelsDocument = {
  schemaVersion: 1,
  snapshotId,
  fetchedAt: manifest.fetchedAt,
  generatedAt: manifest.publishedAt,
  modelCount: 1,
  models: [{ id: 'model-1', name: 'Model 1' }],
};

function location(overrides = {}) {
  return {
    protocol: 'https:',
    hostname: 'example.web.app',
    origin: 'https://example.web.app',
    search: '',
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('localhost keeps the development API while production uses the configured snapshot root', () => {
  assert.deepEqual(
    resolveDataSource(location({ protocol: 'http:', hostname: 'localhost' }), {
      dataRoot: 'https://storage.googleapis.com/example',
    }),
    { mode: 'api', root: '' },
  );
  assert.deepEqual(
    resolveDataSource(location(), { dataRoot: 'https://storage.googleapis.com/example/' }),
    { mode: 'snapshot', root: 'https://storage.googleapis.com/example' },
  );
});

test('query parameters explicitly select either API or snapshot mode', () => {
  assert.deepEqual(
    resolveDataSource(location({ search: '?data=https://storage.example/bucket/' })),
    { mode: 'snapshot', root: 'https://storage.example/bucket' },
  );
  assert.deepEqual(
    resolveDataSource(location({ search: '?api=http://localhost:8787/' })),
    { mode: 'api', root: 'http://localhost:8787' },
  );
  assert.throws(
    () => resolveDataSource(location({ search: '?api=https://api&data=https://data' })),
    /either the api or data/,
  );
  assert.throws(
    () => resolveDataSource(location({ search: '?data=ftp://storage.example/bucket' })),
    /HTTP or HTTPS/,
  );
  assert.throws(
    () => resolveDataSource(location({ search: '?data=https://storage.example/bucket?token=x' })),
    /must not contain/,
  );
});

test('snapshot loading follows a validated manifest and returns the API-compatible model shape', async (t) => {
  const previousLocation = globalThis.location;
  const previousConfig = globalThis.ARTIFICIAL_ANALYZER_CONFIG;
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.location = previousLocation;
    globalThis.ARTIFICIAL_ANALYZER_CONFIG = previousConfig;
    globalThis.fetch = previousFetch;
  });

  globalThis.location = location();
  globalThis.ARTIFICIAL_ANALYZER_CONFIG = { dataRoot: 'https://storage.example/bucket' };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    return jsonResponse(calls.length === 1 ? manifest : modelsDocument);
  };

  const result = await fetchModels();

  assert.equal(result.cache, 'snapshot');
  assert.equal(result.snapshotId, snapshotId);
  assert.deepEqual(result.models, modelsDocument.models);
  assert.deepEqual(calls, [
    ['https://storage.example/bucket/public/latest.json', { cache: 'no-store' }],
    [`https://storage.example/bucket/${manifest.modelsPath}`, undefined],
  ]);
});

test('a manifest cannot redirect the page away from its matching immutable snapshot', async (t) => {
  const previousLocation = globalThis.location;
  const previousConfig = globalThis.ARTIFICIAL_ANALYZER_CONFIG;
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.location = previousLocation;
    globalThis.ARTIFICIAL_ANALYZER_CONFIG = previousConfig;
    globalThis.fetch = previousFetch;
  });

  globalThis.location = location();
  globalThis.ARTIFICIAL_ANALYZER_CONFIG = { dataRoot: 'https://storage.example/bucket' };
  globalThis.fetch = async () =>
    jsonResponse({ ...manifest, modelsPath: 'https://attacker.example/models.json' });

  await assert.rejects(fetchModels(), /unexpected model snapshot/);
});

test('a model document must match the manifest identity and count', async (t) => {
  const previousLocation = globalThis.location;
  const previousConfig = globalThis.ARTIFICIAL_ANALYZER_CONFIG;
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.location = previousLocation;
    globalThis.ARTIFICIAL_ANALYZER_CONFIG = previousConfig;
    globalThis.fetch = previousFetch;
  });

  globalThis.location = location();
  globalThis.ARTIFICIAL_ANALYZER_CONFIG = { dataRoot: 'https://storage.example/bucket' };
  let call = 0;
  globalThis.fetch = async () =>
    jsonResponse(call++ === 0 ? manifest : { ...modelsDocument, snapshotId: 'snapshot-bad' });

  await assert.rejects(fetchModels(), /does not match/);
});

test('the hosted snapshot mode does not expose private upstream quota data', async (t) => {
  const previousLocation = globalThis.location;
  const previousConfig = globalThis.ARTIFICIAL_ANALYZER_CONFIG;
  t.after(() => {
    globalThis.location = previousLocation;
    globalThis.ARTIFICIAL_ANALYZER_CONFIG = previousConfig;
  });

  globalThis.location = location();
  globalThis.ARTIFICIAL_ANALYZER_CONFIG = { dataRoot: 'https://storage.example/bucket' };
  await assert.rejects(fetchUsage(), /private operational data/);
});
