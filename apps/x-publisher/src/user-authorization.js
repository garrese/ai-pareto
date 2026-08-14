import { oauth1Authorization } from './oauth1.js';

const REQUEST_TOKEN_URL = 'https://api.x.com/oauth/request_token';
const ACCESS_TOKEN_URL = 'https://api.x.com/oauth/access_token';
const AUTHORIZE_URL = 'https://api.x.com/oauth/authorize';

async function parseTokenResponse(response, label) {
  const body = await response.text();
  const values = new URLSearchParams(body);
  if (!response.ok) {
    const detail = values.get('error') || body || `HTTP ${response.status}`;
    throw new Error(`${label} failed: ${String(detail).slice(0, 200)}`);
  }
  return values;
}

const required = (values, name, label) => {
  const value = values.get(name);
  if (!value) throw new Error(`${label} response did not contain ${name}`);
  return value;
};

export async function createAuthorizationRequest({
  consumerKey,
  consumerSecret,
  callbackUrl,
  fetchImpl = fetch,
  timestamp,
  nonce,
}) {
  const authorization = oauth1Authorization({
    method: 'POST',
    url: REQUEST_TOKEN_URL,
    consumerKey,
    consumerSecret,
    oauthParameters: { oauth_callback: callbackUrl },
    timestamp,
    nonce,
  });
  const response = await fetchImpl(REQUEST_TOKEN_URL, {
    method: 'POST',
    headers: { authorization },
  });
  const values = await parseTokenResponse(response, 'X request-token exchange');
  if (values.get('oauth_callback_confirmed') !== 'true') {
    throw new Error('X did not confirm the OAuth callback URL');
  }

  const requestToken = required(values, 'oauth_token', 'X request-token exchange');
  const requestTokenSecret = required(values, 'oauth_token_secret', 'X request-token exchange');
  const authorizationUrl = new URL(AUTHORIZE_URL);
  authorizationUrl.searchParams.set('oauth_token', requestToken);

  return { requestToken, requestTokenSecret, authorizationUrl: authorizationUrl.href };
}

export async function exchangeAccessToken({
  consumerKey,
  consumerSecret,
  requestToken,
  requestTokenSecret,
  verifier,
  fetchImpl = fetch,
  timestamp,
  nonce,
}) {
  const authorization = oauth1Authorization({
    method: 'POST',
    url: ACCESS_TOKEN_URL,
    consumerKey,
    consumerSecret,
    accessToken: requestToken,
    accessTokenSecret: requestTokenSecret,
    oauthParameters: { oauth_verifier: verifier },
    timestamp,
    nonce,
  });
  const response = await fetchImpl(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { authorization },
  });
  const values = await parseTokenResponse(response, 'X access-token exchange');

  return {
    accessToken: required(values, 'oauth_token', 'X access-token exchange'),
    accessTokenSecret: required(values, 'oauth_token_secret', 'X access-token exchange'),
    userId: required(values, 'user_id', 'X access-token exchange'),
    username: required(values, 'screen_name', 'X access-token exchange'),
  };
}
