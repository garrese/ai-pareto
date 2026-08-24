import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ArtificialAnalysisClient } from '../src/aa-client.js';

const rawModel = (id) => ({
  id,
  slug: id,
  name: id,
  model_creator: { id: 'creator', name: 'Creator' },
  evaluations: { artificial_analysis_intelligence_index: 10 },
  pricing: { price_1m_input_tokens: 1, price_1m_output_tokens: 5 },
  performance: { median_output_tokens_per_second: 20 },
});

async function withClient(fetchImpl, callback) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'artificial-analyzer-test-'));
  const client = new ArtificialAnalysisClient({
    apiKey: 'test-key',
    apiBase: 'https://example.test',
    apiPath: '/models',
    cacheDir,
    cacheTtlMs: 60_000,
    dailyLimit: 100,
    fetchImpl,
    now: () => new Date('2026-08-14T12:00:00.000Z'),
  });

  try {
    await callback(client);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}

test('fetchModels walks every page once and normalizes the result', async () => {
  const pages = [];
  const fetchImpl = async (url, options) => {
    pages.push(Number(url.searchParams.get('page')));
    assert.equal(options.headers['x-api-key'], 'test-key');
    const page = pages.at(-1);
    return Response.json(
      {
        data: [rawModel(`model-${page}`)],
        pagination: { has_more: page === 1 },
      },
      {
        headers: {
          'x-ratelimit-limit': '100',
          'x-ratelimit-remaining': String(100 - page),
          'x-ratelimit-reset': '1786712400',
        },
      },
    );
  };

  await withClient(fetchImpl, async (client) => {
    const result = await client.fetchModels();
    assert.deepEqual(pages, [1, 2]);
    assert.equal(result.pages, 2);
    assert.equal(result.models.length, 2);
    assert.equal(result.models[0].price, 2);
    assert.equal(result.rateLimit.remaining, 98);
  });
});

test('missing rate-limit headers use the configured fallback without inventing values', async () => {
  await withClient(
    async () => Response.json({ data: [], pagination: { has_more: false } }),
    async (client) => {
      const result = await client.fetchModels();
      assert.deepEqual(result.rateLimit, {
        limit: 100,
        remaining: null,
        resetsAt: null,
        source: 'config',
      });
    },
  );
});

test('fetchModels exposes upstream failures instead of returning stale cached data', async () => {
  await withClient(
    async () => new Response('temporary failure', { status: 503 }),
    async (client) => {
      await assert.rejects(() => client.fetchModels(), /returned 503/);
    },
  );
});

test('getCachedModels serves an expired cache instead of spending a request on it', async () => {
  let upstreamCalls = 0;
  const fetchImpl = async () => {
    upstreamCalls += 1;
    return Response.json({ data: [rawModel('fresh')], pagination: { has_more: false } });
  };

  await withClient(fetchImpl, async (client) => {
    // One deliberate fetch to populate the cache, then age it past the TTL.
    await client.getModels({ force: true });
    client.now = () => new Date('2026-08-15T12:00:00.000Z');
    const original = Date.now;
    Date.now = () => Date.parse('2026-08-15T12:00:00.000Z');

    try {
      const result = await client.getCachedModels();
      assert.equal(upstreamCalls, 1, 'reading the cache must not call upstream');
      assert.equal(result.cache, 'stale');
      assert.equal(result.stale, true);
      assert.equal(result.models.length, 1);
    } finally {
      Date.now = original;
    }
  });
});

test('getCachedModels says what to do when there is no cache at all', async () => {
  await withClient(
    async () => assert.fail('no upstream call should be made'),
    async (client) => {
      await assert.rejects(() => client.getCachedModels(), /Refresh once/);
    },
  );
});
