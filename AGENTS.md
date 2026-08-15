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
  Its port comes from `config.properties`, unless `PORT` is set in the environment — that wins, so a
  second instance can be brought up alongside one that is already running.
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
`@AIParetoRadar`, subject to availability. The **page** is titled just **AI Pareto** (2026-08-15):
"Radar" is what the bot does — watch and report — and the page does not watch, it plots. The brand describes data-driven comparisons of AI models
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

On desktop it is `clamp(560px, 72vh, 960px)` tall, raised twice on 2026-08-15 from
`clamp(420px, 58vh, 820px)`. The plot was letterboxed at nearly 3:1, which is where the vertical
crowding came from; it is now ~2.5:1 and names 16 of 17 gold models against 15.

**On a small laptop the floor is what binds, not the `vh` term** — at 640px of viewport `72vh` is
461px, so the chart is 560. Raise the floor, not the percentage, when the ask is "taller on a small
screen".

The cost is that the chart card runs well past the fold there: at 1366×640 it starts 412px down, of
which the filters row alone is 147px because it wraps to two lines at that width. No height fixes
that — **folding the filters on short screens regardless of width would**, and it has been offered
to the user but not done. The `(max-height: 500px)` fold is gated behind `max-width: 960px` today,
so a 1366×640 laptop lays every filter out.

The **vertical scale reserves one label's worth of sky** past the highest and lowest marks — about
26px, 24 on a phone — on top of the 6% proportional padding. `makeScale`'s `margin` option solves
`p / (span + 2p) = margin / pixels`, because padding the domain also stretches it and the naive
figure comes out short. Marks land on those edges constantly, since the extremes of a front are the
whole point of drawing one, and 6% alone left about 19px, which is not a label. The reservation is
unconditional rather than tied to the names checkbox, so toggling names does not move every point.
Horizontally there is nothing to reserve: a name is ~200px wide and a margin that fitted one would
be most of the plot, so side labels are placed inwards instead.

### What gets drawn at all

The plot is **the peeled fronts plus at most 30 more models** (`RUNNER_LIMIT` in `main.js`),
decided with the user on 2026-08-15. The full dominated cloud was several hundred marks that buried
the fronts they surround, and it stretched both axes to fit outliers nobody was looking at.

The 30 are chosen by **carrying on peeling** — front 4, front 5, and so on — via `runnersUp` in
`pareto.js`. The front that overflows the limit is thinned by spreading along the first objective,
so the band keeps both of its ends instead of piling into one corner.

**An efficiency ratio such as intelligence ÷ cost was considered first and rejected.** It is only
defined when one objective is maximised and the other minimised, so it says nothing about
intelligence-vs-speed or latency-vs-cost, and because the intelligence index is anchored at zero it
scores a model at index 20 for $0.002 an order of magnitude above anything on the gold front. Front
rank is invariant to units and to the log/linear toggle, which a ratio is not.

Consequences that are load-bearing:

- **Whatever is searched for is drawn**, even when the cut left it out — every bot post links here
  by model name, and a link that highlights nothing reads as "that model is not in this data".
  Those extras join the runners-up, so they are in the table too.
- The legend says **"Closest to a front, of N dominated"**, which is the only place the reader
  learns the plot is a subset. When nothing was cut it goes back to the old wording.
- The **table lists the runners-up as well**, ranked `—`. It could not before, when "the rest" was
  three hundred models; the accessibility mitigation is stronger for it.
- Names improved for free: at 1280px all 17 gold models are named, against 15 before.

### Names on the plot

Added 2026-08-15, modelled on how Artificial Analysis labels its own charts.

- **Idle, the best front on show is named** — gold normally, silver if gold is filtered out, and so
  on. The dominated cloud is never named; there are hundreds of it. **Searching, the matches take
  the labels instead**, whatever tier they are in, so the answer to the query is the only thing
  spelled out — but past **10 matches only the ranked ones are named**, because a broad query
  matches most of the cloud and burying the fronts in it defeats the point.
- A **"Relevant model names" checkbox** in the filters turns the whole thing off. It starts **off on the
  screens that fold the filters away** — a dozen names on a phone-width plot are the chart, not an
  annotation of it — and **on regardless when the URL carries `?highlight=`**, because the name is
  the entire reason a bot link was followed.
- The **two ends of the front are served before anyone else**. They answer "what is the best there
  is" and "what is the least I can pay to still be on the front", and the top end sits in the corner
  where space runs out first: served on crowding alone it went unnamed, which is the one omission a
  reader notices (reported 2026-08-15).
- Placement is greedy over rings of candidate offsets, 16 directions per ring. Only two rules are
  absolute: a label may never overlap another label, and it may never leave the plot. A target with
  no such slot goes unnamed, because a name in the wrong place is worse than no name.
- **Everything else is priced, not forbidden**, so a crowded chart degrades instead of emptying out.
  Crossing a front line costs 10 and is the expensive one — a name laid across a frontier hides the
  one thing the chart draws, and reads as if the curve itself were annotated. A leader crossing one
  costs 4, covering a ranked mark 3, covering the dominated cloud 1. The search stops at the first
  zero-cost slot on the nearest ring that has one.
  - The prices came from real clutter (2026-08-15): before them, five of the fifteen names on the
    default view lay across a front line. After, 1280px names 15 of 17 gold models with zero label
    overlaps, no ranked mark covered, and two crossings left in the tightest corner.
- Targets are served **most-crowded-first**. Left-to-right names exactly as many but pushes them
  further out — 230px of leader line against 183, worst case 66px against 41.
- The label halo is a `paint-order: stroke` outline in `--surface-1`. Labels cross the dominated
  cloud and are unreadable over it without one. Leader lines are `--text-muted`, not `--baseline`:
  at `--baseline` they read as one more gridline, which is what a pointer must never look like.

