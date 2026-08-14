/** Rounds to `decimals` and drops trailing zeros, so ticks read `$0.02`, not `$0.020`. */
const trim = (value, decimals) => String(Number(value.toFixed(decimals)));

/** The four free-tier metrics worth trading off, and how each one is "better". */
export const METRICS = {
  intelligence: {
    key: 'intelligence',
    label: 'Intelligence',
    axisLabel: 'Artificial Analysis Intelligence Index',
    short: 'Intelligence',
    dir: 'max',
    scale: 'linear',
    format: (v) => v.toFixed(1),
  },
  price: {
    key: 'price',
    label: 'Price per token',
    axisLabel: 'USD per 1M tokens (3:1 blended)',
    short: 'Price',
    dir: 'min',
    scale: 'log',
    format: (v) => `$${trim(v, v >= 10 ? 0 : v >= 1 ? 2 : 3)}`,
  },
  costPerTask: {
    key: 'costPerTask',
    label: 'Cost per task',
    axisLabel: 'USD per Intelligence Index task',
    short: 'Cost/task',
    dir: 'min',
    scale: 'log',
    format: (v) => `$${trim(v, v >= 1 ? 2 : 4)}`,
  },
  speed: {
    key: 'speed',
    label: 'Speed',
    axisLabel: 'Median output speed (tokens/s)',
    short: 'Speed',
    dir: 'max',
    scale: 'log',
    format: (v) => `${v.toFixed(0)} t/s`,
  },
  ttft: {
    key: 'ttft',
    label: 'Latency',
    axisLabel: 'Median time to first token (s)',
    short: 'Latency',
    dir: 'min',
    scale: 'log',
    format: (v) => `${trim(v, 2)} s`,
  },
};

/** Tier names use English colour labels; the fourth colour is a chocolate brown. */
export const TIERS = [
  { name: 'Gold', description: 'Pareto front 1' },
  { name: 'Silver', description: 'Pareto front 2' },
  { name: 'Bronze', description: 'Pareto front 3' },
  { name: 'Brown', description: 'Pareto front 4' },
];

export const objectiveFor = (metricKey) => ({
  value: (model) => model[metricKey],
  dir: METRICS[metricKey].dir,
});
