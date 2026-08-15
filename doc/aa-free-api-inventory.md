# Free-Tier Data Inventory

## Status

Inventory of every field the Artificial Analysis API returns on the **free** tier, and what each
field can and cannot support as a chart axis. Verified against the live API on 2026-08-15 by
probing all thirteen free endpoints — not read from the documentation, which does not state which
fields are gated. The probe cost 13 requests of the 100/24h quota.

The web app currently plots one chart: language models, intelligence against a cost metric. This
document exists to answer what else is possible without buying a higher tier.

## Field legend

Every field below appears in at least one free-tier response. Names are exactly as returned.

### Identity

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | UUID | Stable model identifier. The only safe join key across endpoints. |
| `name` | string | Display name, including the variant in parentheses — `GPT Image 2 (high)`. |
| `slug` | string | URL-safe identifier. **Not present on every endpoint** (see the table). |
| `model_creator` | object | `{ id, name }`. The free tier has no creator `slug`. |
| `release_date` | ISO date | Language endpoint only. Media endpoints do not expose it on free. |

### Arena ratings — media endpoints

| Field | Type | Meaning |
| --- | --- | --- |
| `elo` | number | Arena rating from human pairwise preference votes. Higher is better. Typical range here is roughly 1100–1400. The scale is **relative and per-arena**: an Elo of 1300 in text-to-image and 1300 in text-to-video are unrelated numbers and must never be plotted on a shared axis or compared across modalities. |
| `ci_95` | number | The 95% confidence interval on `elo`, reported as a ± margin in Elo points. `elo: 1370, ci_95: 10` means the true rating is plausibly anywhere in 1360–1380. It is a measure of **how certain the rating is**, not of quality: it narrows as the arena collects more votes for that model. Two models whose intervals overlap are statistically tied — the ranking between them is noise. Nullable. |

`ci_95` is the reason a bare Elo ranking is misleading. In text-to-image the top models sit within
about 10 points of each other while carrying margins of ±7 to ±15, so a leaderboard that prints
positions 1, 2 and 3 is asserting an order the data does not support. Any chart built on `elo`
should render the interval.

### Speech-to-speech scores

Three independent metrics, all nullable and frequently missing for a given model.

| Field | Type | Meaning |
| --- | --- | --- |
| `bba_score` | 0–1 | Big Bench Audio. Reasoning ability over spoken input. |
| `fdb_score` | 0–1 | Function-calling / dialogue benchmark score. |
| `tau_voice_score` | 0–1 | τ-bench voice: agentic task completion in a voice setting. Much harsher than the other two — observed values are far lower. |

### Speech-to-text score

| Field | Type | Meaning |
| --- | --- | --- |
| `aa_wer_index` | number | Word Error Rate index. Lower is better. **Unusable as an axis on the free tier:** of 63 models, 55 report a number, and 41 of those are exactly `0`, with a maximum of `0.3`. The free tier appears to round it, collapsing the field into a near-constant. Do not rank on it. |

### Language model fields

| Field | Type | Meaning |
| --- | --- | --- |
| `evaluations.artificial_analysis_intelligence_index` | number | Headline intelligence score. Higher is better. Version reported in the envelope (`4.1`). |
| `evaluations.artificial_analysis_coding_index` | number | Coding-specific index. Higher is better. |
| `evaluations.artificial_analysis_agentic_index` | number | Agentic-task index. Higher is better. |
| `artificial_analysis_intelligence_index_cost.cost_per_task.total_cost` | USD | Money actually spent per task while running the index, so it prices verbosity. A bill, not a rate. |
| `artificial_analysis_intelligence_index_cost.total_cost` | USD | Total spent evaluating the model across the whole index run. |
| `pricing.price_1m_input_tokens` | USD/1M | Input token rate. |
| `pricing.price_1m_output_tokens` | USD/1M | Output token rate. |
| `pricing.price_1m_cache_hit_tokens` | USD/1M | Cached-read rate. Coverage not yet measured; `null` in the sampled records. |
| `pricing.price_1m_cache_write_tokens` | USD/1M | Cache-write rate. Same caveat. |
| `performance.median_output_tokens_per_second` | tok/s | Throughput. Higher is better. |
| `performance.median_time_to_first_token_seconds` | s | Latency to the first token of any kind. |
| `performance.median_time_to_first_answer_token_seconds` | s | Latency to the first token **of the answer**, which for a reasoning model excludes the thinking phase. Not currently collected. |
| `performance.median_end_to_end_response_time_seconds` | s | Total time to a complete response. The honest latency number for reasoning models. Not currently collected. |

See `AGENTS.md` for the two cost metrics and the `0`-means-missing quirk, which are not repeated
here.

## Endpoint inventory

All media endpoints are unpaginated — the envelope is just `{"tier":"free"}`, so one request each,
eleven requests to cover every modality. The language endpoint is paginated at 200 per page.

