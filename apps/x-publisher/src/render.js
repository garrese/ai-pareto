const POST_LIMIT = 280;

export const eventMarker = (eventId) => `[aa:${eventId.slice('sha256:'.length, 19)}]`;

const readableFront = (frontId) =>
  frontId
    .split('-')
    .map((word) => (word === 'cost' ? 'cost' : word))
    .join(' ');

const list = (label, modelIds) =>
  modelIds.length === 0 ? null : `${label} (${modelIds.length}): ${modelIds.join(', ')}`;

export function renderPost(event, publicSiteUrl = null) {
  const marker = eventMarker(event.eventId);
  const heading = `Pareto front update · ${readableFront(event.frontId)}`;
  const link = publicSiteUrl
    ? `${publicSiteUrl.replace(/\/+$/, '')}/?snapshot=${encodeURIComponent(event.toSnapshot)}`
    : null;
  const details = [
    list('Added', event.addedModelIds),
    list('Removed', event.removedModelIds),
  ].filter(Boolean);
  let text = [heading, ...details, link, marker].filter(Boolean).join('\n');

  if (Array.from(text).length > POST_LIMIT) {
    text = [
      heading,
      `Added: ${event.addedModelIds.length} · Removed: ${event.removedModelIds.length}`,
      link,
      marker,
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (Array.from(text).length > POST_LIMIT) {
    throw new Error('Rendered X post exceeds 280 characters');
  }
  return { text, marker };
}
