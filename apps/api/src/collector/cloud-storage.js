import { randomUUID } from 'node:crypto';

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MANIFEST_CACHE_CONTROL = 'public, max-age=60, must-revalidate';

const serialize = (body) => `${JSON.stringify(body, null, 2)}\n`;

function multipartBody(metadata, payload, boundary) {
  return [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    '\r\n',
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    payload,
    '\r\n',
    `--${boundary}--\r\n`,
  ].join('');
}

export class CloudStorageJsonStore {
  constructor({ bucketName, auth, fetchImpl = fetch }) {
    if (!bucketName) throw new Error('Cloud Storage bucketName is required');
    this.bucketName = bucketName;
    this.auth = auth;
    this.fetchImpl = fetchImpl;
    this.authClient = null;
  }

  async #authorizedHeaders(url) {
    this.authClient ??= await this.auth.getClient();
    const source = await this.authClient.getRequestHeaders(url);
    return new Headers(source);
  }

  #uploadUrl(ifGenerationMatch) {
    const url = new URL(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucketName)}/o`,
    );
    url.searchParams.set('uploadType', 'multipart');
    if (ifGenerationMatch !== undefined) {
      url.searchParams.set('ifGenerationMatch', String(ifGenerationMatch));
    }
    return url;
  }

  #downloadUrl(objectPath) {
    const url = new URL(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucketName)}/o/${encodeURIComponent(objectPath)}`,
    );
    url.searchParams.set('alt', 'media');
    return url;
  }

  async #upload(objectPath, body, { cacheControl, ifGenerationMatch } = {}) {
    const payload = serialize(body);
    const boundary = `artificial-analyzer-${randomUUID()}`;
    const url = this.#uploadUrl(ifGenerationMatch);
    const headers = await this.#authorizedHeaders(url);
    headers.set('content-type', `multipart/related; boundary=${boundary}`);

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body: multipartBody(
        { name: objectPath, contentType: 'application/json; charset=UTF-8', cacheControl },
        payload,
        boundary,
      ),
    });

    if (response.ok) return;
    if (response.status === 412 && ifGenerationMatch === 0) {
      const existing = await this.#download(objectPath);
      if (existing === payload) return;
      throw new Error(`Immutable Cloud Storage object has different content: ${objectPath}`);
    }

    const details = await response.text().catch(() => '');
    throw new Error(
      `Cloud Storage upload failed for ${objectPath}: ${response.status} ${details.slice(0, 300)}`,
    );
  }

  async #download(objectPath) {
    const url = this.#downloadUrl(objectPath);
    const headers = await this.#authorizedHeaders(url);
    const response = await this.fetchImpl(url, { headers });
    if (!response.ok) {
      throw new Error(`Cloud Storage read failed for ${objectPath}: ${response.status}`);
    }
    return response.text();
  }

  async putImmutable(objectPath, body) {
    await this.#upload(objectPath, body, {
      cacheControl: IMMUTABLE_CACHE_CONTROL,
      ifGenerationMatch: 0,
    });
  }

  async putManifest(objectPath, body) {
    await this.#upload(objectPath, body, { cacheControl: MANIFEST_CACHE_CONTROL });
  }
}
