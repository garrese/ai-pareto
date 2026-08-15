/**
 * Renders — and, with `--confirm`, actually publishes — one post built from the
 * real cached dataset.
 *
 * This is the end-to-end rehearsal for a change nobody wants to discover in
 * production. Everything on the message path is the real thing: the collector's
 * snapshot and change detection, the renderer, the X client and its OAuth. Only
 * the transport around it is skipped, because Pub/Sub and the Firestore
 * delivery lease move the message without altering a character of it.
 *
 * Duplicate protection still applies: the post carries its event marker and the
 * timeline is checked for that marker first, so running this twice with the
 * same scenario reports the existing post instead of publishing a second one.
 *
 * It imports the collector out of apps/api, which breaks the rule that each app
 * is self-contained. That is the point — a rehearsal against a reimplementation
 * would prove nothing — and it is safe because the Dockerfile copies only
 * `src`, so nothing under `scripts/` reaches the deployed image.
 *
 *   node scripts/publish-sample.mjs                          # dry run
 *   node scripts/publish-sample.mjs --name "GPT-6 (high)"    # dry run, custom
 *   node scripts/publish-sample.mjs --confirm                # really posts
 */
import { readFile } from 'node:fs/promises';

import { createParetoChangeEvents } from '../../api/src/collector/events.js';
import { MONITORED_PARETO_FRONTS, TIER_COUNT } from '../../api/src/collector/definitions.js';
import { createSnapshotArtifacts } from '../../api/src/collector/snapshots.js';
import { renderPost, weightedLength } from '../src/render.js';
import { XClient } from '../src/x-client.js';

const CACHE_URL = new URL('../../api/.cache/models.json', import.meta.url);
const CONFIG_URL = new URL('../config.properties', import.meta.url);
const OCCURRED_AT = '2026-01-01T00:00:00.000Z';

function parseArguments(argv) {
  const options = { confirm: false, name: 'GPT-6 (high)', intelligence: 61.2, cost: 0.82 };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--confirm') options.confirm = true;
    else if (flag === '--name') options.name = argv[++index];
    else if (flag === '--intel') options.intelligence = Number(argv[++index]);
    else if (flag === '--cost') options.cost = Number(argv[++index]);
    else if (flag === '--site') options.site = argv[++index];
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!Number.isFinite(options.intelligence) || !Number.isFinite(options.cost)) {
    throw new Error('--intel and --cost must be numbers');
  }
  return options;
}

const parseProperties = (source) =>
  Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );

const paretoOf = (models) =>
  createSnapshotArtifacts({
    models,
    fetchedAt: OCCURRED_AT,
    generatedAt: OCCURRED_AT,
    paretoDefinitions: MONITORED_PARETO_FRONTS,
    maxFronts: TIER_COUNT,
  }).immutableObjects.find(({ path }) => path.endsWith('/pareto.json')).body;

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const cache = JSON.parse(await readFile(CACHE_URL, 'utf8'));
  const models = cache.models ?? cache.data ?? [];
  if (models.length === 0) throw new Error('The API cache is empty — run the API server once first');

  const invented = {
    id: 'sample-publish-rehearsal',
    name: options.name,
    creator: 'Sample',
    creatorId: 'sample',
    intelligence: options.intelligence,
    costPerTask: options.cost,
    price: null,
    speed: null,
    ttft: null,
  };

  const events = createParetoChangeEvents({
    previous: paretoOf(models),
    current: paretoOf([...models, invented]),
    models: [...models, invented],
    definitions: MONITORED_PARETO_FRONTS,
    occurredAt: OCCURRED_AT,
  });

  if (events.length === 0) {
    console.log(
      `"${options.name}" at ${options.intelligence} / $${options.cost} does not reach any of the ` +
        `top ${TIER_COUNT} fronts, so there is nothing to publish. Try a lower --cost.`,
    );
    process.exitCode = 1;
    return;
  }

  const properties = parseProperties(await readFile(CONFIG_URL, 'utf8').catch(() => ''));
  const site = options.site ?? properties['public.site.url'] ?? 'https://ai-pareto.web.app';
  const [event] = events;
  const { text, marker } = renderPost(event, site);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(text);
  console.log(`${'─'.repeat(60)}`);
  console.log(`${weightedLength(text)}/280 characters · event ${event.type} · marker ${marker}`);

  if (!options.confirm) {
    console.log('\nDry run. Nothing was sent. Add --confirm to publish this for real.');
    return;
  }

  const credentials = {
    consumerKey: properties['x.api.key'],
    consumerSecret: properties['x.api.secret'],
    accessToken: properties['x.access.token'],
    accessTokenSecret: properties['x.access.token.secret'],
  };
  const userId = properties['x.user.id'];
  if (!userId || Object.values(credentials).some((value) => !value)) {
    throw new Error('config.properties is missing X credentials — run `npm run authorize` first');
  }

  const client = new XClient({ credentials, userId });
  const existing = await client.findPostByMarker(marker);
  if (existing) {
    console.log(`\nAlready published as ${existing.id}; not posting again.`);
    return;
  }

  const post = await client.createPost(text);
  console.log(`\nPublished as ${post.id} → https://x.com/i/status/${post.id}`);
}

await main();
