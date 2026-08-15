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

  /**
   * Finds a post of ours by its event token.
   *
   * The token normally rides in the link rather than the body, so the match is
   * made against the expanded URLs X returns in `entities` — `text` only ever
   * holds the t.co short form. `textMarker` still matches posts written before
   * the token moved into the link, and covers a deployment with no site URL
   * configured, where the marker has nowhere to hide.
   *
   * Note this read is eventually consistent: a post made seconds ago will not
   * be here yet. It is a backstop for the crash window, not a lock.
   */
  async findPostByMarker({ token = null, textMarker = null } = {}) {
    if (!token && !textMarker) throw new Error('Finding a post needs a token or a text marker');

    const url = new URL(`https://api.x.com/2/users/${encodeURIComponent(this.userId)}/tweets`);
    url.searchParams.set('max_results', '10');
    url.searchParams.set('exclude', 'replies,retweets');
    url.searchParams.set('tweet.fields', 'entities');
    const payload = await this.#request('GET', url);

    const match = (payload?.data ?? []).find(
      (post) =>
        (textMarker && post.text?.includes(textMarker)) ||
        (token &&
          (post.entities?.urls ?? []).some((entry) =>
            entry.expanded_url?.includes(`e=${token}`),
          )),
    );
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
