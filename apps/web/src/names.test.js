import assert from 'node:assert/strict';
import test from 'node:test';

import { chartLabel, isShortened, withShortNames } from './names.js';

const model = (id, name, intelligence = null) => ({ id, name, intelligence });
const labels = (models) =>
  Object.fromEntries(withShortNames(models).map((m) => [m.id, m.shortName]));

test('a lone variant loses its parenthesis outright', () => {
  const shortened = withShortNames([
    model('fable', 'Claude Fable 5 (Adaptive Reasoning, Max Effort, Opus 4.8 Fallback)', 62.1),
  ]);
  assert.equal(shortened[0].shortName, 'Claude Fable 5');
  // The real name is never replaced — the card still shows the configuration.
  assert.equal(shortened[0].name, 'Claude Fable 5 (Adaptive Reasoning, Max Effort, Opus 4.8 Fallback)');
});

test('a model with no parenthesis is left alone', () => {
  assert.deepEqual(labels([model('mimo', 'MiMo-V2.5-Pro', 40)]), { mimo: 'MiMo-V2.5-Pro' });
});

test('a family is lettered by ascending intelligence', () => {
  assert.deepEqual(
    labels([
      model('high', 'Claude Opus 5 (Adaptive Reasoning, High Effort)', 61.5),
      model('low', 'Claude Opus 5 (Adaptive Reasoning, Low Effort)', 52.5),
      model('max', 'Claude Opus 5 (Adaptive Reasoning, Max Effort)', 63.1),
    ]),
    {
      low: 'Claude Opus 5 (a)',
      high: 'Claude Opus 5 (b)',
      max: 'Claude Opus 5 (c)',
    },
  );
});

test('short and long suffixes in one family are lettered alike', () => {
  // `GPT-5.6 Terra` really does mix `(low)` with `(Non-reasoning)`. Salvaging
  // the short one would make the shorthand mean two things at once.
  assert.deepEqual(
    labels([
      model('low', 'GPT-5.6 Terra (low)', 41.3),
      model('none', 'GPT-5.6 Terra (Non-reasoning)', 34.6),
      model('max', 'GPT-5.6 Terra (max)', 56.6),
    ]),
    {
      none: 'GPT-5.6 Terra (a)',
      low: 'GPT-5.6 Terra (b)',
      max: 'GPT-5.6 Terra (c)',
    },
  );
});

test('a family member with no parenthesis is lettered with the rest', () => {
  // Leaving it bare would put `Base` next to `Base (a)`, which reads as if the
  // bare one were the canonical model rather than one more variant.
  assert.deepEqual(
    labels([model('bare', 'Solar Pro 2', 30), model('pro', 'Solar Pro 2 (Reasoning)', 40)]),
    { bare: 'Solar Pro 2 (a)', pro: 'Solar Pro 2 (b)' },
  );
});

test('unmeasured models take the last letters, not the first', () => {
  assert.deepEqual(
    labels([
      model('unknown', 'Claude Sonnet 5 (Adaptive Reasoning, High Effort)'),
      model('measured', 'Claude Sonnet 5 (Non-reasoning, High Effort)', 42.6),
    ]),
    {
      measured: 'Claude Sonnet 5 (a)',
      unknown: 'Claude Sonnet 5 (b)',
    },
  );
});

test('two unmeasured models are ordered by name, so a reload cannot move them', () => {
  const models = [
    model('second', 'Nova 2.0 Lite (Reasoning)'),
    model('first', 'Nova 2.0 Lite (Non-reasoning)'),
  ];
  assert.deepEqual(labels(models), {
    first: 'Nova 2.0 Lite (a)',
    second: 'Nova 2.0 Lite (b)',
  });
  assert.deepEqual(labels([...models].reverse()), labels(models));
});

test('letters carry on past the alphabet rather than repeating', () => {
  const family = Array.from({ length: 28 }, (_, index) =>
    model(`m${index}`, `Wide Family (variant ${index})`, index),
  );
  const assigned = labels(family);
  assert.equal(assigned.m0, 'Wide Family (a)');
  assert.equal(assigned.m25, 'Wide Family (z)');
  assert.equal(assigned.m26, 'Wide Family (aa)');
  assert.equal(assigned.m27, 'Wide Family (ab)');
  assert.equal(new Set(Object.values(assigned)).size, family.length);
});

test('short names never collide across families', () => {
  const assigned = labels([
    model('a', 'Gemini 2.5 Flash (Reasoning)', 30),
    model('b', 'Gemini 2.5 Flash (Non-reasoning)', 20),
    model('c', 'Gemini 2.5 Flash-Lite (Reasoning)', 25),
    model('d', 'Gemini 2.5 Flash-Lite (Non-reasoning)', 15),
  ]);
  assert.equal(new Set(Object.values(assigned)).size, 4);
});

test('isShortened reports only the models whose label hides something', () => {
  const [flat, lettered] = withShortNames([
    model('flat', 'MiMo-V2.5-Pro', 40),
    model('lettered', 'GLM-4.5V (Reasoning)', 30),
    model('sibling', 'GLM-4.5V (Non-reasoning)', 20),
  ]);
  assert.equal(isShortened(flat), false);
  assert.equal(isShortened(lettered), true);
  assert.equal(chartLabel(lettered), 'GLM-4.5V (b)');
});

test('the bare letter is kept alongside the label the table cannot fit', () => {
  const [lone, low, high] = withShortNames([
    model('lone', 'MiniMax M3 (Reasoning)', 44),
    model('low', 'Claude Opus 5 (Adaptive Reasoning, Low Effort)', 52.5),
    model('high', 'Claude Opus 5 (Adaptive Reasoning, High Effort)', 61.5),
  ]);
  // Alone in its family there is no letter to decode: the plot writes the whole
  // family name, so the column has nothing to point at.
  assert.equal(lone.shortLetter, null);
  assert.equal(low.shortLetter, 'a');
  assert.equal(high.shortLetter, 'b');
  assert.equal(high.shortName, `Claude Opus 5 (${high.shortLetter})`);
});

test('chartLabel falls back to the real name when nothing was computed', () => {
  assert.equal(chartLabel({ name: 'Undecorated' }), 'Undecorated');
});
