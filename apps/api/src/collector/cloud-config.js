import { randomUUID } from 'node:crypto';

const required = (environment, key) => {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const positiveInteger = (value, key, fallback) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
};

export function loadCloudCollectorConfig(environment = process.env) {
  const taskCount = positiveInteger(environment.CLOUD_RUN_TASK_COUNT, 'CLOUD_RUN_TASK_COUNT', 1);
  if (taskCount !== 1) {
    throw new Error('The collector must run as exactly one Cloud Run task');
  }

  const projectId =
    environment.GOOGLE_CLOUD_PROJECT?.trim() || required(environment, 'GCP_PROJECT_ID');

  return {
    projectId,
    bucketName: required(environment, 'PUBLIC_DATA_BUCKET'),
    topicName: environment.PARETO_TOPIC?.trim() || 'pareto-change-events',
    executionId: environment.CLOUD_RUN_EXECUTION?.trim() || `local-${randomUUID()}`,
    taskAttempt: Number(environment.CLOUD_RUN_TASK_ATTEMPT ?? 0),
    leaseSeconds: positiveInteger(environment.COLLECTOR_LEASE_SECONDS, 'COLLECTOR_LEASE_SECONDS', 900),
    api: {
      apiKey: required(environment, 'AA_API_KEY'),
      apiBase:
        environment.AA_API_BASE?.trim().replace(/\/+$/, '') ||
        'https://artificialanalysis.ai/api/v2',
      apiPath: environment.AA_API_PATH?.trim() || '/language/models/free',
      dailyLimit: positiveInteger(environment.AA_DAILY_LIMIT, 'AA_DAILY_LIMIT', 100),
      cacheDir: environment.AA_CACHE_DIR?.trim() || '/tmp/artificial-analyzer-cache',
      cacheTtlMs: 0,
    },
  };
}