| Endpoint (prefix `/api/v2`) | Models | Metric fields | Identity fields | Second axis? |
| --- | ---: | --- | --- | --- |
| `/media/text-to-image/models/free` | 148 | `elo`, `ci_95` | + `slug` | No |
| `/media/image-editing/models/free` | 67 | `elo`, `ci_95` | + `slug` | No |
| `/media/text-to-video/models/free` | 78 | `elo`, `ci_95` | + `slug` | No |
| `/media/image-to-video/models/free` | 72 | `elo`, `ci_95` | + `slug` | No |
| `/media/text-to-video-audio/models/free` | 28 | `elo`, `ci_95` | + `slug` | No |
| `/media/image-to-video-audio/models/free` | 29 | `elo`, `ci_95` | + `slug` | No |
| `/media/text-to-speech/models/free` | 93 | `elo`, `ci_95` | + `slug` | No |
| `/media/speech-to-speech/models/free` | 37 | `bba_score`, `fdb_score`, `tau_voice_score` | + `slug` | **Yes — three** |
| `/media/speech-to-text/models/free` | 63 | `aa_wer_index` | no `slug` | No (and unusable) |
| `/media/music/instrumental/models/free` | 18 | `elo`, `ci_95` | no `slug` | No |
| `/media/music/with-vocals/models/free` | 15 | `elo`, `ci_95` | no `slug` | No |
| `/language/models/free` | 608 | see the language table above | + `slug`, `release_date` | Yes — many |

"Second axis?" is the question that decides whether the existing scatter chart can be reused: a
Pareto front needs two metrics to trade off, and ten of the eleven media endpoints expose only one.

## Pro-only fields

Present in the documented schema, absent from every free response we probed. They are listed
because they are exactly what an intelligence-versus-cost chart per modality would need.

| Field | Where | Why it matters |
| --- | --- | --- |
| `price_per_1k_images` | text-to-image, image-editing | The missing cost axis for image models. |
| `price_per_minute` | the four video endpoints | The missing cost axis for video models. |
| `price_per_1m_characters` | text-to-speech | The missing cost axis for speech synthesis. |
| `price_per_1k_minutes`, `median_speed_factor` | speech-to-text | Cost and speed per provider. |
| `price_per_hour_input/output`, `time_to_first_audio_seconds` | speech-to-speech | Cost and latency per provider. |
| `rank`, `samples` | ranked endpoints | `samples` is the vote count behind `ci_95`. |
| `release_date` | media endpoints | Would enable a quality-over-time view per modality. |
| `open_weights_url` | most | Open-weight filtering. |
| `categories`, `genres` | image/video, music | Per-category Elo breakdowns. |

## What this permits

### Not possible on the free tier

An intelligence-versus-cost Pareto chart for any media modality. There is no cost field, and Elo
alone cannot form a front. This requires Pro.

### Possible, reusing the existing chart

**Cross-arena Pareto.** Some models are rated in two arenas, and the two Elo values form a genuine
two-axis trade-off within a comparable population. `pareto.js`, the medal tiers and both pickers
work unchanged; only the axis pair differs. Observed overlaps:

- text-to-image × image-editing — GPT Image 2 scores 1370 and 1257
- text-to-video × image-to-video — Gemini Omni Flash scores 1324 and 1368
- text-to-video × text-to-video-audio
- music instrumental × music with-vocals

Because the two axes are separate arena scales, the chart must label them as such and must not
imply that a diagonal means parity.

**Speech-to-speech.** The only media endpoint with several native metrics, so it takes a Pareto
front directly — `bba_score` against `tau_voice_score` is the widest-spread pair. Nulls are common
and must be filtered as missing, exactly as the language chart already does.

### Possible, but a different chart type

**Interval ranking.** For the single-axis modalities, a dot plot of `elo` with a `ci_95` error bar
is the correct rendering: it ranks the models while showing which neighbours are statistically
tied. This is not a Pareto front and should not borrow the medal tiers.

**Creator-by-modality heatmap.** Best Elo per creator across all eleven lists. This is the view
that justifies collecting every modality rather than a few.

### Already collected, not yet exposed

`aa-client.js` normalises three fields that `apps/web/src/metrics.js` never surfaces as axes. No
API cost to use them; coverage measured against the current 608-model cache:

| Metric | Models with the metric | With `price` | With `costPerTask` |
| --- | ---: | ---: | ---: |
| `codingIndex` | 220 | 172 | — |
| `agenticIndex` | 154 | 141 | 132 |
| `evalTotalCost` | 132 | — | — |

Two further language fields are not collected at all:
`median_time_to_first_answer_token_seconds` and `median_end_to_end_response_time_seconds`. The
latter is a more faithful latency axis than `median_time_to_first_token_seconds` for reasoning
models, which can spend most of their wall-clock time before the first answer token.

## Recommended order

1. Expose Coding Index and Agentic Index as axes in `metrics.js`. Three new Pareto fronts, zero
   API cost, no new collection path.
2. Collect `median_end_to_end_response_time_seconds` and offer it as a latency axis.
3. Add one media modality as a second chart. Text-to-image × image-editing is the best candidate:
   the largest populations and a real overlap.
4. Evaluate Pro only if per-modality cost charts are the actual goal.
