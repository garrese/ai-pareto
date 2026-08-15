import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const apiRoot = resolve(here, '..');
export const repoRoot = resolve(apiRoot, '..', '..');

const CONFIG_FILE = resolve(apiRoot, 'config.properties');

const DEFAULTS = {
  'aa.api.base': 'https://artificialanalysis.ai/api/v2',
  'aa.api.path': '/language/models/free',
  'aa.api.daily.limit': '100',
  'server.port': '8787',
  'cache.ttl.minutes': '360',
};

/**
 * Minimal `.properties` reader: `key=value` per line, `#` or `!` starts a
 * comment, whitespace around the key and value is trimmed. Values are taken
 * literally — no escape sequences, no interpolation.
 */
function parseProperties(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function readConfigFile() {
  try {
    return parseProperties(readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `Missing ${CONFIG_FILE}\n` +
          'Copy config.properties.example to config.properties and add your API key.',
      );
    }
    throw err;
  }
}

function toPositiveNumber(value, key) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid value for ${key} in config.properties: "${value}"`);
  }
  return n;
}

export function loadConfig(environment = process.env) {
  // `PORT` wins over the file: it is how every host and dev harness hands a
  // port over, and a second instance has to be able to take a different one.
  const props = { ...DEFAULTS, ...readConfigFile() };
  if (environment.PORT) props['server.port'] = environment.PORT;

  const apiKey = props['aa.api.key'];
  if (!apiKey) {
    throw new Error(
      'aa.api.key is empty in config.properties. Add your Artificial Analysis API key.',
    );
  }

  return {
    apiKey,
    apiBase: props['aa.api.base'].replace(/\/+$/, ''),
    apiPath: props['aa.api.path'],
    dailyLimit: toPositiveNumber(props['aa.api.daily.limit'], 'aa.api.daily.limit'),
    port: toPositiveNumber(props['server.port'], 'server.port'),
    cacheTtlMs: toPositiveNumber(props['cache.ttl.minutes'], 'cache.ttl.minutes') * 60_000,
    cacheDir: resolve(apiRoot, '.cache'),
    webRoot: resolve(repoRoot, 'apps', 'web'),
  };
}
