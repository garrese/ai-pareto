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
 * Whether a burst collapses into a single digest post instead of one post per
 * movement.
 *
 * **Off** since 2026-08-15 at the user's request: every arrival and every
 * promotion gets its own post, however many land in one scan. The digest path
 * is deliberately kept alive rather than deleted — `digestEvent` in `events.js`
 * and `digestLines` in `render.js`, both still under test — so switching back
 * is this one line.
 */
export const DIGEST_BURSTS = false;

/**
 * How many movements a scan may publish individually before the digest takes
 * over, when `DIGEST_BURSTS` is on. A normal four-hour scan yields zero or one;
 * a burst means Artificial Analysis re-scored the catalogue wholesale.
 */
export const MAX_POSTS_PER_SCAN = 4;
