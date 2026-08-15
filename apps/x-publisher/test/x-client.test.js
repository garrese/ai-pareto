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

/**
 * `text` only ever holds the t.co short form, so a token carried in the link
 * can only be matched through the expanded URLs in `entities` — which means the
 * read has to ask for that field.
 */
test('reconciliation matches the event token inside the expanded link', async () => {
  const x = client(async (url, options) => {
    assert.match(String(url), /\/2\/users\/123\/tweets/);
    assert.match(String(url), /tweet\.fields=entities/);
    assert.match(options.headers.authorization, /^OAuth /);
    return Response.json({
      data: [
        {
          id: 'post-other',
          text: 'Unrelated https://t.co/aaa',
          entities: { urls: [{ expanded_url: 'https://site/?highlight=X&e=999999999999' }] },
        },
        {
          id: 'post-1',
          text: 'Update https://t.co/bbb',
          entities: { urls: [{ expanded_url: 'https://site/?highlight=X&e=abcdef123456' }] },
        },
      ],
    });
  });

  const found = await x.findPostByMarker({ token: 'abcdef123456' });
  assert.equal(found.id, 'post-1');
  assert.equal(await x.findPostByMarker({ token: 'not-there-at-all' }), null);
});

test('a post written before the token moved into the link still reconciles', async () => {
  const x = client(async () =>
    Response.json({ data: [{ id: 'post-old', text: 'Update [aa:abcdef]' }] }),
  );

  const found = await x.findPostByMarker({ token: 'abcdef123456', textMarker: '[aa:abcdef]' });
  assert.equal(found.id, 'post-old');
});

test('reconciliation refuses to run with nothing to match on', async () => {
  const x = client(async () => Response.json({ data: [] }));
  await assert.rejects(() => x.findPostByMarker({}), /token or a text marker/);
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
