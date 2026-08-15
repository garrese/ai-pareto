# Google Cloud infrastructure

Terraform configuration for the Artificial Analyzer platform. It manages APIs, the Firebase project
and Hosting sites, the public snapshot bucket, Firestore, Secret Manager metadata, Pub/Sub topics,
service accounts, IAM, Artifact Registry, the Cloud Run workloads, the collector's four-hour
schedule, the X push subscription and dead-letter permissions, and an optional billing budget.

Terraform never receives the Artificial Analysis key, so the value cannot enter plans or state. The
secret container is managed here; a separate script sends the ignored local value directly to Secret
Manager through `gcloud` standard input.

## Current state — 2026-08-15

The bootstrap and the collector are **applied and running**. `public/latest.json` in the public
bucket was written at 08:17:58Z, and the snapshot history shows 00:18, 04:18 and 08:17, which is the
four-hourly Cloud Scheduler doing its job. The static site is deployed and reads that data.

What is **not** deployed is the X publisher: `publisher_image` and `x_user_id` are still null, so the
Cloud Run service, the push subscription and the dead-letter subscription do not exist. Posts to X
are therefore not automated yet.

Two things will bite whoever finishes this.

**The tfvars file is git-ignored and does not exist on a fresh machine.** `deploy_collector` is
`var.collector_image != null`, so copying `production.tfvars.example` and applying it as-is would
**destroy the running collector Job and its Scheduler**. Read the live digest out of state first and
put it back in the file before planning:

```bash
terraform init
terraform state show 'google_cloud_run_v2_job.collector[0]' | grep -m1 'image '
```

Then read every line of `terraform plan` before applying. A plan that destroys anything under
`google_cloud_run_v2_job.collector` or `google_cloud_scheduler_job.collector` is wrong.

**The deployed collector still emits v1 events.** The event contract moved to schemaVersion 2 on
2026-08-15 (one post per model arrival or promotion, carrying names and metrics). The publisher
rejects anything else, and a rejected event is retried and then dead-lettered. So the collector image
must be rebuilt from current `main` **before** the publisher's push subscription exists, or the first
real change detected will land in the dead-letter topic instead of on X. Order: rebuild and apply the
collector, then enable the publisher.

## Prerequisites

- Terraform 1.8 or newer.
- Google Cloud CLI authenticated to the existing `ia-models-analyzer` project.
- Permission to manage the listed project resources and billing budgets when enabled.

Cloud Shell already provides the Google Cloud CLI and is a convenient place to install or run
Terraform if neither tool is installed locally.

For local use, authenticate Terraform with Application Default Credentials:

```bash
gcloud auth application-default login
gcloud config set project ia-models-analyzer
```

## Remote state bootstrap

Terraform stores production state in the private
`gs://ia-models-analyzer-terraform-state/platform/production` backend. The bucket must exist before
`terraform init`, so it is the one deliberately out-of-band bootstrap resource. Create it once with
public access prevention, uniform access, seven-day soft deletion, and object versioning:

```bash
gcloud services enable storage.googleapis.com --project=ia-models-analyzer
gcloud storage buckets create gs://ia-models-analyzer-terraform-state \
  --project=ia-models-analyzer \
  --location=europe-west1 \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --soft-delete-duration=7d
gcloud storage buckets update gs://ia-models-analyzer-terraform-state --versioning
```

The production bucket already exists. Object versioning and backend locking protect the state from
accidental overwrites and concurrent Terraform runs. A fork using another Google Cloud project must
create its own globally unique state bucket and update the backend block in `versions.tf`.

## Phase 1: bootstrap infrastructure

Copy the example values into an ignored local file and review the permanent locations carefully.
Firestore's location cannot be changed after creation.

```bash
cp production.tfvars.example production.auto.tfvars
terraform init
terraform plan
terraform apply
```

With `collector_image = null`, the first apply creates the supporting infrastructure but not the
Cloud Run Job or Scheduler. The X publisher remains disabled while `publisher_image` and `x_user_id`
are null. It also enables Firebase on the existing Google Cloud project and creates its permanent
default Hosting site. The public bucket defaults to `<project-id>-public-data`. Set
`firebase_site_id` to create a separate branded site while retaining the project-ID URL for legacy
links.

Adding Firebase to a Google Cloud project is permanent. The Hosting site uses an abandon policy so
removing it from Terraform cannot delete the live site. If either resource already exists, import it
before applying rather than attempting to recreate it:

```bash
terraform import google_firebase_project.platform projects/ia-models-analyzer
terraform import google_firebase_hosting_site.web projects/ia-models-analyzer/sites/ia-models-analyzer
terraform import 'google_firebase_hosting_site.branded[0]' projects/ia-models-analyzer/sites/ai-pareto
```

Add the local API key as a Secret Manager version without placing it in Terraform state or command
history:

```bash
node scripts/add-aa-secret.mjs ia-models-analyzer
```

## Build the collector image

From this directory, choose a tag derived from the Git commit and submit `apps/api` as the isolated
Cloud Build context. The custom builder identity is created by the first Terraform apply.

