import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCloudCollectorConfig } from '../src/collector/cloud-config.js';

const environment = {
  GCP_PROJECT_ID: 'project-id',
  PUBLIC_DATA_BUCKET: 'public-data-bucket',
  AA_API_KEY: 'test-key',
  CLOUD_RUN_EXECUTION: 'execution-1',
  CLOUD_RUN_TASK_COUNT: '1',
};

test('cloud collector config applies safe production defaults', () => {
  const config = loadCloudCollectorConfig(environment);
  assert.equal(config.projectId, 'project-id');
  assert.equal(config.topicName, 'pareto-change-events');
  assert.equal(config.executionId, 'execution-1');
  assert.equal(config.leaseSeconds, 900);
  assert.equal(config.api.apiPath, '/language/models/free');
  assert.equal(config.api.cacheDir, '/tmp/artificial-analyzer-cache');
});

test('cloud collector config requires one task and all external resource names', () => {
  assert.throws(
    () => loadCloudCollectorConfig({ ...environment, CLOUD_RUN_TASK_COUNT: '2' }),
    /exactly one/,
  );
  assert.throws(
    () => loadCloudCollectorConfig({ ...environment, PUBLIC_DATA_BUCKET: '' }),
    /PUBLIC_DATA_BUCKET/,
  );
});
