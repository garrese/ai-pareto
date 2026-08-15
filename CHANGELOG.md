# Changelog

This file records notable product, infrastructure, and developer-workflow evolutions made by AI
coding agents. Entries use the local completion date, newest first. Every entry is a change, so
this file intentionally has no change-type subsections. Merge commits are not listed separately
because the evolution they integrate appears once under its work commit.

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
