import { oauth1Authorization } from './oauth1.js';

export class XApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'XApiError';
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

export class XClient {
  constructor({ credentials, userId, fetchImpl = fetch, now = () => new Date(), nonce }) {
    this.credentials = credentials;
    this.userId = userId;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.nonce = nonce;
  }

  #authorization(method, url) {
    return oauth1Authorization({
      method,
      url,
      ...this.credentials,
      timestamp: Math.floor(this.now().getTime() / 1000),
      nonce: this.nonce,
    });
  }

  async #request(method, url, body = null) {
    const headers = { authorization: this.#authorization(method, url) };
    if (body !== null) headers['content-type'] = 'application/json';
    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.detail ?? payload?.title ?? `HTTP ${response.status}`;
      throw new XApiError(`X API request failed: ${String(detail).slice(0, 200)}`, response.status);
    }
    return payload;
  }

  async findPostByMarker(marker) {
    const url = new URL(`https://api.x.com/2/users/${encodeURIComponent(this.userId)}/tweets`);
    url.searchParams.set('max_results', '10');
    url.searchParams.set('exclude', 'replies,retweets');
    const payload = await this.#request('GET', url);
    const match = (payload?.data ?? []).find((post) => post.text?.includes(marker));
    return match ? { id: match.id, text: match.text } : null;
  }

  async createPost(text) {
    const payload = await this.#request('POST', 'https://api.x.com/2/tweets', { text });
    if (typeof payload?.data?.id !== 'string') {
      throw new XApiError('X API response did not contain a post ID', 502);
    }
    return { id: payload.data.id, text: payload.data.text ?? text };
  }
}
