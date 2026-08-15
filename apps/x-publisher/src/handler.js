import { decodePubSubEnvelope } from './event.js';
import { renderPost } from './render.js';

const iso = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Publisher clock returned an invalid date');
  return date.toISOString();
};

export function createPushHandler({
  deliveryStore,
  xClient,
  leaseSeconds,
  publicSiteUrl = null,
  now = () => new Date(),
  log = () => {},
}) {
  return async function handlePush(envelope, requestId) {
    let decoded;
    try {
      decoded = decodePubSubEnvelope(envelope);
    } catch (error) {
      log('WARNING', 'Rejected invalid Pub/Sub event', {
        requestId,
        errorMessage: error.message,
      });
      return { statusCode: 400, outcome: 'invalid' };
    }

    const { event, messageId, deliveryAttempt } = decoded;
    const claimedAt = iso(now());
    const leaseExpiresAt = iso(new Date(Date.parse(claimedAt) + leaseSeconds * 1000));
    const claim = await deliveryStore.claim({
      eventId: event.eventId,
      ownerId: requestId,
      claimedAt,
      leaseExpiresAt,
    });

    if (claim.status === 'sent') {
      log('INFO', 'Duplicate Pub/Sub event acknowledged', {
        requestId,
        messageId,
        eventId: event.eventId,
        postId: claim.postId,
      });
      return { statusCode: 204, outcome: 'duplicate', eventId: event.eventId };
    }
    if (claim.status === 'busy') {
      return { statusCode: 503, outcome: 'busy', eventId: event.eventId };
    }

    const rendered = renderPost(event, publicSiteUrl);
    try {
      let post = await xClient.findPostByMarker({
        token: rendered.token,
        textMarker: rendered.marker,
      });
      const reconciled = post !== null;
      if (!post) post = await xClient.createPost(rendered.text);

      await deliveryStore.markSent({
        eventId: event.eventId,
        ownerId: requestId,
        postId: post.id,
        sentAt: iso(now()),
        reconciled,
      });
      log('INFO', reconciled ? 'Existing X post reconciled' : 'X post published', {
        requestId,
        messageId,
        deliveryAttempt,
        eventId: event.eventId,
        frontId: event.frontId,
        eventType: event.type,
        postId: post.id,
      });
      return {
        statusCode: 204,
        outcome: reconciled ? 'reconciled' : 'published',
        eventId: event.eventId,
      };
    } catch (error) {
      await deliveryStore
        .markFailed({
          eventId: event.eventId,
          ownerId: requestId,
          failedAt: iso(now()),
          error: error.message,
        })
        .catch(() => {});
      log('ERROR', 'X delivery failed', {
        requestId,
        messageId,
        deliveryAttempt,
        eventId: event.eventId,
        errorName: error.name,
        errorMessage: error.message,
      });
      return { statusCode: 500, outcome: 'failed', eventId: event.eventId };
    }
  };
}
