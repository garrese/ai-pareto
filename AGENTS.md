# AGENTS.md

This is the canonical guide for every coding agent working in this repository. Read it before making changes. `CLAUDE.md` is a short compatibility pointer for Claude Code.

## Repository shape

Multi-subproject repo. Each subproject lives under `apps/<name>`, is self-contained, and owns its
own tooling. There is no root build, no workspace manifest, and no shared dependency tree — do not
add one at the root unless asked.

All source code and public-facing content are written in **English**. This includes identifiers,
README and generated documentation, UI copy, code comments, and commit messages. The repository is
public, so assume that everything committed is world-readable.

- `apps/api` — Node server plus the production collector job. The local server uses the standard
  library; the collector uses official Firestore, Pub/Sub, and Google authentication clients. It
  holds the token, caches the upstream response locally, and serves `apps/web` during development.
- `apps/web` — static frontend, plain HTML/CSS/ES modules, no build step, no dependencies. Localhost
  reads `apps/api`; hosted builds read the public snapshot contract configured in `config.js`.
- `apps/x-publisher` — private Cloud Run Pub/Sub push consumer. It uses Firestore delivery leases,
  OAuth 1.0a User Context, and X timeline reconciliation to reduce duplicate-post risk.

Keep the local server and frontend dependency-free. Production Google Cloud integration is the
concrete exception: use narrowly scoped official clients and audit each app's production dependency
tree.

## Why there is a backend

The original plan was a purely static BYOT page where the user pastes their key in the browser.
**That does not work against this API** — verified 2026-08-14 by probing the live endpoint:

- `OPTIONS /api/v2/data/llms/models` with `Origin` + `Access-Control-Request-Headers: x-api-key`
  returns `204 No Content` with `Allow: GET, HEAD, OPTIONS` but **no** `Access-Control-Allow-Origin`
  and **no** `Access-Control-Allow-Headers`.
- The vendor docs state the API is server-side only and that keys must not be exposed to clients.

So the browser preflight fails and a direct `fetch()` is blocked. `apps/api` exists to solve exactly
this. The user knows; **do not raise it again as if it were news**, and do not mention CORS in the
README. Re-probe before assuming it is still true — the vendor may add CORS headers, which would
make a static-only build possible again.

## Artificial Analysis API

- Base URL: `https://artificialanalysis.ai/api/v2`, auth via `x-api-key` header.
- `GET /language/models/free` is the only endpoint used. Envelope:
  `{ tier, intelligence_index_version, pagination, data }`.
- **Paginated**, 200 per page — 608 models is 4 requests. Free tier is 100 requests per 24h fixed
  window, so responses are cached to `apps/api/.cache/models.json`. Never add a code path that
  refetches per render.
- This endpoint **does** return `X-RateLimit-Limit/Remaining/Reset`. `/api/usage` serves the last
  snapshot from `.cache/usage.json` rather than spending a request to ask.
- Docs: <https://artificialanalysis.ai/data-api/docs>

### The old endpoint is being retired

`/data/llms/models` was the original path. Its responses carry `Deprecation: @1785801600` and
`Sunset: Wed, 04 Nov 2026 23:59:59 GMT`; after that it returns `410 Gone`. Migrated 2026-08-14.
Differences that bit during the migration:

- Old returned `{ status, prompt_options, data }`, unpaginated, with **no** rate-limit headers.
- Old had `pricing.price_1m_blended_3_to_1`; the new one does not, so `aa-client.js` computes
  `(3 × input + output) / 4`. Verified against the old figures before switching.
- Old had `model_creator.slug`; the new one only has `id` and `name`, hence `creatorId`.
- Performance metrics moved into a `performance` object.
- Speed coverage improved: models with price + intelligence + speed went from 153 to 300.

### Two different cost metrics

- `price` — USD per 1M tokens, blended 3:1, computed here. A **rate**. ~380 models.
- `costPerTask` — `artificial_analysis_intelligence_index_cost.cost_per_task.total_cost`. USD
  actually spent per task running the index, so it prices verbosity too. A **bill**. ~132 models.

