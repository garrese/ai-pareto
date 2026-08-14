import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  createAuthorizationRequest,
  exchangeAccessToken,
} from '../src/user-authorization.js';

const CALLBACK_URL = 'http://127.0.0.1:8788/oauth/callback';
const CONFIG_URL = new URL('../config.properties', import.meta.url);
const API_CONFIG_URL = new URL('../../api/config.properties', import.meta.url);
const CONFIG_PATH = fileURLToPath(CONFIG_URL);

function parseProperties(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

async function readOptional(url) {
  try {
    return await readFile(url, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function requireValue(properties, names) {
  for (const name of names) {
    if (properties[name]) return properties[name];
  }
  throw new Error(`Missing ${names.join(' or ')} in local config.properties`);
}

function upsertProperty(source, name, value) {
  const pattern = new RegExp(`^${name.replaceAll('.', '\\.')}=.*$`, 'm');
  if (pattern.test(source)) return source.replace(pattern, `${name}=${value}`);
  const separator = source && !source.endsWith('\n') ? '\n' : '';
  return `${source}${separator}${name}=${value}\n`;
}

function waitForCallback(requestToken) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out after 10 minutes'));
    }, 10 * 60 * 1000);

    const server = createServer((request, response) => {
      const url = new URL(request.url, CALLBACK_URL);
      if (url.pathname !== '/oauth/callback') {
        response.writeHead(404).end('Not found');
        return;
      }

      const callbackToken = url.searchParams.get('oauth_token');
      const verifier = url.searchParams.get('oauth_verifier');
      const denied = url.searchParams.get('denied');
      if (denied) {
        clearTimeout(timeout);
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Authorization was denied. You can close this tab.');
        server.close(() => reject(new Error('The X account denied authorization')));
        return;
      }
      if (callbackToken !== requestToken || !verifier) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Invalid OAuth callback.');
        return;
      }

      clearTimeout(timeout);
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('AI Pareto Radar authorization completed. You can close this tab.');
      server.close(() => resolve(verifier));
    });

    server.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.listen(8788, '127.0.0.1');
  });
}

async function main() {
  const publisherSource = await readOptional(CONFIG_URL);
  const apiSource = await readOptional(API_CONFIG_URL);
  const properties = { ...parseProperties(apiSource), ...parseProperties(publisherSource) };
  const consumerKey = requireValue(properties, ['x.api.key']);
  const consumerSecret = requireValue(properties, ['x.api.secret', 'x.api.key.secret']);

  const request = await createAuthorizationRequest({
    consumerKey,
    consumerSecret,
    callbackUrl: CALLBACK_URL,
  });
  const callback = waitForCallback(request.requestToken);

  console.log('\nOpen this URL in a browser and sign in as the bot account:\n');
  console.log(request.authorizationUrl);
  console.log('\nWaiting for X to redirect back to this computer...\n');

  const verifier = await callback;
  const credentials = await exchangeAccessToken({
    consumerKey,
    consumerSecret,
    requestToken: request.requestToken,
    requestTokenSecret: request.requestTokenSecret,
    verifier,
  });

  let nextSource = publisherSource || '# Local X credentials. This file is ignored by Git.\n';
  nextSource = upsertProperty(nextSource, 'x.api.key', consumerKey);
  nextSource = upsertProperty(nextSource, 'x.api.secret', consumerSecret);
  nextSource = upsertProperty(nextSource, 'x.access.token', credentials.accessToken);
  nextSource = upsertProperty(nextSource, 'x.access.token.secret', credentials.accessTokenSecret);
  nextSource = upsertProperty(nextSource, 'x.user.id', credentials.userId);
  await writeFile(CONFIG_URL, nextSource, { encoding: 'utf8', mode: 0o600 });

  console.log(`Authorized @${credentials.username} (user ID ${credentials.userId}).`);
  console.log(`Credentials were saved locally to ${CONFIG_PATH}; token values were not printed.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
