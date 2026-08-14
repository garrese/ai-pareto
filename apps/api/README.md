# api

Local Node server. It holds the Artificial Analysis token, caches the model list, and serves the
`apps/web` frontend so both run from one origin.

No dependencies — it uses only the Node standard library. Requires Node.js 20 or newer.

## Setup

```bash
cp config.properties.example config.properties
```

Fill in `aa.api.key`, then:

```bash
npm start
```

`npm run dev` restarts on file changes.

## Configuration

`config.properties` is git-ignored and holds the token. Keys:

| Key | Default | Meaning |
| --- | --- | --- |
| `aa.api.key` | — | Artificial Analysis API key. Required. |
| `aa.api.base` | `https://artificialanalysis.ai/api/v2` | Upstream base URL. |
| `aa.api.path` | `/language/models/free` | Endpoint path. |
| `aa.api.daily.limit` | `100` | Fallback quota label, used only until the real headers are seen. |
| `server.port` | `8787` | Local listen port. |
| `cache.ttl.minutes` | `360` | How long a cached response stays fresh. |

## Endpoints

| Route | Returns |
| --- | --- |
| `GET /api/health` | `{ ok: true }` |
| `GET /api/models` | Normalized model list plus cache metadata. `?refresh=1` forces a refetch. |
| `GET /api/usage` | Last known quota snapshot. Costs no upstream request. |
| `GET /*` | Static files from `apps/web`. |

`/api/models` responds with:

```json
{
  "fetchedAt": "2026-08-14T08:05:25.463Z",
  "cache": "hit | miss | stale",
  "stale": false,
  "count": 608,
  "pages": 4,
  "rateLimit": { "limit": 100, "remaining": 91, "resetsAt": "…", "source": "headers" },
  "warning": null,
  "models": [
    {
      "id": "…", "slug": "…", "name": "…", "creator": "…", "creatorId": "…",
      "releaseDate": "2026-07-09",
      "intelligence": 47, "codingIndex": 63.3, "agenticIndex": null,
      "price": 0.45, "priceInput": 0.2, "priceOutput": 1.2,
      "speed": 132.583, "ttft": 11.332
    }
  ]
}
```

`price` is the 3:1 blended figure, computed here as `(3 × input + output) / 4` — the endpoint no
longer returns it directly. Unmeasured metrics arrive as `null`; a price of `0` (open-weight models
with no priced endpoint) is normalized to `null` too.

## Caching and quota

The free tier allows 100 requests per 24-hour window, and one refresh costs one request per page —
four today. Two files, both git-ignored:

| File | Holds |
| --- | --- |
| `.cache/models.json` | The last full model list plus its `fetchedAt` |
| `.cache/usage.json` | Last `X-RateLimit-*` snapshot and our own lifetime request count |

Being plain files, both survive a restart: bringing the server back up costs no quota. If a refresh
fails, the cached copy is served with `stale: true` and `warning` set, rather than dropping the
dataset.

## Endpoint deprecation

`/data/llms/models` — the path this project started on — is deprecated. Its responses carry
`Sunset: Wed, 04 Nov 2026 23:59:59 GMT`, after which it returns `410 Gone`. This server uses the
replacement, `/language/models/free`, which differs in three ways worth knowing:

- It is paginated (200 per page), so a full refresh is several requests.
- It has no blended price field; the client computes it.
- It does return `X-RateLimit-*` headers, which the old path did not.
