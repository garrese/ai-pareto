/**
 * Objective sets whose outermost Pareto front is persisted for change
 * detection. They cover both affordability views exposed by the web app.
 */
export const MONITORED_PARETO_FRONTS = [
  {
    frontId: 'cost-per-task-intelligence',
    objectives: [
      { key: 'costPerTask', dir: 'min' },
      { key: 'intelligence', dir: 'max' },
    ],
  },
  {
    frontId: 'price-intelligence',
    objectives: [
      { key: 'price', dir: 'min' },
      { key: 'intelligence', dir: 'max' },
    ],
  },
];
