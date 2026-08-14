import assert from 'node:assert/strict';
import test from 'node:test';

import { XApiError, XClient } from '../src/x-client.js';

const credentials = {
  consumerKey: 'consumer-key',
  consumerSecret: 'consumer-secret',
  accessToken: 'access-token',
  accessTokenSecret: 'access-token-secret',
};

const client = (fetchImpl) =>
  new XClient({
    credentials,
    userId: '123',
    fetchImpl,
    now: () => new Date('2026-08-14T12:00:00.000Z'),
    nonce: 'fixed-nonce',
  });

test('timeline reconciliation finds an existing deterministic marker', async () => {
  const x = client(async (url, options) => {
    assert.match(String(url), /\/2\/users\/123\/tweets/);
    assert.match(options.headers.authorization, /^OAuth /);
    return Response.json({ data: [{ id: 'post-1', text: 'Update [aa:abcdef]' }] });
  });

  assert.deepEqual(await x.findPostByMarker('[aa:abcdef]'), {
    id: 'post-1',
    text: 'Update [aa:abcdef]',
  });
});

test('createPost returns the X post identity', async () => {
  const x = client(async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { text: 'Hello' });
    return Response.json({ data: { id: 'post-2', text: 'Hello' } }, { status: 201 });
  });

  assert.deepEqual(await x.createPost('Hello'), { id: 'post-2', text: 'Hello' });
});

test('rate limits are classified as retryable without exposing full bodies', async () => {
  const x = client(async () => Response.json({ detail: 'slow down' }, { status: 429 }));
  await assert.rejects(
    () => x.createPost('Hello'),
    (error) => error instanceof XApiError && error.retryable && error.status === 429,
  );
});
