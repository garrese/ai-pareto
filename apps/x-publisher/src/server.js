import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { Firestore } from '@google-cloud/firestore';

import { loadConfig } from './config.js';
import { FirestoreDeliveryStore } from './delivery-store.js';
import { createPushHandler } from './handler.js';
import { structuredLog } from './structured-log.js';
import { XClient } from './x-client.js';

const MAX_BODY_BYTES = 64 * 1024;

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('Request body exceeds 64 KiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(response, statusCode, body = null) {
  if (body === null) {
    response.writeHead(statusCode);
    response.end();
    return;
  }
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function start() {
  const config = loadConfig();
  const firestore = new Firestore({ projectId: config.projectId });
  const handlePush = createPushHandler({
    deliveryStore: new FirestoreDeliveryStore(firestore),
    xClient: new XClient(config.x),
    leaseSeconds: config.leaseSeconds,
    publicSiteUrl: config.publicSiteUrl,
    log: structuredLog,
  });

  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, { ok: true });
      return;
    }
    if (request.method !== 'POST' || url.pathname !== '/pubsub/x') {
      send(response, 404, { error: 'Not found' });
      return;
    }

    let envelope;
    try {
      envelope = await readJson(request);
    } catch (error) {
      structuredLog('WARNING', 'Pub/Sub request body is invalid', {
        requestId,
        errorMessage: error.message,
      });
      send(response, 400);
      return;
    }

    try {
      const result = await handlePush(envelope, requestId);
      send(response, result.statusCode);
    } catch (error) {
      structuredLog('ERROR', 'Pub/Sub delivery handler failed', {
        requestId,
        errorName: error.name,
        errorMessage: error.message,
      });
      send(response, 500);
    }
  });

  server.listen(config.port, () => {
    structuredLog('INFO', 'X publisher listening', { port: config.port });
  });
}

try {
  start();
} catch (error) {
  structuredLog('ERROR', 'X publisher failed to start', {
    errorName: error.name,
    errorMessage: error.message,
  });
  process.exitCode = 1;
}
