import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PAGES_NEEDED, refreshBudget } from '../src/quota.js';

const now = new Date('2026-08-24T11:00:00.000Z');
const headers = (overrides = {}) => ({
  limit: 100,
  remaining: 36,
  resetsAt: '2026-08-24T12:18:40.000Z',
  source: 'headers',
  ...overrides,
});

test('a refresh that fits in the remaining window is allowed', () => {
  const budget = refreshBudget({ rateLimit: headers(), pagesNeeded: 4, now });

  assert.equal(budget.allowed, true);
  assert.equal(budget.remaining, 36);
});

test('a refresh that cannot finish is refused before it spends anything', () => {
  const budget = refreshBudget({ rateLimit: headers({ remaining: 3 }), pagesNeeded: 4, now });

  assert.equal(budget.allowed, false);
  assert.equal(budget.remaining, 3);
  assert.equal(budget.pagesNeeded, 4);
  assert.equal(budget.resetsAt, '2026-08-24T12:18:40.000Z');
  // The reason is logged and shown to the user, so it has to read as an answer.
  assert.match(budget.reason, /needs 4 requests and only 3 of 100 are left/);
});

test('exactly enough is enough', () => {
  assert.equal(refreshBudget({ rateLimit: headers({ remaining: 4 }), pagesNeeded: 4, now }).allowed, true);
  assert.equal(refreshBudget({ rateLimit: headers({ remaining: 3 }), pagesNeeded: 3, now }).allowed, true);
});

test('a reading from a window that has already reset does not block anything', () => {
  const budget = refreshBudget({
    rateLimit: headers({ remaining: 0, resetsAt: '2026-08-24T10:00:00.000Z' }),
    pagesNeeded: 4,
    now,
  });

  assert.equal(budget.allowed, true);
  assert.match(budget.reason, /since reset/);
});

test('the window boundary counts as reset rather than still running', () => {
  const budget = refreshBudget({
    rateLimit: headers({ remaining: 0, resetsAt: now.toISOString() }),
    pagesNeeded: 4,
    now,
  });

  assert.equal(budget.allowed, true);
});

test('missing information is never treated as a reason to refuse', () => {
  // A first run, before anything has been observed.
  assert.equal(refreshBudget({ rateLimit: null, pagesNeeded: 4, now }).allowed, true);
  // The endpoint sent no rate-limit headers, so the count is a label.
  assert.equal(
    refreshBudget({
      rateLimit: { limit: 100, remaining: null, resetsAt: null, source: 'config' },
      pagesNeeded: 4,
      now,
    }).allowed,
    true,
  );
});

test('a growing dataset raises the bar, which is why the page count is passed in', () => {
  // Four pages today, five once the list passes 800 models. A guard hard-wired
  // to four would wave through a refresh that cannot finish.
  const rateLimit = headers({ remaining: 4 });

  assert.equal(refreshBudget({ rateLimit, pagesNeeded: 4, now }).allowed, true);
  assert.equal(refreshBudget({ rateLimit, pagesNeeded: 5, now }).allowed, false);
  assert.equal(DEFAULT_PAGES_NEEDED, 4);
});
