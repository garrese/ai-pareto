const MOVE_TYPE = 'pareto.model.moved';
const DIGEST_TYPE = 'pareto.scan.digest';
const EVENT_ID = /^sha256:[a-f0-9]{64}$/;

const isText = (value) => typeof value === 'string' && value.length > 0;

function readModel(value, field) {
  if (!value || typeof value !== 'object') throw new Error(`Invalid ${field}`);
  if (!isText(value.id) || !isText(value.name)) throw new Error(`Invalid ${field} identity`);
  if (!value.metrics || typeof value.metrics !== 'object') {
    throw new Error(`Invalid ${field} metrics`);
  }
  return { id: value.id, name: value.name, metrics: { ...value.metrics } };
}

function readObjectives(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Invalid objectives');
  return value.map((objective) => {
    if (!isText(objective?.key) || !['min', 'max'].includes(objective?.dir)) {
      throw new Error('Invalid objectives');
    }
    return { key: objective.key, dir: objective.dir };
  });
}

function readTier(value, field, { max = 2 } = {}) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`Invalid ${field}`);
  return value;
}

function readCommon(value) {
  if (!value || typeof value !== 'object') throw new Error('Event must be a JSON object');
  if (value.schemaVersion !== 2) throw new Error('Unsupported event schemaVersion');
  if (!EVENT_ID.test(value.eventId ?? '')) throw new Error('Invalid eventId');
  if (!Number.isFinite(Date.parse(value.occurredAt))) throw new Error('Invalid occurredAt');
  for (const field of ['fromSnapshot', 'toSnapshot', 'frontId']) {
    if (!isText(value[field])) throw new Error(`Invalid ${field}`);
  }

  return {
    schemaVersion: 2,
    eventId: value.eventId,
    occurredAt: value.occurredAt,
    fromSnapshot: value.fromSnapshot,
    toSnapshot: value.toSnapshot,
    frontId: value.frontId,
    objectives: readObjectives(value.objectives),
  };
}

export function validateParetoEvent(value) {
  const common = readCommon(value);

  if (value.type === DIGEST_TYPE) {
    if (!Number.isInteger(value.moveCount) || value.moveCount < 1) {
      throw new Error('Invalid moveCount');
    }
    if (!Array.isArray(value.perTier) || value.perTier.some((n) => !Number.isInteger(n) || n < 0)) {
      throw new Error('Invalid perTier');
    }
    return {
      ...common,
      type: DIGEST_TYPE,
      moveCount: value.moveCount,
      perTier: [...value.perTier],
      headline: {
        tier: readTier(value.headline?.tier, 'headline tier'),
        model: readModel(value.headline?.model, 'headline model'),
      },
    };
  }

  if (value.type !== MOVE_TYPE) throw new Error('Unsupported event type');

  const tier = readTier(value.tier, 'tier');
  const previousTier =
    value.previousTier === null ? null : readTier(value.previousTier, 'previousTier');
  // An arrival has no previous tier; a promotion must actually be upward, or
  // the collector's own suppression rule has been violated somewhere upstream.
  if (previousTier !== null && previousTier <= tier) {
    throw new Error('A published movement must be an arrival or a promotion');
  }
  if (!Array.isArray(value.displaced)) throw new Error('Invalid displaced');

  return {
    ...common,
    type: MOVE_TYPE,
    tier,
    previousTier,
    model: readModel(value.model, 'model'),
    displaced: value.displaced.map((entry, index) => readModel(entry, `displaced[${index}]`)),
    neighbour: value.neighbour ? readModel(value.neighbour, 'neighbour') : null,
  };
}

export function decodePubSubEnvelope(envelope) {
  const encoded = envelope?.message?.data;
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new Error('Pub/Sub envelope is missing message.data');
  }

  let value;
  try {
    value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    throw new Error('Pub/Sub message.data is not valid base64-encoded JSON');
  }

  return {
    event: validateParetoEvent(value),
    messageId: envelope.message.messageId ?? envelope.message.message_id ?? null,
    deliveryAttempt: Number(envelope.deliveryAttempt ?? 1),
  };
}
