import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequestHandler } from '../src/server.js';

const TOKEN = 'test-refresh-token';

const cachedResult = {
  fetchedAt: '2026-08-24T11:00:00.000Z',
  models: [{ id: 'a' }],
  cache: 'stale',
  stale: true,
  pages: 4,
  rateLimit: { limit: 100, remaining: 36 },
};

/** Records what the handler tried to do without touching disk or the network. */
function stubClient(overrides = {}) {
  const calls = { getCachedModels: 0, getModels: [] };
  return {
    calls,
    async getCachedModels() {
      calls.getCachedModels += 1;
      return cachedResult;
    },
    async getModels(options) {
      calls.getModels.push(options);
      return { ...cachedResult, cache: 'miss', stale: false };
    },
    async getUsage() {
      return { limit: 100, remaining: 36 };
    },
    ...overrides,
  };
}

function fakeResponse() {
  return {
    status: null,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers ?? {};
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
}

function request({
  method = 'GET',
  path = '/api/refresh',
  token,
  remoteAddress = '127.0.0.1',
  headers = {},
} = {}) {
  return {
    method,
    url: path,
    headers: {
      host: 'localhost:8787',
      'sec-fetch-site': 'same-origin',
      ...(token === undefined ? {} : { 'x-refresh-token': token }),
      ...headers,
    },
    socket: { remoteAddress },
  };
}

function handlerFor({ manualRefreshEnabled = true, client = stubClient() } = {}) {
  const handle = createRequestHandler({
    config: { manualRefreshEnabled, webRoot: '/nonexistent' },
    client,
    refreshToken: TOKEN,
  });
  return { handle, client };
}

async function call(handle, req) {
  const res = fakeResponse();
  await handle(req, res);
  return res;
}

test('serving models never calls upstream, however old the cache is', async () => {
  const { handle, client } = handlerFor();

  const res = await call(handle, request({ path: '/api/models' }));

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.stale, true);
  assert.equal(client.calls.getCachedModels, 1);
  // The whole point: no path from a page load to spending quota.
  assert.deepEqual(client.calls.getModels, []);
});

test('the old refresh query parameter no longer forces a fetch', async () => {
  const { handle, client } = handlerFor();

  const res = await call(handle, request({ path: '/api/models?refresh=1' }));

  assert.equal(res.status, 200);
  assert.deepEqual(client.calls.getModels, []);
});

test('a missing cache reports what to do instead of failing blankly', async () => {
  const client = stubClient({
    async getCachedModels() {
      throw new Error('No cached model data yet. Refresh once to fetch it from upstream.');
    },
  });
  const { handle } = handlerFor({ client });

  const res = await call(handle, request({ path: '/api/models' }));

  assert.equal(res.status, 503);
  assert.match(res.body.error, /Refresh once/);
});

test('refreshing spends quota only for a loopback, same-origin POST with the token', async () => {
  const { handle, client } = handlerFor();

  const res = await call(handle, request({ method: 'POST', token: TOKEN }));

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
  assert.deepEqual(client.calls.getModels, [{ force: true }]);
});

test('health tells the page whether to offer a refresh button at all', async () => {
  const on = handlerFor();
  const off = handlerFor({ manualRefreshEnabled: false });

  const enabled = await call(on.handle, request({ path: '/api/health' }));
  const disabled = await call(off.handle, request({ path: '/api/health' }));
  const remote = await call(
    on.handle,
    request({ path: '/api/health', remoteAddress: '192.168.1.50' }),
  );

  assert.equal(enabled.body.manualRefresh, true);
  assert.equal(disabled.body.manualRefresh, false);
  // Never admitted to anyone who could not use it anyway.
  assert.equal(remote.body.manualRefresh, false);
});

test('the refresh route does not exist unless the server was started with it on', async () => {
  const { handle, client } = handlerFor({ manualRefreshEnabled: false });

  const res = await call(handle, request({ method: 'POST', token: TOKEN }));

  // 404 rather than 403: a route that announces itself invites the next try.
  assert.equal(res.status, 404);
  assert.deepEqual(client.calls.getModels, []);
});

test('a remote client cannot reach the refresh route at all', async () => {
  const { handle, client } = handlerFor();

  const res = await call(
    handle,
    request({ method: 'POST', token: TOKEN, remoteAddress: '192.168.1.50' }),
  );

  assert.equal(res.status, 404);
  assert.deepEqual(client.calls.getModels, []);
});

test('refreshing cannot be triggered by navigating to a URL', async () => {
  const { handle, client } = handlerFor();

  const res = await call(handle, request({ method: 'GET', token: TOKEN }));

  assert.equal(res.status, 405);
  assert.deepEqual(client.calls.getModels, []);
});

test('another site cannot make the browser refresh on the reader behalf', async () => {
  const { handle, client } = handlerFor();

  const crossSite = await call(
    handle,
    request({ method: 'POST', token: TOKEN, headers: { 'sec-fetch-site': 'cross-site' } }),
  );
  const foreignOrigin = await call(
    handle,
    request({
      method: 'POST',
      token: TOKEN,
      headers: { 'sec-fetch-site': undefined, origin: 'https://attacker.example' },
    }),
  );

  assert.equal(crossSite.status, 403);
  assert.equal(foreignOrigin.status, 403);
  assert.deepEqual(client.calls.getModels, []);
});

test('reading the page is not enough: the token is required and compared whole', async () => {
  const { handle, client } = handlerFor();

  const missing = await call(handle, request({ method: 'POST' }));
  const wrong = await call(handle, request({ method: 'POST', token: 'guess' }));
  const prefix = await call(handle, request({ method: 'POST', token: TOKEN.slice(0, -1) }));

  assert.equal(missing.status, 403);
  assert.equal(wrong.status, 403);
  assert.equal(prefix.status, 403);
  assert.deepEqual(client.calls.getModels, []);
});

test('the refresh route answers without permissive CORS headers', async () => {
  const { handle } = handlerFor();

  const res = await call(handle, request({ method: 'POST', token: TOKEN }));

  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('the preflight never allows POST, so a cross-origin refresh cannot start', async () => {
  const { handle } = handlerFor();

  const res = await call(handle, request({ method: 'OPTIONS' }));

  assert.equal(res.status, 204);
  assert.doesNotMatch(res.headers['access-control-allow-methods'], /POST/);
  assert.doesNotMatch(res.headers['access-control-allow-headers'], /x-refresh-token/);
});

test('a double click costs one upstream walk, not two', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const client = stubClient({
    async getModels(options) {
      this.calls.getModels.push(options);
      await gate;
      return { ...cachedResult, cache: 'miss', stale: false };
    },
  });
  const { handle } = handlerFor({ client });

  const first = call(handle, request({ method: 'POST', token: TOKEN }));
  const second = call(handle, request({ method: 'POST', token: TOKEN }));
  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(client.calls.getModels.length, 1);
});
