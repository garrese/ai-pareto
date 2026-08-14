import assert from 'node:assert/strict';
import test from 'node:test';

import { oauth1Authorization } from '../src/oauth1.js';

test('OAuth 1.0a signing matches the RFC 5849 reference signature', () => {
  const authorization = oauth1Authorization({
    method: 'GET',
    url: 'http://photos.example.net/photos?file=vacation.jpg&size=original',
    consumerKey: 'dpf43f3p2l4k3l03',
    consumerSecret: 'kd94hf93k423kf44',
    accessToken: 'nnch734d00sl2jdk',
    accessTokenSecret: 'pfkkdhi9sl3r4s00',
    timestamp: 1191242096,
    nonce: 'kllo9940pd9333jh',
  });

  assert.match(authorization, /oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"/);
});

test('OAuth 1.0a can sign a request-token call without a user token', () => {
  const authorization = oauth1Authorization({
    method: 'POST',
    url: 'https://api.x.com/oauth/request_token',
    consumerKey: 'key',
    consumerSecret: 'secret',
    oauthParameters: { oauth_callback: 'http://127.0.0.1:8788/oauth/callback' },
    timestamp: 1_700_000_000,
    nonce: 'fixed',
  });

  assert.match(authorization, /oauth_callback="http%3A%2F%2F127\.0\.0\.1%3A8788%2Foauth%2Fcallback"/);
  assert.doesNotMatch(authorization, /oauth_token=/);
  assert.match(authorization, /oauth_signature=/);
});
