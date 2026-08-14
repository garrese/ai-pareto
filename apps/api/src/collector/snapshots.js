import { sha256 } from './canonical.js';
import { createParetoRepresentation } from './pareto.js';

const SCHEMA_VERSION = 1;

function assertIsoDate(value, field) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-8601 date string`);
  }
}

function canonicalModels(models) {
  const byId = new Map();
  for (const model of models) {
    if (typeof model?.id !== 'string' || model.id.length === 0) {
      throw new Error('Every model requires a non-empty string ID');
    }
    if (byId.has(model.id)) {
      throw new Error(`Duplicate model ID: ${model.id}`);
    }
    byId.set(model.id, model);
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Produces the three public JSON payloads without performing any I/O. Cloud
 * Storage and local-disk publishers can therefore share the same contract.
 */
export function createSnapshotArtifacts({
  models,
  fetchedAt,
  generatedAt = fetchedAt,
  paretoDefinitions = [],
  maxFronts = 4,
}) {
  if (!Array.isArray(models)) throw new Error('models must be an array');
  assertIsoDate(fetchedAt, 'fetchedAt');
  assertIsoDate(generatedAt, 'generatedAt');

  const sortedModels = canonicalModels(models);
  const modelsContent = {
    schemaVersion: SCHEMA_VERSION,
    fetchedAt,
    generatedAt,
    modelCount: sortedModels.length,
    models: sortedModels,
  };
  const paretoContent = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    fronts: createParetoRepresentation(sortedModels, paretoDefinitions, maxFronts),
  };
  const snapshotId = `snapshot-${sha256({ models: modelsContent, pareto: paretoContent }).slice(0, 24)}`;
  const basePath = `public/snapshots/${snapshotId}`;

  const modelsDocument = {
    ...modelsContent,
    snapshotId,
  };
  const paretoDocument = {
    ...paretoContent,
    snapshotId,
  };
  const latestDocument = {
    schemaVersion: SCHEMA_VERSION,
    snapshotId,
    fetchedAt,
    publishedAt: generatedAt,
    modelCount: sortedModels.length,
    modelsPath: `${basePath}/models.json`,
    paretoPath: `${basePath}/pareto.json`,
  };

  return {
    snapshotId,
    immutableObjects: [
      { path: latestDocument.modelsPath, body: modelsDocument },
      { path: latestDocument.paretoPath, body: paretoDocument },
    ],
    manifestObject: { path: 'public/latest.json', body: latestDocument },
  };
}
