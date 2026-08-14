import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalJson, sha256 } from '../src/collector/canonical.js';

test('canonicalJson sorts object keys recursively without reordering arrays', () => {
  const left = { z: 1, nested: { b: 2, a: 1 }, values: ['b', 'a'] };
  const right = { values: ['b', 'a'], nested: { a: 1, b: 2 }, z: 1 };

  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(sha256(left), sha256(right));
  assert.notEqual(sha256(left), sha256({ ...right, values: ['a', 'b'] }));
});
