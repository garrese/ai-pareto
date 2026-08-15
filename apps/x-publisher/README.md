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

**The timeline read is eventually consistent.** Verified against the live API on 2026-08-15: a post
published seconds earlier was not yet returned by `GET /2/users/:id/tweets`, and the same marker was
found on a later read. Reconciliation therefore cannot catch a retry that arrives immediately — the
Firestore delivery claim is what makes redelivery safe, and reconciliation only covers the narrower
case where the process died between X accepting the post and Firestore recording its ID. A retry
inside that window may still attempt a create and be refused by X with `403` and "duplicate
content"; the next retry, by which time the timeline has caught up, reconciles and acknowledges.

## What gets posted

One post per model that **arrives** in one of the three Pareto fronts or **climbs** to a better one.
Demotions are silent — they are the wake of an arrival, and the models pushed out are already named
in the post that pushed them. Only the `cost-per-task-intelligence` front is published. Six arrivals
in one scan means six posts; a digest path exists behind `DIGEST_BURSTS` but is switched off. See
`AGENTS.md` for why each of those rules exists; they were chosen against the real dataset, not in
the abstract.

```
🥇 GPT-6 (high) enters Pareto front 1
   61.2 intelligence · $0.82/task
Displaces Grok 4.6 (high) (60.9 · $0.8367).
https://ai-pareto.web.app/?highlight=GPT-6%20%28high%29&e=ddaa419a711f
```

The link carries two things. `highlight` is read by the site into its search box, so the reader
lands with that model ringed in the chart. `e` is the event token, which is how a post is later
recognised as ours — it lives in the link rather than in the body, where it would be visible noise
on a public account. Parentheses **must** stay percent-encoded: X's link parser stops at one, and
almost every model here is named "Something (high)".

`renderPost` guarantees the result fits X's 280-character budget, counting URLs at their flat 23 and
emoji at two. When a post would overflow it sheds detail in a fixed order: the displaced model's
figures, then the subject's, then names are truncated with an ellipsis.

### Rehearsing a post

```bash
npm run sample
```

Builds a real event from the cached dataset, renders it, and prints it without sending anything.
`--name`, `--intel` and `--cost` shape the scenario; `--confirm` publishes it for real, which
requires the credentials below. Publishing twice with the same scenario reconciles against the
existing post rather than duplicating it.

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

### Authorize the bot account

The developer App belongs to the personal X account, while posts are sent as a separate bot account.
Configure the App in the Developer Console with these values:

- App permissions: **Read and write**
- App type: **Web App, Automated App or Bot** (confidential client)
- Callback URI: `http://127.0.0.1:8788/oauth/callback`
- Website URL: `https://ai-pareto.web.app`

Copy `config.properties.example` to the ignored `config.properties` and add the App API key and
secret. During the initial transition, the authorization helper can also read `x.api.key` and
`x.api.key.secret` from the API application's ignored `config.properties`. Then run:

```bash
npm run authorize
```

Open the printed URL, sign in as the bot account, and approve the App. The local callback exchanges
the temporary verifier and writes the bot access token, token secret, and numeric user ID to the
ignored publisher `config.properties`; it never prints token values. The callback only exists while
the command is running. X requires `127.0.0.1` rather than `localhost` for local callbacks.

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