```bash
IMAGE="$(terraform output -raw artifact_repository)/collector:$(git rev-parse --short HEAD)"
gcloud builds submit ../../apps/api \
  --config=../../apps/api/cloudbuild.yaml \
  --substitutions="_IMAGE=${IMAGE}" \
  --service-account="$(terraform output -raw builder_service_account)"
```

Resolve the pushed tag to its immutable digest:

```bash
DIGEST="$(gcloud artifacts docker images describe "${IMAGE}" --format='value(image_summary.digest)')"
echo "${IMAGE}@${DIGEST}"
```

Put that complete digest URL in the ignored `production.auto.tfvars` as `collector_image`, then run
`terraform plan` and `terraform apply` again. Terraform creates one-task Cloud Run execution with two
task retries and Cloud Scheduler invokes it at minute 17 every four hours in UTC.

## Enable the X publisher later

The bootstrap apply already creates four empty X Secret Manager containers. When an X developer App
and OAuth 1.0a user token are available, copy `apps/x-publisher/config.properties.example` to the
ignored `config.properties`, fill it locally, and stream the four values to Secret Manager:

```bash
node scripts/add-x-secrets.mjs ia-models-analyzer
```

Build `apps/x-publisher` with its own `cloudbuild.yaml`, resolve the tag to a digest exactly as for
the collector, and set `publisher_image` plus the numeric `x_user_id` in `production.auto.tfvars`.
The next apply creates a private scale-to-zero Cloud Run service, authenticated Pub/Sub push, retry
policy, and a retained pull subscription for dead-letter inspection and replay. Do not grant
`allUsers` permission to the publisher service.

## Deploy the static web application

After the collector has published its first snapshot, deploy the dependency-free frontend from its
own subproject. Terraform creates the Hosting site; the Firebase CLI uploads the files and creates a
release:

```bash
cd ../../apps/web
firebase deploy --project ia-models-analyzer --only hosting:production
```

The `production` deploy target in `apps/web/.firebaserc` selects the branded site. The command
prints the same URL available as the `firebase_hosting_url` Terraform output.

## Inspect operational and publication logs

The collector Job and X publisher service both write structured JSON to standard output. Cloud Run
ingests those entries into Cloud Logging automatically; no extra log sink or logging service is
needed. Every application entry has a `component` and a stable `event` field, while related work is
correlated by `snapshotId`, `eventId`, `messageId`, and `postId` where applicable.

### Primary: Google Cloud Logs Explorer

Use [Logs Explorer](https://console.cloud.google.com/logs/query?project=ia-models-analyzer) as the
normal way to inspect the system. Set the time range first (for example, **Last 7 days**), then paste
one of these filters into the query editor. Each result can be expanded to inspect its full
`jsonPayload`.

Real model-data changes, with added, removed, and field-level updated model details:

```text
jsonPayload.event="data.refresh.changed"
```

Changes to any monitored Pareto front, including the unpublished price front and movements that do
not warrant a post:

```text
jsonPayload.event="pareto.front.changed"
```

The complete publication path, from the collector's decision through Pub/Sub to X:

```text
jsonPayload.event=~"^pareto\\.publication\\.|^publisher\\.delivery\\."
```

Copy an `eventId` from any of those entries to follow one decision end to end:

```text
jsonPayload.eventId="sha256:..."
```

Errors across both components:

```text
severity>=ERROR
(jsonPayload.component="collector" OR jsonPayload.component="x-publisher")
```

The resource picker can further narrow the view to the collector Cloud Run Job or the X publisher
Cloud Run service, but the structured filters above work across both components.

### Secondary: Google Cloud CLI

Use the CLI for terminal-based inspection, scripting, or exporting results. It queries the same
Cloud Logging entries as Logs Explorer:

```powershell
gcloud logging read 'jsonPayload.event="data.refresh.changed"' `
  --project=ia-models-analyzer --freshness=7d --limit=50 --order=desc --format=json
```

For a full publication trace, replace the filter with:

```text
jsonPayload.event=~"^pareto\\.publication\\.|^publisher\\.delivery\\."
```

Detail arrays are capped at 50 items per category so a wholesale upstream rescore cannot exceed a
Cloud Logging entry limit. The exact omitted count remains in `omittedDetailCount`; the immutable
snapshots named by `previousSnapshotId` and `snapshotId` remain the source for a full offline diff.
The first snapshot in an empty deployment records a baseline; subsequent runs distinguish a new
snapshot timestamp from actual model-data changes.

## Safety notes

- Never add a `google_secret_manager_secret_version` containing credentials to this configuration.
- The bucket cannot be destroyed by Terraform and Firestore is abandoned rather than deleted.
- The Cloud Run Job accepts only digest-pinned images.
- Artifact Registry keeps the five most recent images and removes images older than 30 days.
- Snapshot lifecycle deletion applies only below `public/snapshots/`; it never deletes `latest.json`.
- Set `billing_account_id` locally to enable the EUR 10 monthly budget thresholds.
