# Changelog

This file records notable product, infrastructure, and developer-workflow evolutions made by AI
coding agents. Entries use the local project date (`YYYY-MM-DD`), with the newest date first.

## 2026-08-15

### Added

- Added this changelog as the mandatory record of completed evolutions.
- Added searchable model selection and a bounded context layer containing the 30 dominated models
  closest to a Pareto front.

### Changed

- Made movement posts read naturally in English by having arrivals join and promotions move up to
  named Pareto frontiers.
- Adopted a `develop` integration branch, dated `feature/` and `fix/` work branches shared by all
  AI coding agents, and a stable `main` branch for releases and deployments.
- Renamed the chart-label control to "Relevant model names" to make its selective behaviour clear.
- Made tier, creator, and model checkboxes reflect their active filter state from the initial view.
- Moved the Y-axis title beside the axis on sufficiently wide screens while keeping it above the
  plot on mobile layouts.
- Updated the production collector and X publisher to their current digest-pinned images.