### Dimming while searching

A search that matches nothing **dims nothing** — there is no match to look at, so greying the plot
would only punish the typing. `is-searching` is set from `matches.size > 0`, not from `matches`.

Matches recede the rest of the plot rather than erasing it: 0.12 opacity was tried and the fronts
disappeared. The dominated cloud (0.22) and the tiers (0.38) dim by different amounts so the
ranking still reads through the dimming.

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

## The pickers

They filter at different layers, deliberately: **creators and models** filter the input, so the
fronts are recomputed for the subset — pick five models and you get the fronts among those five;
**tiers** filter only what is drawn, because recomputing would promote silver into gold's place the
moment gold is hidden. Creators and models AND together.

The creator and model pickers **each carry their own search box** (2026-08-15): 58 creators and 608
models are more than anyone scrolls. Rows are built once and hidden as you type — rebuilding 608
checkboxes per keystroke is the obvious mistake. Two details that are easy to get wrong:

- `.picker-row` sets `display: flex`, which **beats the `hidden` attribute's UA rule**, so
  `.picker-row[hidden] { display: none }` has to be said explicitly or filtering does nothing.
- **Select all / Clear act on what the filter leaves visible**, and relabel themselves to "Select
  matches" / "Clear matches" while a query is up. Acting on everything would silently undo choices
  the reader cannot see.

The filter is **not** auto-focused when the dropdown opens: on a phone that raises the keyboard over
the list it is filtering.

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

- **Use the branch hierarchy for every change:**
  - `main` is the stable, deployable branch. Never implement or commit directly on `main`.
  - `develop` is the integration branch. Start work from an up-to-date `develop` and merge completed
    work back into it.
  - Every evolution uses a short-lived, agent-neutral work branch created from `develop`. Use
    `feature/YYYYMMDD-<brief-name>` for product work and
    `fix/YYYYMMDD-<brief-name>` for defects, for example
    `feature/20260815-model-comparison` or `fix/20260815-mobile-axis`. The date is the local
    project date when the branch is created; the name is concise, lowercase, and kebab-cased.
  - Merge `develop` into `main` only for a release or deployment. Deploy only revisions that are on
    `main`, and return to `develop` after completing the release.
- **One logical change per commit.** A backend change and a frontend change in the same turn are two
  commits, not one. Don't bundle unrelated work to save a commit.
- **Update [`CHANGELOG.md`](CHANGELOG.md) with every completed evolution.** Add a concise entry under
  the current local date (`YYYY-MM-DD`), newest date first, and use an `Added`, `Changed`, `Fixed`,
  or `Removed` subsection as appropriate. Record the outcome and reason when useful, not a list of
  touched files. Include the changelog update in the evolution's commit.
- **Never commit a secret.** Before every commit, sanity-check that `apps/api/config.properties`,
  `.cache/`, `.claude/` are not staged — `git status --short` should not show them, and
  `git check-ignore` should. If a check ever fails, stop and say so rather than committing anyway.
- **Still ask before:** force-push, rewriting published history, and anything the user would need
  to review before it leaves the local repo.
- Write commit messages the way the rest of this file is written: what changed and *why*, not a
  changelog of file names. Skip the message body when the summary line already says it all.

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
- **One post per movement, always.** `DIGEST_BURSTS` is off (2026-08-15): six arrivals in one scan
  means six posts. The digest path is kept working and under test behind that flag in case the
  volume ever becomes a problem — do not delete it, and do not switch it on unasked.
- **Order of evaluation does not matter and must not start to.** Each event is a pure function of
  (before, after, model, objectives) — no sequencing, no mutation between events — and a permutation
  test pins that down. Two arrivals that both beat the same model will both name it; both
  statements are true, and attribution is deliberately not made exclusive.
- **The displaced model named in a post is the strongest one**, by the maximised objective, with the
  ID as tiebreak. It used to be whichever UUID sorted first, which was arbitrary.
- **Template B**, agreed after comparing four. Headline with medal, indented metrics, relation line.
  When it will not fit, detail is dropped in a fixed order — the displaced model's numbers, then the
  subject's, then names are truncated. Names are never cut while a number could go instead.
- Posts link to `?highlight=<model name>&e=<event token>`. The site reads `highlight` into its
  search box; `e` is how a post is later recognised as ours. X flat-rates every URL at 23
  characters, so both parameters are free.
- **Percent-encode parentheses.** `encodeURIComponent` leaves `()` alone and X's link parser stops
  dead at one — verified 2026-08-15 on a live post, where the trailing `)` was cut off the link and
  left loose in the text. Almost every model here is named "Something (high)", so this is the common
  case. `strictEncode` in `render.js` handles it; do not replace it with `encodeURIComponent`.
- **The event token lives in the link, not in the body.** A visible `[aa:…]` marker is noise on a
  public account. It only reappears when no site URL is configured, because then there is nowhere to
  hide it and a post nobody can recognise is worse. Matching therefore reads
  `entities.urls[].expanded_url` — `text` holds only the t.co short form — which needs
  `tweet.fields=entities` on the timeline request.
- `apps/x-publisher/scripts/publish-sample.mjs` rehearses the whole path against the real cache and
  is a dry run unless given `--confirm`.

First real post went out 2026-08-15 (`2088539843328463335`), which established two things against
the live API. OAuth 1.0a and the timeline read both work on the current plan. And the timeline read
is **eventually consistent** — a post made seconds earlier was not in it, so `findPostByMarker`
cannot catch an immediate retry. The Firestore claim is the real idempotency guarantee;
reconciliation is the narrower backstop. Do not describe it as preventing duplicates outright.

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
