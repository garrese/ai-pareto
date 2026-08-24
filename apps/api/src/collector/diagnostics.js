const DIAGNOSTIC_SCHEMA_VERSION = 1;

const safePathPart = (value) =>
  String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';

const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function differingFields(occurrences) {
  const fields = new Set(occurrences.flatMap(({ model }) => Object.keys(model ?? {})));
  const differences = {};

  for (const field of [...fields].sort()) {
    const values = occurrences.map(({ model }) => model?.[field] ?? null);
    if (values.slice(1).every((value) => sameValue(value, values[0]))) continue;
    differences[field] = values;
  }

  return differences;
}

/**
 * Returns every repeated ID with the normalized variants and their page
 * positions. It does not resolve anything: rejected input must remain rejected
 * until a separate policy is agreed.
 */
export function duplicateModelDiagnostics(models, origins = []) {
  const byId = new Map();

  models.forEach((model, position) => {
    if (typeof model?.id !== 'string' || model.id.length === 0) return;
    const occurrence = {
      position,
      page: origins[position]?.page ?? null,
      pageIndex: origins[position]?.pageIndex ?? null,
      model,
    };
    const existing = byId.get(model.id);
    if (existing) existing.push(occurrence);
    else byId.set(model.id, [occurrence]);
  });

  return [...byId.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([id, occurrences]) => {
      const differences = differingFields(occurrences);
      return {
        id,
        identical: Object.keys(differences).length === 0,
        differingFields: differences,
        occurrences,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function rejectedRefreshPath({ executionId, taskAttempt, fetchedAt }) {
  const day = safePathPart(String(fetchedAt).slice(0, 10));
  const instant = safePathPart(fetchedAt);
  return (
    `rejected-refreshes/${day}/${safePathPart(executionId)}/` +
    `attempt-${safePathPart(taskAttempt)}-${instant}.json`
  );
}

export function rejectedRefreshDocument({
  executionId,
  taskAttempt,
  capturedAt,
  result,
  duplicates,
}) {
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    reason: 'duplicate-model-ids',
    executionId,
    taskAttempt,
    capturedAt,
    fetchedAt: result.fetchedAt,
    requestCount: result.pages ?? null,
    rateLimit: result.rateLimit ?? null,
    duplicates,
    normalizedModels: result.models,
    // These are the exact successful response envelopes, page by page. The API
    // key is a request header and is never part of this captured response data.
    sourcePages: result.sourcePages ?? null,
  };
}
