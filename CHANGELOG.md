# Changelog

This file records notable product, infrastructure, and developer-workflow evolutions made by AI
coding agents. Entries use the local completion date, newest first. Every entry is a change, so
this file intentionally has no change-type subsections. Merge commits are not listed separately
because the evolution they integrate appears once under its work commit.

## 2026-08-24

- Carried the chart's shorthand into the two places a reader arrives from the plot: the model
  picker now prints each model's chart label under its name and matches it in its own filter box,
  and the table holds the bare variant letter in a mini-column right of the name, `(e)`, with the
  full chart label on the cell. A letter read off a mark is now something you can look up and type
  back, instead of a mark you have to recognise by position.
- Let the chart's names spend the room a zoom buys. Unzoomed nothing changes: only the best front
  wearing its line is named. Zoomed, every front on show is named, best first, and once the window
  is sparse enough that everything visible fits under the label cap, the dominated cloud is named
  too — the reason it was never named is that there are hundreds of it, which stops being true
  inside a deep window. Slot pricing still applies, so a crowded window degrades to fewer names
  rather than a carpet.
- Made an unchecked front line demote its whole tier to context: the marks now take the dominated
  cloud's grey instead of keeping a medal colour with no front to explain it. Nothing leaves the
  plot — that stays the tier picker's job — but labels, searches and the legend all follow the
  demotion: a grey mark prices and searches as cloud, the legend swatch turns grey with a note, and
  the idle names go to the best front still wearing its line.
- Reworked the filters panel after the first grouped layout read as clutter: the group captions
  floated above a second deck of control labels and the search box was orphaned on a mostly empty
  row. The groups are now a labelled rail — Axes, Filter models, Overlays, Highlight — with one
  single-line row each, control labels beside their widgets, and the utility buttons tucked into
  the Highlight row's right end. Phones keep the folded panel and stack the rail labels as section
  lines over two-column rows.
- Recorded the chart zoom and front-line picker decisions in the agent guide: the zoom is a view
  and never a filter, one finger must keep scrolling the page, the paint order is worst-front-first,
  and the labelled control groups carry the tier-versus-line distinction.
- Made closing a round explicit in the agent guide: no round ends without committing the work,
  merging it into `develop`, and pushing, so finished work is never left uncommitted and silent.
- Turned the bot's pill into a plain link and put its explanatory line beside it, on one row. The
  pill read as a button that would do something on the page, when the one thing it does is leave it;
  weight and the only primary-text colour in the header still mark it as the call to action. The
  line wraps under the link on a narrow screen rather than pushing the page sideways.

- Added zoom to the chart, aimed at phones where the whole field compacts into a few hundred
  pixels: pinch the plot to zoom, two-finger-drag to pan — one finger still scrolls the page — and
  on desktop Ctrl/⌘+scroll (a trackpad pinch arrives as exactly that) plus drag-to-pan once zoomed.
  The +/− buttons and "Reset zoom" sit at the right end of the legend, outside the plot, and double
  as the keyboard path. Zooming re-renders through the real scales rather than stretching pixels,
  so marks keep their size, ticks re-space to the window and labels re-place inside it; a live
  gesture moves a cheap transform preview and the re-render lands on release. The window is a view,
  never a filter — fronts, legend and table ignore it, it survives filter and search changes, and it
  resets when an axis metric or the log toggle changes what the units mean. Zoom is capped at 32×
  per axis, panning stops at the data's edge, and zooming all the way back out snaps to the exact
  original fit.

- Added a "Front lines" picker that toggles each Pareto front's line without touching its models —
  leave only gold checked and the silver and bronze curves disappear while every mark stays put.
  It is deliberately weaker than the tier picker, which removes a tier's models from the plot, and
  the filters row now says so structurally: the controls sit in labelled groups — "Axes", "Filter
  models", "Overlays" — with a one-line hint inside each picker spelling out which of the two
  things it does.

- Fixed the chart's stacking order where tiers crowd together: silver and bronze marks and front
  lines were painted over gold, because SVG stacks in document order and the fronts were drawn
  best-first. Both passes now paint the worst front first, so the medal hierarchy reads the right
  way up wherever points overlap.

- Separated the bot from the source link in the header. The X link and the line explaining what the
  bot posts now stack as one block, so the note can no longer read as a caption for GitHub, which
  drops to a plain secondary link. The note also survives on a phone, where it used to be hidden:
  stacked it costs one row and it is what tells a first-time reader what @AIParetoRadar is.

- Kept the model names already on the plot while a search runs. They now dim along with the marks
  and the front lines they annotate instead of disappearing, so a highlighted model is read against
  the named front it sits in. Matches are still named first and take the cleanest slots, a name may
  no longer be laid over a matched mark. The names checkbox stays the only switch, so a phone that
  has names on dims them exactly as a desktop does.
- Shortened the names the chart draws. A model's parenthesised configuration is dropped when it is
  the only variant of its name, and replaced by a letter — `Claude Opus 5 (a)` … `(e)`, ordered by
  intelligence — when there are several, so the plot no longer has to fit strings like "Claude
  Fable 5 (Adaptive Reasoning, Max Effort, Opus 4.8 Fallback)". The real name is untouched
  everywhere else and the search box matches either form. A footnote appears under the plot only
  when a shortened name is actually on screen. Coverage improved with the width: 1280px names all
  17 gold models against 15 before, and a phone names 14 where it used to fit almost none.