They are not interchangeable and rank models very differently (GPT-5.6 Terra: $4.50/1M but
$0.094/task; Qwen3.5 9B Reasoning: $0.16/1M but $0.24/task). Do not present either as "the price"
without saying which. The nested shape is easy to get wrong — `cost_per_task` is an object whose
`total_cost` is the figure you want.

### Data quirks

The old endpoint used `0` as its "not measured" sentinel throughout. The new one uses proper `null`
— **except** for open-weight models with no priced hosted endpoint, which report price `0`
(Command A+, Devstral 2, the Gemma 3 line, …). `aa-client.js` still treats a `0` price as missing;
without that, a $0 model dominates the price axis outright. Of 608 models, ~380 have both price and
intelligence and ~300 have all three of price, intelligence and speed.

## Token handling

The key lives in `apps/api/config.properties` (git-ignored, `*.properties` with a
`!*.properties.example` negation). It is read server-side, never sent to the browser, and never
included in an API response — the 401 body is echoed in `warning`, and it does not contain the key.

## Brand

The project and its X bot use **AI Pareto Radar** as their primary name. The preferred X handle is
`@AIParetoRadar`, subject to availability. The brand describes data-driven comparisons of AI models
across intelligence, speed, and cost, with a focus on Pareto frontiers. Keep public-facing brand copy
in English unless the user explicitly requests a localized variant.

## Charts

Tier colours are literal medals (gold, silver, bronze) at the user's explicit request, after an
ordinal single-hue ramp was tried first. A fourth tier, chocolate, was dropped on 2026-08-15: the
user found the extra front added noise, not signal. The frontend now peels `TIERS.length` fronts —
do not reintroduce a fourth without being asked. (The collector still stores four in its snapshots;
that is a separate decision.)

One check in `validate_palette.js` cannot pass with real medals and is accepted knowingly: silver is
below the chroma floor (it *is* grey). What was tuned until it passed, and what must stay passing,
is **pair separability** — `--pairs all`, worst pair ΔE 17.1 light / 15.7 dark normal-vision
(floor 15) and 17.0 / 14.5 under protan/deutan (floor 8), measured while chocolate was still in the
ramp. Re-run for light `#fcfcfb` and dark `#1a1a19` if you touch a tier colour.

The mitigations that make the accepted failure safe are load-bearing: the legend is always rendered,
the tooltip names the tier in words, and the table view lists every model by tier — as the ordinal
`1º`/`2º`/`3º`, with the medal name on the cell's `title`, because the word is far wider than the
column ever needs to be. Do not remove them. The dominated cloud (`--rest-mark`) is deliberately
lighter and more transparent than silver in light mode, and darker in dark mode — "recessive" flips
meaning with the surface.

The chart sizes its viewBox to the container in CSS pixels and redraws from a `ResizeObserver`, so
labels stay at true pixel sizes. Do not reintroduce a fixed viewBox.

## Small screens

Phone layout is a running priority (2026-08-15): the plot and the table get the pixels, everything
else gives them up.

- The chart's **left gutter is measured, not fixed** — `chart.js` builds the Y scale first, asks it
  what its tick labels will say, and sizes the gutter to the widest one. Do not put a constant back
  in `COMPACT_PAD.left`; it reserved room for digits that are usually never drawn.
- The **filters fold away** behind a "Show filters" button below 720px and on short landscape
  screens, so a phone opens on data. The **chart/table switch stays outside the fold** — it is the
  one control that must always be one tap away.
- **Table column order is deliberate**: tier, model, intelligence, cost/task first, creator last.
  Headings are abbreviated (`Intel`, `$/task`, `$/1M`, `Lat`) with the full term on an `<abbr>`
  title, because a spelled-out heading widens a column past anything its values ever hold.
- Model names must stay wrappable. Their column has a `min-width` floor on phones: without it the
  column collapses to its longest word and rows grow six lines tall.

The two pickers filter at different layers, deliberately: **creators** filter the input, so the
fronts are recomputed for the subset; **tiers** filter only what is drawn, because recomputing
would promote silver into gold's place the moment gold is hidden.

## Git workflow

**Commit and push autonomously, without asking first.** The user has explicitly asked for this
(2026-08-15): when a change is finished and verified, commit it and push it to the configured
remote — do not wait for a "yes, commit that" that will not come. This overrides the general
default of confirming before commits and pushes.

