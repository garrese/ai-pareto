import { resolve } from 'node:path';

import { ArtificialAnalysisClient } from '../aa-client.js';
import { apiRoot, loadConfig } from '../config.js';
import { MONITORED_PARETO_FRONTS } from './definitions.js';
import { LocalSnapshotStore } from './local-store.js';
import { publishSnapshot } from './publication.js';
import { createSnapshotArtifacts } from './snapshots.js';

async function run() {
  const config = loadConfig();
  const client = new ArtificialAnalysisClient(config);
  const result = await client.getModels({ force: process.argv.includes('--refresh') });
  const generatedAt = new Date().toISOString();
  const artifacts = createSnapshotArtifacts({
    models: result.models,
    fetchedAt: result.fetchedAt,
    generatedAt,
    paretoDefinitions: MONITORED_PARETO_FRONTS,
  });
  const outputRoot = resolve(apiRoot, '.cache', 'generated');

  await publishSnapshot(artifacts, new LocalSnapshotStore(outputRoot));

  console.log(
    JSON.stringify({
      snapshotId: artifacts.snapshotId,
      modelCount: result.models.length,
      cache: result.cache,
      stale: result.stale,
      outputRoot,
    }),
  );
}

run().catch((error) => {
  console.error(`Collector failed: ${error.message}`);
  process.exitCode = 1;
});
