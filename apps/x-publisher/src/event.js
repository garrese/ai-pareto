const EVENT_TYPE = 'pareto.front.changed';
const EVENT_ID = /^sha256:[a-f0-9]{64}$/;

const stringArray = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);

export function validateParetoChangeEvent(value) {
  if (!value || typeof value !== 'object') throw new Error('Event must be a JSON object');
  if (value.schemaVersion !== 1) throw new Error('Unsupported event schemaVersion');
  if (value.type !== EVENT_TYPE) throw new Error('Unsupported event type');
  if (!EVENT_ID.test(value.eventId ?? '')) throw new Error('Invalid eventId');
  if (!Number.isFinite(Date.parse(value.occurredAt))) throw new Error('Invalid occurredAt');

  for (const field of ['fromSnapshot', 'toSnapshot', 'frontId']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new Error(`Invalid ${field}`);
    }
  }
  if (!stringArray(value.addedModelIds) || !stringArray(value.removedModelIds)) {
    throw new Error('Model ID changes must be string arrays');
  }
  if (value.addedModelIds.length === 0 && value.removedModelIds.length === 0) {
    throw new Error('Pareto change event contains no changes');
  }

  return {
    schemaVersion: 1,
    eventId: value.eventId,
    type: EVENT_TYPE,
    occurredAt: value.occurredAt,
    fromSnapshot: value.fromSnapshot,
    toSnapshot: value.toSnapshot,
    frontId: value.frontId,
    addedModelIds: [...new Set(value.addedModelIds)].sort(),
    removedModelIds: [...new Set(value.removedModelIds)].sort(),
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
    event: validateParetoChangeEvent(value),
    messageId: envelope.message.messageId ?? envelope.message.message_id ?? null,
    deliveryAttempt: Number(envelope.deliveryAttempt ?? 1),
  };
}
