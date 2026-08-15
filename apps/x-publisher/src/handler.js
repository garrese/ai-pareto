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
        event: 'publisher.delivery.invalid',
        requestId,
        errorMessage: error.message,
      });
      return { statusCode: 400, outcome: 'invalid' };
    }

    const { event, messageId, deliveryAttempt } = decoded;
    const eventContext = {
      requestId,
      messageId,
      deliveryAttempt,
      eventId: event.eventId,
      eventType: event.type,
      frontId: event.frontId,
      fromSnapshot: event.fromSnapshot,
      toSnapshot: event.toSnapshot,
      modelId: event.model?.id ?? event.headline?.model?.id ?? null,
      modelName: event.model?.name ?? event.headline?.model?.name ?? null,
      tier: event.tier ?? event.headline?.tier ?? null,
      previousTier: event.previousTier ?? null,
    };
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
        event: 'publisher.delivery.duplicate',
        ...eventContext,
        postId: claim.postId,
      });
      return { statusCode: 204, outcome: 'duplicate', eventId: event.eventId };
    }
    if (claim.status === 'busy') {
      log('INFO', 'X delivery deferred because another request holds the lease', {
        event: 'publisher.delivery.busy',
        ...eventContext,
      });
      return { statusCode: 503, outcome: 'busy', eventId: event.eventId };
    }

    log('INFO', 'X delivery started', {
      event: 'publisher.delivery.started',
      ...eventContext,
    });
    try {
      const rendered = renderPost(event, publicSiteUrl);
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
        event: reconciled ? 'publisher.delivery.reconciled' : 'publisher.delivery.published',
        ...eventContext,
        postId: post.id,
      });
      return {
        statusCode: 204,
        outcome: reconciled ? 'reconciled' : 'published',
        eventId: event.eventId,
      };
    } catch (error) {
      let stateError = null;
      try {
        await deliveryStore.markFailed({
          eventId: event.eventId,
          ownerId: requestId,
          failedAt: iso(now()),
          error: error.message,
        });
      } catch (failedStateError) {
        stateError = failedStateError;
      }
      log('ERROR', 'X delivery failed', {
        event: 'publisher.delivery.failed',
        ...eventContext,
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack,
        stateErrorMessage: stateError?.message ?? null,
      });
      return { statusCode: 500, outcome: 'failed', eventId: event.eventId };
    }
  };
}
