import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './config.js';
import { ArtificialAnalysisClient } from './aa-client.js';
import { DEFAULT_PAGES_NEEDED, refreshBudget } from './quota.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function sendJson(res, status, body, { cors = true } = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // The frontend may be served from a different origin during development.
    // Deliberately not sent on the refresh route: that one is same-origin only.
    ...(cors ? { 'access-control-allow-origin': '*' } : {}),
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

function isLoopback(req) {
  return LOOPBACK_ADDRESSES.has(req.socket?.remoteAddress ?? '');
}

function matchesToken(candidate, expected) {
  const given = Buffer.from(String(candidate ?? ''));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * The refresh route must be reachable only from the page this server itself
 * serves. A browser sends `Sec-Fetch-Site` on every request and a cross-site
 * page cannot forge it; `Origin` is the fallback for anything older. A page
 * opened over `file://` reports a null origin, which is indistinguishable from
 * a sandboxed attacker frame, so it is refused too — the frontend hides the
 * button in that mode for the same reason.
 */
function isSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined) return site === 'same-origin';

  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host;
  return origin === `http://${host}` || origin === `https://${host}`;
}

function modelsPayload(result) {
  return {
    fetchedAt: result.fetchedAt,
    cache: result.cache,
    stale: result.stale,
    count: result.models.length,
    pages: result.pages ?? null,
    rateLimit: result.rateLimit ?? null,
    warning: result.error ?? null,
    models: result.models,
  };
}

/**
 * Builds the request handler. Taken as arguments rather than read from the
 * environment so the route gates are testable without a config file, a
 * listening socket, or an upstream call.
 */
export function createRequestHandler({ config, client, refreshToken }) {
  // One refresh at a time: a double click would otherwise spend two full walks
  // of the paginated endpoint, which is eight of the hundred daily requests.
  let inFlightRefresh = null;

  /**
   * Refuses a refresh that the remaining quota cannot complete. Both files it
   * reads are written by the last real upstream call, so this costs nothing.
   */
  async function budgetForRefresh() {
    const [usage, cached] = await Promise.all([
      client.getUsage().catch(() => null),
      client.getCachedModels().catch(() => null),
    ]);
    return refreshBudget({
      rateLimit: usage,
      pagesNeeded: cached?.pages ?? DEFAULT_PAGES_NEEDED,
      now: new Date(),
    });
  }

  async function refreshOnce() {
    inFlightRefresh ??= client.getModels({ force: true }).finally(() => {
      inFlightRefresh = null;
    });
    return inFlightRefresh;
  }

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'OPTIONS') {
      // POST and the refresh header are deliberately absent: a cross-origin
      // attempt at the refresh route needs a preflight, and this fails it.
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }

    if (url.pathname === '/api/refresh') {
      // Unknown rather than forbidden when the capability is off: a route that
      // announces itself invites the next attempt.
      if (!config.manualRefreshEnabled || !isLoopback(req)) {
        sendJson(res, 404, { error: 'Unknown endpoint' }, { cors: false });
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Refresh requires POST' }, { cors: false });
        return;
      }
      if (!isSameOrigin(req)) {
        sendJson(
          res,
          403,
          { error: 'Refresh is only available from the page this server serves' },
          { cors: false },
        );
        return;
      }
      if (!matchesToken(req.headers['x-refresh-token'], refreshToken)) {
        sendJson(
          res,
          403,
          { error: 'Wrong or missing refresh token. It is printed in the server console.' },
          { cors: false },
        );
        return;
      }

      const budget = await budgetForRefresh();
      if (!budget.allowed) {
        sendJson(res, 429, { error: `Refresh refused: ${budget.reason}.` }, { cors: false });
        return;
      }

      try {
        sendJson(res, 200, modelsPayload(await refreshOnce()), { cors: false });
      } catch (err) {
        // The message can echo the upstream body, which never contains the key.
        sendJson(res, 502, { error: err.message }, { cors: false });
      }
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (url.pathname === '/api/health') {
      // The page asks here whether to offer its refresh button at all, so that
      // a server started without the capability does not show one that 404s.
      // Only ever admitted to a loopback client.
      sendJson(res, 200, {
        ok: true,
        manualRefresh: config.manualRefreshEnabled && isLoopback(req),
      });
      return;
    }

    if (url.pathname === '/api/usage') {
      // Reads the snapshot stored from the last upstream call. Asking the API
      // how many requests are left would itself cost one.
      sendJson(res, 200, await client.getUsage());
      return;
    }

    if (url.pathname === '/api/models') {
      // Never fetches. Serving the page must cost nothing, however old the
      // cache is; `POST /api/refresh` is the only route that spends quota.
      try {
        sendJson(res, 200, modelsPayload(await client.getCachedModels()));
      } catch (err) {
        sendJson(res, 503, { error: err.message });
      }
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Unknown endpoint' });
      return;
    }

    await serveStatic(res, config.webRoot, url.pathname);
  };
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
  // New every run, and never served over HTTP: reading the page, the scripts or
  // the DOM cannot get you a refresh — only the console this printed to.
  const refreshToken = randomBytes(24).toString('base64url');

  const server = createServer(createRequestHandler({ config, client, refreshToken }));

  server.listen(config.port, () => {
    console.log(`artificial-analyzer api  →  http://localhost:${config.port}`);
    console.log(`serving frontend from    →  ${config.webRoot}`);
    console.log(`cache ttl                →  ${Math.round(config.cacheTtlMs / 60000)} min`);
    console.log('upstream fetches         →  manual only, this server never refreshes on its own');
    if (config.manualRefreshEnabled) {
      console.log(`refresh token            →  ${refreshToken}`);
      console.log('                             paste it into the page once, per run');
    } else {
      console.log('manual refresh           →  off (set refresh.manual.enabled=true to allow it)');
    }
  });
}

// Only wire up a real server when run as the entry point, so importing this
// module for tests does not open a socket.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