What "finished and verified" means in practice:

- The change does what it was asked to do and you have actually checked that (ran it, read the
  output, exercised the changed path) — not just "the code looks right".
- It is not mid-edit, half-applied, or blocked on an open question back to the user.

Guidelines that still apply:

- **One logical change per commit.** A backend change and a frontend change in the same turn are two
  commits, not one. Don't bundle unrelated work to save a commit.
- **Never commit a secret.** Before every commit, sanity-check that `apps/api/config.properties`,
  `.cache/`, `.claude/` are not staged — `git status --short` should not show them, and
  `git check-ignore` should. If a check ever fails, stop and say so rather than committing anyway.
- **Still ask before:** force-push, rewriting published history, and anything the user would need
  to review before it leaves the local repo.
- Write commit messages the way the rest of this file is written: what changed and *why*, not a
  changelog of file names. Skip the message body when the summary line already says it all.
- Work directly on `main` by default. The user explicitly confirmed on 2026-08-14 that this is a
  single-developer repository and does not need feature branches. Create a branch only when the user
  asks for one or when parallel work would make isolation materially safer.

## What the X bot publishes

Decided with the user on 2026-08-15, after simulating the rules against the live dataset. Do not
widen any of this without being asked.

- **Only arrivals and promotions.** A model that was in none of the peeled fronts and now is, or one
  that moved to a strictly better front. Demotions and exits stay silent. This matters more than it
  looks: fronts are not fixed-size, and one arrival in front 1 pushed models down through fronts 2
  and 3 for **five** membership changes in the real data — announcing each would retell one piece of
  news five times. A pathological arrival displaced eight at once and cascaded to nineteen.
- **An arrival need not displace anyone.** A non-dominated model that dominates nobody just makes
  the front wider (17 → 18 in the real data). `displaced` is then empty and the post names the
  frontier neighbour instead. Never write copy that assumes a displaced model exists.
- **Only `cost-per-task-intelligence` is published.** `price-intelligence` stays monitored but
  unpublished — 380 models against 136, so it moves far more often. `published: true` in
  `definitions.js` is the switch.
- **One post per movement, with a burst cap.** Above `MAX_POSTS_PER_SCAN` the scan collapses into a
  single digest. A four-hour scan normally yields zero or one; a burst means Artificial Analysis
  re-scored the catalogue.
- **Template B**, agreed after comparing four. Headline with medal, indented metrics, relation line.
  When it will not fit, detail is dropped in a fixed order — the displaced model's numbers, then the
  subject's, then names are truncated. Names are never cut while a number could go instead.
- Posts link to `?highlight=<model name>`, which the site reads into its search box. X flat-rates
  every URL at 23 characters, so the parameter costs nothing.
- `apps/x-publisher/scripts/publish-sample.mjs` rehearses the whole path against the real cache and
  is a dry run unless given `--confirm`.

Number formatting is duplicated between `apps/web/src/metrics.js` and `apps/x-publisher/src/render.js`
because the two apps share no code. A post and the page it links to must show identical figures —
change one, change the other.

## Windows PowerShell

The user's machine is a managed Windows box with PowerShell's execution policy at `Restricted`.
PowerShell resolves the bare name `npm` to `npm.ps1` ahead of `npm.cmd`, so `npm ci` dies with
`UnauthorizedAccess` before Node is ever reached. **Invoke `npm.cmd`** (verified 2026-08-15:
`npm.cmd --version` returns 11.13.0 under an explicitly `Restricted` policy, `npm` does not).
Do not tell the user to run `Set-ExecutionPolicy -Scope CurrentUser` — a domain policy can override
it, and they do not have the rights to argue with it.

## Conventions

- `.gitignore` deliberately excludes most AI-assistant config (`.claude/`, `.cursor/`, `AGENTS.md`,
  …) as local-only. **`CLAUDE.md` is the exception** — it is tracked and committed on purpose
  (2026-08-14), so write it as if it will be read by anyone browsing the repo, not just Claude.

## Agent-guide ownership

`AGENTS.md` is tracked and is the authoritative, shared instruction file for this repository. It supersedes the older convention below that treated it as local-only. Keep `CLAUDE.md` as a brief pointer so Claude Code users are directed here.
