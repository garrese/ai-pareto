export class PubSubEventBus {
  constructor(pubsub, topicName) {
    this.topic = pubsub.topic(topicName);
  }

  async publish(event) {
    return this.topic.publishMessage({
      json: event,
      attributes: {
        eventId: event.eventId,
        eventType: event.type,
        schemaVersion: String(event.schemaVersion),
      },
    });
  }
}
