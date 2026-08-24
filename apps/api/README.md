# api

Local Node server and production collector. The local server holds the Artificial Analysis token,
caches the model list, and serves the `apps/web` frontend so both run from one origin. The Cloud Run
Job entry point publishes immutable datasets and transactional Pareto-change events.

The local server uses only the Node standard library. The production collector uses the official
Firestore, Pub/Sub, and Google authentication clients. Requires Node.js 22 or newer.

## Setup

```bash
cp config.properties.example config.properties
```

Fill in `aa.api.key`, then:

```bash
npm start
```

On Windows PowerShell, write `npm.cmd` instead of `npm` when the execution policy is restricted —
see the [local development guide](../../doc/local-development.md#restricted-windows-powershell).

`npm run dev` restarts on file changes.

Run the collector contract locally with the cached upstream response when one
is available (or fetch once when it is not):

```bash
npm run snapshot
```

This writes generated public objects below `.cache/generated/public`. Snapshot
objects are immutable and `latest.json` is written only after both snapshot
objects succeed. Pass `-- --refresh` to explicitly bypass the upstream cache.

Run the dependency-free Node test suite with:

```bash
npm test
```

## Configuration

`config.properties` is git-ignored and holds the token. Keys:

| Key | Default | Meaning |
| --- | --- | --- |
| `aa.api.key` | — | Artificial Analysis API key. Required. |
| `aa.api.base` | `https://artificialanalysis.ai/api/v2` | Upstream base URL. |
| `aa.api.path` | `/language/models/free` | Endpoint path. |
| `aa.api.daily.limit` | `100` | Fallback quota label, used only until the real headers are seen. |
| `server.port` | `8787` | Local listen port. |
| `cache.ttl.minutes` | `360` | The age at which cached data is labelled stale. Does not trigger a refetch. |
| `refresh.manual.enabled` | `false` | Whether `POST /api/refresh` exists at all. |

## Endpoints

| Route | Returns |
| --- | --- |
| `GET /api/health` | `{ ok: true, manualRefresh: boolean }` — whether the page should offer its refresh button. |
| `GET /api/models` | Normalized model list plus cache metadata. Reads the cache; never refetches. |
| `POST /api/refresh` | The only route that spends upstream quota. Gated — see below. |
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

**The local server never fetches on its own.** `GET /api/models` reads the cache whatever its age;
an expired `cache.ttl.minutes` only makes it say `stale`. Serving the page therefore costs nothing,
which matters because the cloud collector spends 24 of the 100 daily requests on its own schedule
and the two share one key.

### Manual refresh

`POST /api/refresh` is the only route that reaches upstream. Because one click costs four requests,
it is fenced in rather than merely hidden in the page:

- It does not exist unless the server was started with `refresh.manual.enabled=true`; otherwise it
  answers `404`, the same as any unknown route.
- It is refused for any client that is not on the loopback interface.
- It requires `POST`, so no link, redirect, image or typed URL can trigger it.
- It requires `Sec-Fetch-Site: same-origin`, so only the page this server serves may call it. A page
  opened straight off disk over `file://` is cross-origin and is refused too.
- It requires the run's token in an `x-refresh-token` header. The token is minted per run, printed
  to the server console, and **never served over HTTP** — reading the markup, the scripts or the DOM
  does not get you one. The page asks you to paste it once and keeps it in `sessionStorage`.
- Concurrent calls collapse into one upstream walk, so a double click still costs four requests.

The custom header is load-bearing beyond the token itself: a cross-origin request carrying it needs
a preflight, and the `OPTIONS` handler advertises neither `POST` nor that header.

A refresh is also refused when the window cannot fit it. `src/quota.js` compares the last observed
`X-RateLimit-Remaining` against the number of pages the previous walk actually needed, and answers
`429` rather than spending what is left on a walk that would die on its last page. It is deliberately
generous about missing information — no reading yet, no rate-limit headers, or a window that has
since reset all count as "go ahead" — because the guard exists to stop a refresh that is known to be
doomed, not one that merely cannot be proven safe.

## Collector core

`src/collector` contains I/O-independent snapshot, Pareto, event, and publication logic. The local
snapshot store is one adapter for that core; Cloud Storage, Firestore, and Pub/Sub adapters will use
the same contracts in production. Pareto change events are deterministic and only describe changes
to the outermost front. The first production snapshot establishes the baseline without generating
an event.

## Cloud Run collector

`src/collector/cloud-run.js` is a finite job entry point: it performs or resumes one refresh and
exits with a non-zero status on failure so Cloud Run can retry it. It never starts an HTTP server.
The container is built from this directory:

```bash
docker build -t artificial-analyzer-collector .
```

Cloud Run injects the Artificial Analysis secret as `AA_API_KEY` from Secret Manager. Application
Default Credentials come from the job's dedicated service account; no service-account key file is
stored in the image or configured through `GOOGLE_APPLICATION_CREDENTIALS`.

| Environment variable | Required | Meaning |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` or `GCP_PROJECT_ID` | Yes | Google Cloud project identifier. |
| `PUBLIC_DATA_BUCKET` | Yes | Dedicated bucket for generated public JSON. |
| `COLLECTOR_DIAGNOSTICS_BUCKET` | Yes | Private bucket for rejected upstream payloads. |
| `AA_API_KEY` | Yes | Secret Manager value exposed only to the job process. |
| `PARETO_TOPIC` | No | Pub/Sub topic; defaults to `pareto-change-events`. |
| `COLLECTOR_LEASE_SECONDS` | No | Firestore execution lease; defaults to 900 seconds. |
| `AA_API_BASE` / `AA_API_PATH` | No | Upstream endpoint overrides. |

The job must be configured with exactly one task. Firestore prevents overlapping executions, stores
prepared manifests, and records Pareto state plus outbox events in one transaction. A retry after a
manifest failure resumes publication; a retry after a Pub/Sub failure drains the outbox without
fetching Artificial Analysis again.

A response containing duplicate model IDs is still rejected in full: it does not update
`public/latest.json`, and no duplicate is selected for the frontend. Before failing, the production
collector writes the complete page-by-page upstream response and the normalized model walk to the
private diagnostics bucket. The structured `data.refresh.rejected.duplicate-models` log records
each occurrence's page and position, the normalized fields that differ, and the private object path
for later inspection. This capture deliberately records response data only; the API key remains a
request header and is never included.

## Endpoint deprecation

`/data/llms/models` — the path this project started on — is deprecated. Its responses carry
`Sunset: Wed, 04 Nov 2026 23:59:59 GMT`, after which it returns `410 Gone`. This server uses the
replacement, `/language/models/free`, which differs in three ways worth knowing:

- It is paginated (200 per page), so a full refresh is several requests.
- It has no blended price field; the client computes it.
- It does return `X-RateLimit-*` headers, which the old path did not.
