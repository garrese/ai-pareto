/**
 * The page is normally served by the local API server, so a relative path is
 * enough. `?api=http://host:port` overrides it when the frontend is hosted
 * somewhere else.
 */
function apiBase() {
  const override = new URLSearchParams(location.search).get('api');
  if (override) return override.replace(/\/+$/, '');
  return location.protocol === 'file:' ? 'http://localhost:8787' : '';
}

export const fetchModels = ({ refresh = false } = {}) =>
  request(`/api/models${refresh ? '?refresh=1' : ''}`);

export const fetchUsage = () => request('/api/usage');

async function request(path) {
  const url = `${apiBase()}${path}`;

  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(
      `Cannot reach the local API at ${apiBase() || location.origin}. ` +
        'Start it with `npm start` in apps/api.',
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `API returned ${response.status}`);
  }
  return payload;
}
