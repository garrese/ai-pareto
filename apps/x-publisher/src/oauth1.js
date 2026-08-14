import { createHmac, randomBytes } from 'node:crypto';

const encode = (value) =>
  encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export function oauth1Authorization({
  method,
  url,
  consumerKey,
  consumerSecret,
  accessToken,
  accessTokenSecret,
  timestamp = Math.floor(Date.now() / 1000),
  nonce = randomBytes(16).toString('hex'),
}) {
  const target = new URL(url);
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };
  const parameters = [...target.searchParams.entries(), ...Object.entries(oauth)]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const baseUrl = `${target.protocol}//${target.host}${target.pathname}`;
  const signatureBase = [method.toUpperCase(), encode(baseUrl), encode(parameters)].join('&');
  const signingKey = `${encode(consumerSecret)}&${encode(accessTokenSecret)}`;
  const oauthSignature = createHmac('sha1', signingKey).update(signatureBase).digest('base64');

  return `OAuth ${Object.entries({ ...oauth, oauth_signature: oauthSignature })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`)
    .join(', ')}`;
}
