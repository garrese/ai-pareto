# x-publisher

Private Cloud Run service that receives authenticated Pub/Sub push deliveries and publishes Pareto
front changes to X. It is an independent application with its own package, tests, container, and
Cloud Build definition.

The service validates the versioned domain event, claims its deterministic `eventId` in Firestore,
and acknowledges already-sent events without calling X. Before creating a post it checks the
authenticated user's recent timeline for a short stable marker. This reconciles the failure window
where X accepts a post but the service stops before Firestore records the returned post ID.

X does not provide a downstream idempotency key for this endpoint. Timeline reconciliation narrows
the duplicate window but cannot justify a distributed exactly-once guarantee.

## Authentication

Posting uses OAuth 1.0a User Context, supported by `POST /2/tweets`. Configure a developer App and
user access token with permission to read and write posts. Production exposes each credential from a
separate Secret Manager secret:

| Environment variable | Meaning |
| --- | --- |
| `X_API_KEY` | OAuth consumer key. |
| `X_API_SECRET` | OAuth consumer secret. |
| `X_ACCESS_TOKEN` | User access token. |
| `X_ACCESS_TOKEN_SECRET` | User access token secret. |
| `X_USER_ID` | Numeric ID of the authenticated X user. |
| `GOOGLE_CLOUD_PROJECT` | Project containing Firestore. |
| `PUBLIC_SITE_URL` | Optional public site URL included in generated posts. |
| `X_DELIVERY_LEASE_SECONDS` | Optional Firestore lease duration; defaults to 300. |
| `PORT` | HTTP port supplied by Cloud Run; defaults to 8080 locally. |

Never put credential values in this directory, Terraform variables, container layers, or logs.

## Endpoints

- `POST /pubsub/x` accepts the standard Pub/Sub push envelope.
- `GET /health` returns `{ "ok": true }`.

Cloud Run IAM authenticates the push identity before the request reaches the container. The service
must remain private; only the dedicated Pub/Sub push service account receives `roles/run.invoker`.
Invalid events and repeated delivery failures return non-success responses so Pub/Sub can retry and
eventually route them to the dead-letter topic.

## Development

```bash
npm install
npm test
docker build -t artificial-analyzer-x-publisher .
```

Tests use in-memory boundaries and never call Firestore or X.
