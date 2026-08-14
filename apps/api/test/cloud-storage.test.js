import assert from 'node:assert/strict';
import test from 'node:test';

import { CloudStorageJsonStore } from '../src/collector/cloud-storage.js';

const auth = {
  async getClient() {
    return {
      async getRequestHeaders() {
        return { authorization: 'Bearer test-token' };
      },
    };
  },
};

test('immutable uploads use a create-only precondition and long-lived caching', async () => {
  const calls = [];
  const store = new CloudStorageJsonStore({
    bucketName: 'public-bucket',
    auth,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json({ generation: '1' });
    },
  });

  await store.putImmutable('public/snapshots/id/models.json', { models: [] });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('ifGenerationMatch'), '0');
  assert.match(calls[0].options.body, /max-age=31536000, immutable/);
  assert.match(calls[0].options.body, /public\/snapshots\/id\/models\.json/);
  assert.match(calls[0].options.body, /"contentType":"application\/json; charset=UTF-8"/);
  assert.equal(calls[0].options.headers.get('authorization'), 'Bearer test-token');
});

test('an existing identical immutable object makes retries idempotent', async () => {
  const body = { models: [{ id: 'model-a' }] };
  let requests = 0;
  const store = new CloudStorageJsonStore({
    bucketName: 'public-bucket',
    auth,
    fetchImpl: async (_url, options) => {
      requests += 1;
      if (options.method === 'POST') return new Response('', { status: 412 });
      return new Response(`${JSON.stringify(body, null, 2)}\n`);
    },
  });

  await store.putImmutable('public/snapshots/id/models.json', body);
  assert.equal(requests, 2);
});

test('an immutable name collision with different content is rejected', async () => {
  const store = new CloudStorageJsonStore({
    bucketName: 'public-bucket',
    auth,
    fetchImpl: async (_url, options) =>
      options.method === 'POST'
        ? new Response('', { status: 412 })
        : new Response('{"different":true}\n'),
  });

  await assert.rejects(
    () => store.putImmutable('public/snapshots/id/models.json', { models: [] }),
    /different content/,
  );
});

test('the mutable manifest uses short caching and no create-only precondition', async () => {
  let call;
  const store = new CloudStorageJsonStore({
    bucketName: 'public-bucket',
    auth,
    fetchImpl: async (url, options) => {
      call = { url: String(url), options };
      return Response.json({ generation: '2' });
    },
  });

  await store.putManifest('public/latest.json', { snapshotId: 'id' });

  assert.equal(new URL(call.url).searchParams.has('ifGenerationMatch'), false);
  assert.match(call.options.body, /max-age=60, must-revalidate/);
});
