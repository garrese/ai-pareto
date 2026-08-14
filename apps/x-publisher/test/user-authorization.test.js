import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAuthorizationRequest,
  exchangeAccessToken,
} from '../src/user-authorization.js';

test('creates a three-legged OAuth authorization request', async () => {
  let captured;
  const result = await createAuthorizationRequest({
    consumerKey: 'key',
    consumerSecret: 'secret',
    callbackUrl: 'http://127.0.0.1:8788/oauth/callback',
    timestamp: 1_700_000_000,
    nonce: 'fixed',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(
        'oauth_token=request-token&oauth_token_secret=request-secret&oauth_callback_confirmed=true',
      );
    },
  });

  assert.equal(captured.url, 'https://api.x.com/oauth/request_token');
  assert.equal(captured.options.method, 'POST');
  assert.match(captured.options.headers.authorization, /oauth_callback=/);
  assert.equal(result.requestTokenSecret, 'request-secret');
  assert.equal(
    result.authorizationUrl,
    'https://api.x.com/oauth/authorize?oauth_token=request-token',
  );
});

test('exchanges the verifier for bot user credentials', async () => {
  let authorization;
  const result = await exchangeAccessToken({
    consumerKey: 'key',
    consumerSecret: 'secret',
    requestToken: 'request-token',
    requestTokenSecret: 'request-secret',
    verifier: 'verifier',
    timestamp: 1_700_000_000,
    nonce: 'fixed',
    fetchImpl: async (_url, options) => {
      authorization = options.headers.authorization;
      return new Response(
        'oauth_token=user-token&oauth_token_secret=user-secret&user_id=123&screen_name=AIParetoRadar',
      );
    },
  });

  assert.match(authorization, /oauth_token="request-token"/);
  assert.match(authorization, /oauth_verifier="verifier"/);
  assert.deepEqual(result, {
    accessToken: 'user-token',
    accessTokenSecret: 'user-secret',
    userId: '123',
    username: 'AIParetoRadar',
  });
});
