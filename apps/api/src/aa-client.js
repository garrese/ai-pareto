import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAX_PAGES = 20;

/**
 * Free-tier endpoints report `null` for metrics they have not measured, but
 * open-weight models with no priced hosted endpoint come back at price `0`
 * instead. A zero price would dominate the price axis outright, so both cases
 * are treated as "no data".
 */
const measured = (value) => (typeof value === 'number' && value > 0 ? value : null);
const finiteOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Artificial Analysis' headline price: 3 parts input to 1 part output. */
function blendedPrice(pricing) {
  const input = measured(pricing?.price_1m_input_tokens);
  const output = measured(pricing?.price_1m_output_tokens);
  if (input === null || output === null) return null;
  return (input * 3 + output) / 4;
}

function normalizeModel(raw) {
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    creator: raw.model_creator?.name ?? null,
    creatorId: raw.model_creator?.id ?? null,
    releaseDate: raw.release_date ?? null,
    // Artificial Analysis Intelligence Index — higher is better.
    intelligence: finiteOrNull(raw.evaluations?.artificial_analysis_intelligence_index),
    codingIndex: finiteOrNull(raw.evaluations?.artificial_analysis_coding_index),
    agenticIndex: finiteOrNull(raw.evaluations?.artificial_analysis_agentic_index),
    // USD per 1M tokens, blended 3:1 — lower is better. A token price, not a
    // per-task cost: a verbose reasoning model looks cheap here and expensive
    // in `costPerTask`.
    price: blendedPrice(raw.pricing),
    priceInput: measured(raw.pricing?.price_1m_input_tokens),
    priceOutput: measured(raw.pricing?.price_1m_output_tokens),
    // USD actually spent per task while running the Intelligence Index, so it
    // prices verbosity as well as tokens. Only reported for some models.
    costPerTask: measured(raw.artificial_analysis_intelligence_index_cost?.cost_per_task?.total_cost),
    evalTotalCost: measured(raw.artificial_analysis_intelligence_index_cost?.total_cost),
    // Median output tokens per second — higher is better.
    speed: measured(raw.performance?.median_output_tokens_per_second),
    // Median time to first token, seconds — lower is better.
    ttft: measured(raw.performance?.median_time_to_first_token_seconds),
  };
}

function readRateLimit(headers, fallbackLimit) {
  const limit = Number(headers.get('x-ratelimit-limit'));
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const reset = Number(headers.get('x-ratelimit-reset'));

  // The endpoint sends these today; older paths did not. Fall back to the
  // configured limit rather than reporting a confident wrong number.
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) {
    return { limit: fallbackLimit, remaining: null, resetsAt: null, source: 'config' };
  }

  return {
    limit,
    remaining,
    resetsAt: Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : null,
    source: 'headers',
  };
}

export class ArtificialAnalysisClient {
  constructor({ apiKey, apiBase, apiPath, cacheDir, cacheTtlMs, dailyLimit }) {
    this.apiKey = apiKey;
    this.url = `${apiBase}${apiPath}`;
    this.cacheTtlMs = cacheTtlMs;
    this.dailyLimit = dailyLimit;
    this.cacheDir = cacheDir;
    this.modelsFile = resolve(cacheDir, 'models.json');
    this.usageFile = resolve(cacheDir, 'usage.json');
  }

  async #readJson(file) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  async #writeJson(file, value) {
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
  }

  /** Reads the last rate-limit snapshot plus our own lifetime request count. */
  async getUsage() {
    const stored = await this.#readJson(this.usageFile);
    if (!stored) {
      return {
        limit: this.dailyLimit,
        remaining: null,
        resetsAt: null,
        observedAt: null,
        requestsMade: 0,
        source: 'none',
      };
    }
    return stored;
  }

  async #recordUsage(rateLimit, requestCount) {
    const previous = await this.#readJson(this.usageFile);
    await this.#writeJson(this.usageFile, {
      ...rateLimit,
      observedAt: new Date().toISOString(),
      requestsMade: (previous?.requestsMade ?? 0) + requestCount,
    });
  }

  /**
   * Walks every page of the model list. Each page is one request against the
   * daily quota, so the result is cached aggressively upstream of this call.
   */
  async #fetchModels() {
    const models = [];
    let rateLimit = null;
    let requestCount = 0;
    let page = 1;

    while (page <= MAX_PAGES) {
      const url = new URL(this.url);
      url.searchParams.set('page', String(page));

      const res = await fetch(url, { headers: { 'x-api-key': this.apiKey } });
      requestCount += 1;

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Record the attempts even on failure — they still cost quota.
        if (requestCount > 0) await this.#recordUsage(readRateLimit(res.headers, this.dailyLimit), requestCount);
        throw new Error(`Artificial Analysis API returned ${res.status}: ${body.slice(0, 300)}`);
      }

      const payload = await res.json();
      if (!Array.isArray(payload?.data)) {
        throw new Error('Unexpected API response: `data` is not an array');
      }

      models.push(...payload.data.map(normalizeModel));
      rateLimit = readRateLimit(res.headers, this.dailyLimit);

      if (!payload.pagination?.has_more) break;
      page += 1;
    }

    await this.#recordUsage(rateLimit, requestCount);

    return {
      fetchedAt: new Date().toISOString(),
      models,
      pages: requestCount,
      rateLimit,
    };
  }

  /**
   * Returns the model list, refreshing only when the on-disk cache has expired.
   * The cache lives in `.cache/models.json`, so it survives a server restart.
   * A failed refresh falls back to the stale copy rather than losing the data.
   */
  async getModels({ force = false } = {}) {
    const cached = await this.#readJson(this.modelsFile);
    const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

    if (cached && !force && age < this.cacheTtlMs) {
      return { ...cached, cache: 'hit', stale: false };
    }

    try {
      const fresh = await this.#fetchModels();
      await this.#writeJson(this.modelsFile, fresh);
      return { ...fresh, cache: 'miss', stale: false };
    } catch (err) {
      if (cached) {
        return { ...cached, cache: 'stale', stale: true, error: err.message };
      }
      throw err;
    }
  }
}
