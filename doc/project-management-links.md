# Project management links

This is the operational entry point for AI Pareto Radar. It contains management consoles, public
surfaces, and documentation only. It must never contain credentials, API keys, OAuth tokens, secret
values, or signed URLs.

## Project identifiers

| Item | Value |
| --- | --- |
| Google Cloud project | `ia-models-analyzer` |
| Primary region | `europe-west1` |
| Public site | [AI Pareto](https://ai-pareto.web.app) |
| X bot | [@AIParetoRadar](https://x.com/AIParetoRadar) |
| Source repository | [garrese/ai-pareto](https://github.com/garrese/ai-pareto) |

## Google Cloud

Start with the [Google Cloud project dashboard](https://console.cloud.google.com/home/dashboard?project=ia-models-analyzer).
The links below are scoped to the production project where possible; sign in with an account that has
the appropriate project permissions.

| Area | Console link | What to inspect |
| --- | --- | --- |
| Logs | [Logs Explorer](https://console.cloud.google.com/logs/query?project=ia-models-analyzer) | Collector runs, Pareto changes, publication decisions, X delivery, and errors. This is the primary operational view. |
| Cloud Run | [Cloud Run, `europe-west1`](https://console.cloud.google.com/run?project=ia-models-analyzer&region=europe-west1) | Collector Job `artificial-analyzer-collector` and service `artificial-analyzer-x-publisher`. |
| Cloud Scheduler | [Cloud Scheduler](https://console.cloud.google.com/cloudscheduler?project=ia-models-analyzer) | The four-hour `artificial-analyzer-collector` trigger. |
| Pub/Sub topics | [Topics](https://console.cloud.google.com/cloudpubsub/topic/list?project=ia-models-analyzer) | `pareto-change-events` and `pareto-change-events-dlq`. |
| Pub/Sub subscriptions | [Subscriptions](https://console.cloud.google.com/cloudpubsub/subscription/list?project=ia-models-analyzer) | Delivery, retry, and dead-letter status for the X publisher. |
| Firestore | [Firestore](https://console.cloud.google.com/firestore?project=ia-models-analyzer) | Refresh leases, Pareto state, outbox events, and X delivery records. |
| Public snapshots | [Public data bucket](https://console.cloud.google.com/storage/browser/ia-models-analyzer-public-data?project=ia-models-analyzer) | Immutable snapshot history and the `public/latest.json` manifest. |
| Latest public manifest | [`public/latest.json`](https://storage.googleapis.com/ia-models-analyzer-public-data/public/latest.json) | Current public snapshot ID and object paths, without signing in. |
| Terraform state | [State bucket](https://console.cloud.google.com/storage/browser/ia-models-analyzer-terraform-state?project=ia-models-analyzer) | Terraform backend. Do not edit, delete, or manually upload state objects. |
| Firebase | [Firebase project overview](https://console.firebase.google.com/project/ia-models-analyzer/overview) | Hosting releases, domains, and usage for the public site. |
| Secret Manager | [Secrets](https://console.cloud.google.com/security/secret-manager?project=ia-models-analyzer) | Secret metadata and versions. Never copy secret values into tickets, logs, commits, or this document. |
| Artifact Registry | [Artifacts](https://console.cloud.google.com/artifacts?project=ia-models-analyzer) | Digest-pinned collector and publisher images. |
| Cloud Build | [Build history](https://console.cloud.google.com/cloud-build/builds?project=ia-models-analyzer) | Image build status and logs. |
| IAM | [IAM](https://console.cloud.google.com/iam-admin/iam?project=ia-models-analyzer) | Service accounts and least-privilege bindings. |
| Monitoring | [Monitoring overview](https://console.cloud.google.com/monitoring?project=ia-models-analyzer) | Alerting and operational metrics. |
| Billing | [Billing](https://console.cloud.google.com/billing?project=ia-models-analyzer) | Budget alerts and cost review. |

### Logs Explorer filters

Use these filters after choosing the desired time range. Expand a result to inspect the structured
`jsonPayload`.

| Purpose | Filter |
| --- | --- |
| Real model-data changes | `jsonPayload.event="data.refresh.changed"` |
| Pareto-front changes | `jsonPayload.event="pareto.front.changed"` |
| Publication path | `jsonPayload.event=~"^pareto\\.publication\\.|^publisher\\.delivery\\."` |
| Errors from both components | `severity>=ERROR` and `(jsonPayload.component="collector" OR jsonPayload.component="x-publisher")` |
| One decision end to end | `jsonPayload.eventId="sha256:..."` |

The detailed audit events are emitted by the current collector and publisher source; deploy their
current images before expecting the new event fields in production logs.

## X

| Area | Link | Purpose |
| --- | --- | --- |
| Developer Console | [X Developer Console](https://console.x.com) | Manage the developer account, projects, apps, access settings, and usage. X requires sign-in. |
| Bot account | [@AIParetoRadar](https://x.com/AIParetoRadar) | Review the public bot profile and published posts. |
| X API documentation | [X API documentation](https://docs.x.com/x-api) | API reference and platform guidance. |

## Artificial Analysis

| Area | Link | Purpose |
| --- | --- | --- |
| Data API | [Artificial Analysis Data API](https://artificialanalysis.ai/data-api) | Account entry point and API-key management. |
| API reference | [Data API documentation](https://artificialanalysis.ai/data-api/docs) | Endpoint, authentication, rate-limit, and data-convention reference. |
| Model data | [Artificial Analysis](https://artificialanalysis.ai) | Source dataset and model-analysis site. |

## Repository runbooks

- [Cloud infrastructure guide](../infra/gcp/README.md) — deployment and Logs Explorer workflow.
- [X bot finishing runbook](finish-x-bot.md) — publisher deployment and authorization steps.
- [Target architecture](architecture.md) — component responsibilities and failure handling.
- [Public API inventory](aa-free-api-inventory.md) — fields available from the free Artificial Analysis endpoint.