- Replaced latency with the release date on the chart's model card. Latency comes back whenever it
  is the metric on an axis, so the card never omits the coordinate being pointed at.
- Rewrote the page header: the title is now "The AI Pareto Frontier", the subtitle says what the
  site is for in one line instead of explaining the plotting rules, and the X bot is presented as a
  call to action rather than a footnote.
- Stopped the local server from ever fetching upstream on its own. It serves the cache whatever its
  age, so opening the page costs nothing; `cache.ttl.minutes` now only decides when data is labelled
  stale. The cloud collector already spends 24 of the 100 daily requests and the two share one key,
  so an expiring TTL was spending four more on whoever opened the page first.
- Added a "Refresh data" button as the only way to spend quota from the page, off in the hosted
  build. The route behind it is gated rather than just hidden: disabled unless
  `refresh.manual.enabled=true`, loopback only, POST only, same-origin only, and it needs a per-run
  token that is printed to the server console and never served over HTTP, so reading the page or
  poking the DOM does not grant it. Concurrent clicks collapse into one upstream walk.
- Fixed the page claiming a successful refresh when the upstream call had failed and the server had
  fallen back to cached data.
- Stopped either refresh path from starting a walk the remaining quota cannot finish. The collector
  had no such check despite the architecture document describing one, so with three requests left it
  would spend them and still produce no snapshot. It now defers the pass, logs why, and hands its
  lease back; the local button answers 429 with the same reason. The decision is sized by the page
  count the last successful walk really needed, because a constant would be wrong the moment the
  dataset passes 800 models.

## 2026-08-15

- Synchronized model and creator filters with the visible chart: the initial model checks now match
  the three fronts plus 30 runners, explicit additions stay visible, and creator checks reflect all,
  some, or none of their selected models.
- Improved the responsive chart layout, frontier lines, desktop height, small-laptop minimum height,
  phone space allocation, and vertical label clearance around extreme points.
- Experimented with a fourth Pareto tier, first named Brown and then Chocolate, before standardising
  the displayed chart on the three medal tiers: Gold, Silver, and Bronze.
- Made verified commits push automatically and documented the `npm.cmd` workaround for restricted
  PowerShell policies.
- Renamed the project and public page from Artificial Analyzer to AI Pareto, while keeping AI Pareto
  Radar as the bot brand.
- Provisioned branded Firebase Hosting, deployed the web application to AI Pareto Hosting, and kept
  the legacy Hosting site available for existing links.
- Documented the free API tier, named the model inventory after its source API, and clarified the
  three-tier palette and small-screen behaviour.
- Restricted bot publications to meaningful arrivals and promotions, adopted the agreed post template,
  and kept one post per movement while retaining a tested digest fallback.
- Improved X publication reliability with OAuth reconciliation guidance, strict URL encoding for
  parentheses, link-card previews, and realistic replay of live arrivals.
- Recorded the live collector status, the X publisher handoff procedure, and an auditable trail for
  data refreshes, Pareto movements, and publication decisions.
- Made Logs Explorer the primary operational log viewer and added project-management links.
- Added collision-aware relevant model names to the chart, a names switch, a guaranteed label for the
  strongest frontier model, and front-line-aware label placement.
- Added bounded dominated-model context: the three fronts plus the 30 models closest to joining one,
  with searchable creators and models and matching table coverage.
- Let `PORT` override the local API configuration to allow concurrent local server instances.
- Renamed the chart-label control to "Relevant model names", made tier, creator, and model filter
  checks reflect their active state, and moved the Y-axis title beside the plot on wide screens.
- Made movement posts read naturally in English by having arrivals join and promotions move up to
  named Pareto frontiers.
- Corrected the table's tier ordinals to the English forms `1st`, `2nd`, and `3rd`.
- Updated the production collector and X publisher to their current digest-pinned images.
- Added this changelog and established `develop` as the integration branch, stable `main` for releases
  and deployments, and dated `feature/` and `fix/` branches shared by all AI coding agents.
- Standardised the neutral branch names as `feature/YYYYMMDD-<brief-name>` and
  `fix/YYYYMMDD-<brief-name>`.
- Completed the historical changelog review and adopted one unclassified list of changes per date.

## 2026-08-14

- Scaffolded the multi-subproject repository, root documentation, ignore rules, and the tracked
  `CLAUDE.md` compatibility pointer.
- Established `AGENTS.md` as the shared agent guide and set English as the language for public source,
  documentation, UI copy, and commit messages.
- Added the local cached API proxy, the static Pareto-tier web application, and the initial
  event-driven production architecture.
- Implemented the deterministic collector snapshot core, four-hour Cloud Scheduler refreshes, and
  recoverable Cloud Run collector behaviour.
- Defined the AI Pareto Radar brand and the reproducible Google Cloud infrastructure, including
  remote Terraform state protection.
- Added local X API credential documentation, OAuth account authorisation, an idempotent X publisher,
  and its private Pub/Sub delivery path.
- Switched hosted web reads to immutable snapshots, provisioned Firebase Hosting, and aligned Cloud
  Storage JSON content types.
- Kept Cloud Build contexts free of local files, ignored Firebase deployment cache, and supported
  Windows secret uploads.
- Stored Pareto tiers in a Firestore-safe representation.
