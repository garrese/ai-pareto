import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { loadConfig } from './config.js';
import { ArtificialAnalysisClient } from './aa-client.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // The frontend may be served from a different origin during development.
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/**
 * Resolves a URL path inside `root`, refusing anything that escapes it.
 * Returns null when the request is not a readable file.
 */
async function resolveStaticFile(root, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  const candidate = resolve(root, relative === '' ? 'index.html' : relative);

  if (candidate !== root && !candidate.startsWith(root + sep)) return null;

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) return resolveStaticFile(root, join(urlPath, 'index.html'));
    return info.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

async function serveStatic(res, root, urlPath) {
  const file = await resolveStaticFile(root, urlPath);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
}

function start() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`\nConfiguration error\n\n${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const client = new ArtificialAnalysisClient(config);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/usage') {
      // Reads the snapshot stored from the last upstream call. Asking the API
      // how many requests are left would itself cost one.
      sendJson(res, 200, await client.getUsage());
      return;
    }

    if (url.pathname === '/api/models') {
      try {
        const result = await client.getModels({ force: url.searchParams.get('refresh') === '1' });
        sendJson(res, 200, {
          fetchedAt: result.fetchedAt,
          cache: result.cache,
          stale: result.stale,
          count: result.models.length,
          pages: result.pages ?? null,
          rateLimit: result.rateLimit ?? null,
          warning: result.error ?? null,
          models: result.models,
        });
      } catch (err) {
        // The message can echo the upstream body, which never contains the key.
        sendJson(res, 502, { error: err.message });
      }
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Unknown endpoint' });
      return;
    }

    await serveStatic(res, config.webRoot, url.pathname);
  });

  server.listen(config.port, () => {
    console.log(`artificial-analyzer api  →  http://localhost:${config.port}`);
    console.log(`serving frontend from    →  ${config.webRoot}`);
    console.log(`cache ttl                →  ${Math.round(config.cacheTtlMs / 60000)} min`);
  });
}

start();
