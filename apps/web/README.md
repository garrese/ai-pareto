# web

Static frontend: a scatter plot of the Artificial Analysis model dataset with the first four Pareto
fronts drawn as tiers — gold, silver, bronze, chocolate.

Plain HTML, CSS and ES modules. No build step, no dependencies, no framework.

## Running

For local development, the frontend gets model data from [`apps/api`](../api/README.md). Start that
server and open <http://localhost:8787> — it serves these files directly.

To serve the frontend separately against the development API, use a query parameter:

```
http://localhost:3000/?api=http://localhost:8787
```

Outside localhost, `config.js` selects the public Cloud Storage data root. The page fetches
`public/latest.json`, validates it, and then loads the matching immutable model snapshot. You can
exercise that mode locally without editing configuration:

```
http://localhost:3000/?data=https://storage.googleapis.com/ia-models-analyzer-public-data
```

## Testing and hosting

Run the dependency-free data-source tests with `npm test`. `firebase.json` deploys this directory
as-is; there is no build output or root-level workspace involved:

```bash
firebase deploy --project ia-models-analyzer --only hosting:production
```

The `production` deploy target publishes to <https://ai-pareto.web.app>. The original
`ia-models-analyzer` Hosting site remains available for legacy links.

If Terraform had to use a non-default public bucket name, update the public `dataRoot` in
`config.js` before deployment.

## What it does

- **Axes.** Any two of intelligence, price per token, cost per task, speed and latency, defaulting
  to cost per task against intelligence. Each metric knows whether higher or lower is better, so
  the Pareto direction follows the selection.
- **Tiers.** `paretoFronts` peels four fronts by non-dominated sorting. Neighbouring models on each
  front are connected directly in metric order.
- **Highlight.** Typing in the search box rings every model whose name or creator contains the text
  and recedes the rest. It highlights rather than filters, so the fronts do not move under you.
- **Creators.** A checkbox list, so arbitrary combinations are possible. This one *does* filter, and
  the fronts are recomputed for the subset. No selection means every creator.
- **Tiers.** A checkbox list over the four fronts plus "Others (dominated)". This one only decides
  what is *drawn* — the fronts are never recomputed, because peeling gold away would promote silver
  into its place and the tiers would stop meaning anything. Hidden tiers do leave the axes, so the
  plot rescales to what is left, and the legend keeps showing their real counts struck through.
- **Table view.** The same four fronts as a table, so no value is reachable only by hovering.

The chart is drawn at the container's pixel size and redrawn when that box changes, so it fills a
wide display instead of topping out at a fixed width. Tick density follows the size.

## Files

| File | Role |
| --- | --- |
| `src/pareto.js` | Non-dominated sorting and ordered front geometry. No DOM. |
| `src/metrics.js` | The four metrics, their direction, scale and formatting. |
| `src/chart.js` | SVG scales, axes, marks and the nearest-point hover layer. |
| `src/api.js` | Selects local API or public snapshots and validates the snapshot contract. |
| `config.js` | Public production data-root configuration. |
| `src/main.js` | State, controls, legend, tooltip and table. |

## Colours

The tiers follow the medal metaphor: gold, silver, bronze, chocolate. Each mode has its own steps,
picked against its own surface.

| Tier | Light | Dark |
| --- | --- | --- |
| Gold | `#cfa81c` | `#e8c33a` |
| Silver | `#9aa3b0` | `#c3cbd6` |
| Bronze | `#a05f0e` | `#cf8720` |
| Chocolate | `#57321a` | `#8a4f2c` |

The steps were tuned until every pair is separable: worst pair ΔE 17.1 light / 15.7 dark under
normal vision, 17.0 / 14.5 under simulated protanopia and deuteranopia (OKLab ×100, floors 15 and
8). If you change a tier colour, re-check that.

Two checks the metaphor cannot pass, by construction: silver is a low-chroma grey, and chocolate is
darker than a categorical palette's lightness band allows. Both are accepted deliberately, and
neither leaves colour carrying meaning alone — the legend is always present, the tier is named in
the tooltip, and the table view lists every model by tier. The dominated cloud is kept lighter and
more transparent than silver so the two never read as the same thing.
