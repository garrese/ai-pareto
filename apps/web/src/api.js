const SNAPSHOT_SCHEMA_VERSION = 1;

function currentLocation() {
  return globalThis.location ?? {
    protocol: 'http:',
    hostname: 'localhost',
    origin: 'http://localhost',
    search: '',
  };
}

function runtimeConfig() {
  return globalThis.ARTIFICIAL_ANALYZER_CONFIG ?? {};
}

function withoutTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function isLocal(locationLike) {
  return (
    locationLike.protocol === 'file:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(locationLike.hostname)
  );
}

function absoluteHttpUrl(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${field} must use HTTP or HTTPS`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} must not contain credentials, a query, or a fragment`);
  }
  return withoutTrailingSlash(url.href);
}

/**
 * Local development keeps using apps/api. A production page uses the public
 * snapshot root from config.js. Query parameters are explicit diagnostics and
 * make either mode testable without rebuilding the site.
 */
export function resolveDataSource(
  locationLike = currentLocation(),
  config = runtimeConfig(),
) {
  const parameters = new URLSearchParams(locationLike.search ?? '');
  const apiOverride = parameters.get('api');
  const dataOverride = parameters.get('data');

  if (apiOverride && dataOverride) {
    throw new Error('Use either the api or data query parameter, not both');
  }
  if (dataOverride) {
    return { mode: 'snapshot', root: absoluteHttpUrl(dataOverride, 'data') };
  }
  if (apiOverride) {
    return { mode: 'api', root: absoluteHttpUrl(apiOverride, 'api') };
  }
  if (!isLocal(locationLike) && config.dataRoot) {
    return { mode: 'snapshot', root: absoluteHttpUrl(config.dataRoot, 'dataRoot') };
  }

  return {
    mode: 'api',
    root: locationLike.protocol === 'file:' ? 'http://localhost:8787' : '',
  };
}

export function dataSourceMode() {
  return resolveDataSource().mode;
}

export async function fetchModels({ refresh = false } = {}) {
  const source = resolveDataSource();
  if (source.mode === 'snapshot') return fetchSnapshot(source.root);
  return requestJson(`${source.root}/api/models${refresh ? '?refresh=1' : ''}`, {
    context: source.root || currentLocation().origin,
  });
}

export async function fetchUsage() {
  const source = resolveDataSource();
  if (source.mode === 'snapshot') {
    throw new Error('Upstream quota is private operational data in the hosted site');
  }
  return requestJson(`${source.root}/api/usage`, {
    context: source.root || currentLocation().origin,
  });
}

async function fetchSnapshot(root) {
  const manifest = await requestJson(`${root}/public/latest.json`, {
    cache: 'no-store',
    context: root,
  });
  validateManifest(manifest);

  const document = await requestJson(`${root}/${manifest.modelsPath}`, { context: root });
  validateModelsDocument(document, manifest);

  return {
    snapshotId: manifest.snapshotId,
    fetchedAt: manifest.fetchedAt,
    publishedAt: manifest.publishedAt,
    cache: 'snapshot',
    stale: false,
    warning: null,
    count: document.models.length,
    models: document.models,
  };
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error('The public data manifest uses an unsupported schema version');
  }
  if (!/^snapshot-[0-9a-f]{24}$/.test(manifest.snapshotId ?? '')) {
    throw new Error('The public data manifest has an invalid snapshot ID');
  }
  if (!Number.isFinite(Date.parse(manifest.fetchedAt))) {
    throw new Error('The public data manifest has an invalid fetch time');
  }
  if (!Number.isFinite(Date.parse(manifest.publishedAt))) {
    throw new Error('The public data manifest has an invalid publication time');
  }
  if (!Number.isInteger(manifest.modelCount) || manifest.modelCount < 0) {
    throw new Error('The public data manifest has an invalid model count');
  }

  const expectedPrefix = `public/snapshots/${manifest.snapshotId}/`;
  if (manifest.modelsPath !== `${expectedPrefix}models.json`) {
    throw new Error('The public data manifest points to an unexpected model snapshot');
  }
  if (manifest.paretoPath !== `${expectedPrefix}pareto.json`) {
    throw new Error('The public data manifest points to an unexpected Pareto snapshot');
  }
}

function validateModelsDocument(document, manifest) {
  if (
    document?.schemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
    document.snapshotId !== manifest.snapshotId ||
    document.fetchedAt !== manifest.fetchedAt
  ) {
    throw new Error('The model document does not match the public data manifest');
  }
  if (
    !Array.isArray(document.models) ||
    document.modelCount !== manifest.modelCount ||
    document.models.length !== manifest.modelCount
  ) {
    throw new Error('The model document has an unexpected model count');
  }
}

async function requestJson(url, { cache, context } = {}) {
  let response;
  try {
    response = await fetch(url, cache ? { cache } : undefined);
  } catch {
    throw new Error(`Cannot reach data at ${context ?? url}`);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `Data request returned ${response.status}`);
  }
  if (payload === null || typeof payload !== 'object') {
    throw new Error('Data request returned invalid JSON');
  }
  return payload;
}
