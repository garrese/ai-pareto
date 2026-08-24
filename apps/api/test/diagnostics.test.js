import assert from 'node:assert/strict';
import test from 'node:test';

import {
  duplicateModelDiagnostics,
  rejectedRefreshDocument,
  rejectedRefreshPath,
} from '../src/collector/diagnostics.js';

test('duplicate diagnostics preserve every normalized variant and its page position', () => {
  const models = [
    { id: 'model-a', intelligence: 10, price: 1 },
    { id: 'model-b', intelligence: 20, price: 2 },
    { id: 'model-a', intelligence: 11, price: 1 },
  ];
  const origins = [
    { page: 1, pageIndex: 0 },
    { page: 1, pageIndex: 1 },
    { page: 2, pageIndex: 0 },
  ];

  const duplicates = duplicateModelDiagnostics(models, origins);

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].id, 'model-a');
  assert.equal(duplicates[0].identical, false);
  assert.deepEqual(duplicates[0].differingFields, { intelligence: [10, 11] });
  assert.deepEqual(
    duplicates[0].occurrences.map(({ page, pageIndex, position }) => ({
      page,
      pageIndex,
      position,
    })),
    [
      { page: 1, pageIndex: 0, position: 0 },
      { page: 2, pageIndex: 0, position: 2 },
    ],
  );
});

test('identical duplicate variants are labelled without inventing differences', () => {
  const model = { id: 'model-a', intelligence: 10 };
  const [duplicate] = duplicateModelDiagnostics([model, { ...model }]);

  assert.equal(duplicate.identical, true);
  assert.deepEqual(duplicate.differingFields, {});
});

test('rejected refresh documents retain the full normalized walk and raw page envelopes', () => {
  const result = {
    fetchedAt: '2026-08-24T12:17:00.000Z',
    pages: 2,
    rateLimit: { limit: 100, remaining: 98 },
    models: [{ id: 'model-a' }, { id: 'model-a' }],
    sourcePages: [{ page: 1, payload: { data: [{ id: 'model-a', ignored: 'kept' }] } }],
  };
  const duplicates = duplicateModelDiagnostics(result.models);
  const document = rejectedRefreshDocument({
    executionId: 'collector-123',
    taskAttempt: 1,
    capturedAt: '2026-08-24T12:17:01.000Z',
    result,
    duplicates,
  });

  assert.equal(document.reason, 'duplicate-model-ids');
  assert.deepEqual(document.normalizedModels, result.models);
  assert.deepEqual(document.sourcePages, result.sourcePages);
  assert.deepEqual(document.duplicates, duplicates);
  assert.equal(
    rejectedRefreshPath({
      executionId: 'collector/123',
      taskAttempt: 1,
      fetchedAt: result.fetchedAt,
    }),
    'rejected-refreshes/2026-08-24/collector-123/attempt-1-2026-08-24T12-17-00.000Z.json',
  );
});
