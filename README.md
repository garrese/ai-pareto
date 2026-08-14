# Artificial Analyzer

Charts the [Artificial Analysis](https://artificialanalysis.ai) language-model dataset as **Pareto
tiers**: the first four Pareto fronts over any two of intelligence, price, speed and latency.

Front 1 (*gold*) is the set of models that nothing else beats on both axes at once. Peel it away and
front 2 (*silver*) surfaces, then *bronze*, then *chocolate*. Everything else is dominated by at
least four models and is drawn in the background.

> **Status:** production deployment infrastructure is implemented but not yet applied.

## Bring Your Own Token (BYOT)

The project ships with no credentials. For local development, supply your own Artificial Analysis
API key in `apps/api/config.properties`, which is git-ignored. Get a key from the
[Artificial Analysis Data API](https://artificialanalysis.ai/data-api) page.

The local key is read by the server and never sent to the browser. Production stores its copy in
Google Secret Manager and exposes it only to the collector service account.

## Running it

Requires Node.js 22 or newer.

```bash
cp apps/api/config.properties.example apps/api/config.properties
```

Put your key in `aa.api.key`, then:

```bash
cd apps/api
npm ci
npm start
```

Open <http://localhost:8787>. The server hosts the API on `/api/*` and serves the frontend from
`apps/web`.

## Quota and caching

The free tier allows 100 requests per 24-hour window, and one refresh spends one request per page
of results (currently four). So responses are written to `apps/api/.cache/models.json` and reused
for 6 hours (`cache.ttl.minutes`). The cache is a plain file, so it **survives a server restart** —
restarting costs nothing.

- **Refresh data** forces a refetch. If it fails, the last good response is served instead, flagged
  as stale.
- **API quota** shows how many requests are left, read from the `X-RateLimit-*` headers of the last
  real call and stored in `apps/api/.cache/usage.json`. It costs nothing to check, since asking the
  API how many requests remain would itself spend one.

Both cache files are git-ignored.

## Repository layout

This repository hosts multiple independent subprojects, each self-contained under `apps/`:

```
apps/
  api/          Local server and scheduled production collector
  web/          Static frontend and Firebase Hosting configuration
  x-publisher/  Private Pub/Sub consumer for idempotent X delivery
infra/
  gcp/          Terraform for the Google Cloud platform
```

Each subproject owns its tooling and README. There is no shared build at the root.

The target system and its failure semantics are documented in
[`doc/architecture.md`](doc/architecture.md). Deployment commands and the two-phase Terraform flow
live in [`infra/gcp/README.md`](infra/gcp/README.md).

## Data notes

Metrics come from `GET /language/models/free`, walked page by page.

Missing measurements come back as `null`, except that open-weight models with no priced hosted
endpoint report a price of `0`. Both are treated as missing, so a model is only plotted on axes it
actually has data for — otherwise a `$0` model would dominate the price axis outright.

### The two cost metrics are not the same thing

| Metric | What it is | Coverage |
| --- | --- | --- |
| **Price per token** | USD per 1M tokens, blended 3:1 input to output. A *rate*. | ~380 models |
| **Cost per task** | USD actually spent per task running the Intelligence Index. A *bill*. | ~130 models |

They rank models very differently, because price per token says nothing about how many tokens a
model burns to answer. GPT-5.6 Terra costs $4.50 per 1M tokens but $0.094 per task; Qwen3.5 9B
(Reasoning) costs $0.16 per 1M tokens and $0.24 per task — 29× cheaper per token, and more expensive
per task. If the question is "what will this cost me to run", cost per task is the honest axis;
price per token is the one with fuller coverage.

Speed is median output tokens per second, and latency is median time to first token.

This project is not affiliated with or endorsed by Artificial Analysis.

## License

Not licensed yet. Until a license file is added, all rights are reserved.
