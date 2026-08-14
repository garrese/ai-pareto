import { Firestore } from '@google-cloud/firestore';
import { PubSub } from '@google-cloud/pubsub';
import { GoogleAuth } from 'google-auth-library';

import { ArtificialAnalysisClient } from '../aa-client.js';
import { loadCloudCollectorConfig } from './cloud-config.js';
import { CloudStorageJsonStore } from './cloud-storage.js';
import { FirestoreCollectorState } from './firestore-state.js';
import { PubSubEventBus } from './pubsub-bus.js';
import { runCollector } from './run.js';
import { structuredLog } from './structured-log.js';

async function main() {
  const config = loadCloudCollectorConfig();
  const auth = new GoogleAuth({
    projectId: config.projectId,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const firestore = new Firestore({ projectId: config.projectId });
  const pubsub = new PubSub({ projectId: config.projectId });

  structuredLog('INFO', 'Collector execution started', {
    executionId: config.executionId,
    taskAttempt: config.taskAttempt,
  });

  const result = await runCollector({
    executionId: config.executionId,
    leaseSeconds: config.leaseSeconds,
    source: new ArtificialAnalysisClient(config.api),
    storage: new CloudStorageJsonStore({ bucketName: config.bucketName, auth }),
    state: new FirestoreCollectorState(firestore),
    eventBus: new PubSubEventBus(pubsub, config.topicName),
    log: structuredLog,
  });

  structuredLog('INFO', 'Collector execution finished', {
    executionId: config.executionId,
    ...result,
  });
}

main().catch((error) => {
  structuredLog('ERROR', 'Collector execution failed', {
    errorName: error.name,
    errorMessage: error.message,
  });
  process.exitCode = 1;
});
