/**
 * Objective sets whose Pareto fronts are persisted for change detection.
 *
 * Only `cost-per-task-intelligence` is announced on X. `price-intelligence`
 * covers 380 models against 136 and moves far more often, so it is kept as
 * stored state — useful for the site and for later analysis — without being a
 * publication stream. Set `published: true` on another entry to add one.
 */
export const MONITORED_PARETO_FRONTS = [
  {
    frontId: 'cost-per-task-intelligence',
    published: true,
    objectives: [
      { key: 'costPerTask', dir: 'min' },
      { key: 'intelligence', dir: 'max' },
    ],
  },
  {
    frontId: 'price-intelligence',
    published: false,
    objectives: [
      { key: 'price', dir: 'min' },
      { key: 'intelligence', dir: 'max' },
    ],
  },
];

/**
 * How many fronts are peeled, everywhere. Matches the gold/silver/bronze ramp
 * the site draws; a fourth front was dropped on 2026-08-15 for adding noise
 * rather than signal. Changing this changes what the bot can announce.
 */
export const TIER_COUNT = 3;

/**
 * Above this many publishable movements in a single scan, the collector emits
 * one digest instead of the individual posts. A normal four-hour scan yields
 * zero or one; a burst means Artificial Analysis re-scored the catalogue, and
 * nobody wants twenty near-identical posts in one minute.
 */
export const MAX_POSTS_PER_SCAN = 4;
