import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';

const environment = {
  GOOGLE_CLOUD_PROJECT: 'project-id',
  X_USER_ID: '123',
  X_API_KEY: 'key',
  X_API_SECRET: 'secret',
  X_ACCESS_TOKEN: 'token',
  X_ACCESS_TOKEN_SECRET: 'token-secret',
};

test('publisher configuration applies safe service defaults', () => {
  const config = loadConfig(environment);
  assert.equal(config.port, 8080);
  assert.equal(config.leaseSeconds, 300);
  assert.equal(config.x.userId, '123');
});

test('publisher configuration requires every X user credential', () => {
  assert.throws(() => loadConfig({ ...environment, X_API_SECRET: '' }), /X_API_SECRET/);
});
