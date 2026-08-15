# Finishing the X bot deployment

Handoff runbook, written 2026-08-15. Everything below was verified against the live project on that
date; re-check before trusting it, because the collector runs every four hours and the world moves.

Read [`AGENTS.md`](../AGENTS.md) first — it is the repository's canonical guide and covers the
publication rules, the post template and the commit conventions. This file covers only the
deployment that is left.

## Where things stand

| Piece | State |
| --- | --- |
| Terraform bootstrap (APIs, IAM, buckets, Firestore, Pub/Sub, Artifact Registry) | applied |
| Collector Cloud Run Job + four-hourly Cloud Scheduler | **applied and running** |
| Static site at <https://ai-pareto.web.app> | deployed, reads the public snapshots |
| X publisher Cloud Run service + push subscription | **not deployed** — this is the job |

Evidence the collector is live: `public/latest.json` in `gs://ia-models-analyzer-public-data` was
written at 2026-08-15T08:17:58Z, and the snapshot history shows 00:18, 04:18 and 08:17 — the
four-hourly schedule firing at minute 17 UTC.

The bot has been exercised end to end by hand. Four posts exist on
[@AIParetoRadar](https://x.com/AIParetoRadar), published through the real renderer and real OAuth by
`apps/x-publisher/scripts/publish-sample.mjs`. Three are smoke tests that state things that are not
true and should be deleted from the account; the fourth, about Grok 4.6 (high), is factually correct
and can stay. Deleting them is the account owner's job.

## Project facts

- Project `ia-models-analyzer`, region `europe-west1`
- Terraform state: `gs://ia-models-analyzer-terraform-state/platform/production`
- Terraform root: `infra/gcp`
- X credentials live in `apps/x-publisher/config.properties` — git-ignored, five keys:
  `x.api.key`, `x.api.secret`, `x.access.token`, `x.access.token.secret`, `x.user.id`.
  That file exists only on the machine where `npm run authorize` was run; recreate it wherever you
  run step 3.

## Prerequisites

Terraform 1.8+, the Google Cloud CLI authenticated to the project, and permission to manage its
resources. **Cloud Shell already has both tools and is already authenticated** — on a locked-down
machine it is much less friction than installing them. Locally you would need:

```bash
gcloud auth application-default login
gcloud config set project ia-models-analyzer
```

On Windows PowerShell, call `npm.cmd` and `gcloud.cmd` rather than the bare names: PowerShell
resolves the bare name to a `.ps1` shim, which a `Restricted` execution policy blocks.

## Two things that will break this

**1. `production.auto.tfvars` is git-ignored and will not exist on a fresh machine.**

`deploy_collector` is `var.collector_image != null`. Copying `production.tfvars.example` and applying
it as-is would **destroy the running collector Job and its Scheduler**, because the example ships
`collector_image = null`. Recover the live digest from state first:

```bash
cd infra/gcp
cp production.tfvars.example production.auto.tfvars
terraform init
terraform state show 'google_cloud_run_v2_job.collector[0]' | grep -m1 'image '
```

Put that digest-pinned URL into `production.auto.tfvars` as `collector_image` before planning. Then
read every line of `terraform plan`: a plan that destroys anything under
`google_cloud_run_v2_job.collector` or `google_cloud_scheduler_job.collector` is wrong — stop.

**2. The deployed collector still emits v1 events; the publisher only accepts v2.**

The event contract changed on 2026-08-15. It is now `schemaVersion: 2`, types `pareto.model.moved`
and `pareto.scan.digest`, carrying model names and metrics instead of bare UUIDs. The publisher's
`validateParetoEvent` rejects anything else, a rejected event is retried and then dead-lettered.

So the collector image **must be rebuilt from current `main` before the push subscription exists**,
or the first real Pareto change lands in the dead-letter topic instead of on X. Do step 2 before
step 5.

## The work

### 1. Reconstruct the Terraform variables

As described above. Set `collector_image` to the currently deployed digest, leave `publisher_image`
and `x_user_id` null for now. `public_site_url` should already read `https://ai-pareto.web.app`.

### 2. Rebuild and deploy the collector

```bash
cd infra/gcp
IMAGE="$(terraform output -raw artifact_repository)/collector:$(git rev-parse --short HEAD)"
gcloud builds submit ../../apps/api \
  --config=../../apps/api/cloudbuild.yaml \
  --substitutions="_IMAGE=${IMAGE}" \
  --service-account="$(terraform output -raw builder_service_account)"
DIGEST="$(gcloud artifacts docker images describe "${IMAGE}" --format='value(image_summary.digest)')"
echo "${IMAGE}@${DIGEST}"
```

Put that full `...@sha256:...` string in `production.auto.tfvars` as `collector_image`, then
`terraform plan` and `terraform apply`.

The first run afterwards writes a new snapshot ID, because dropping the fourth Pareto front changes
the document the ID is hashed from. That is expected. It does not produce a burst of spurious posts:
fronts 1 to 3 keep their numbering, so no stored membership is reinterpreted as a promotion.

### 3. Push the X credentials to Secret Manager

The four secret containers already exist from the bootstrap apply; they have no versions yet. This
script reads the git-ignored local file and streams each value to `gcloud` on standard input, so no
credential enters Terraform state or shell history:

```bash
node infra/gcp/scripts/add-x-secrets.mjs ia-models-analyzer
```

`x.user.id` is not a secret — it is a public numeric account ID and goes in the tfvars in step 5.

### 4. Build the publisher image

```bash
cd infra/gcp
IMAGE="$(terraform output -raw artifact_repository)/x-publisher:$(git rev-parse --short HEAD)"
gcloud builds submit ../../apps/x-publisher \
  --config=../../apps/x-publisher/cloudbuild.yaml \
  --substitutions="_IMAGE=${IMAGE}" \
  --service-account="$(terraform output -raw builder_service_account)"
DIGEST="$(gcloud artifacts docker images describe "${IMAGE}" --format='value(image_summary.digest)')"
echo "${IMAGE}@${DIGEST}"
```

### 5. Enable the publisher

Set both `publisher_image` (the digest URL from step 4) and `x_user_id` (the numeric ID from
`config.properties`) in `production.auto.tfvars`. Terraform validates that both are set or both are
null. Then `terraform plan` and `terraform apply`.

That creates the private scale-to-zero Cloud Run service, the authenticated Pub/Sub push
subscription with its retry policy, and the retained pull subscription for dead-letter inspection.
**Never grant `allUsers` on the publisher service** — only the dedicated push service account gets
`roles/run.invoker`.

## Verifying it

```bash
cd infra/gcp
terraform output publisher_service
terraform output publisher_subscription
terraform output publisher_dead_letter_subscription
```

All three should be non-null. Then:

- `gcloud run services logs read <publisher_service> --region=europe-west1` — the service is
  scale-to-zero, so it logs nothing until an event arrives.
- The collector only emits an event when a model actually arrives in, or climbs into, one of the
  three fronts. That can be days apart, so silence is not evidence of failure.
- Check the dead-letter subscription has no messages. Anything there means events are being
  rejected — almost certainly a schema mismatch, meaning step 2 was skipped or reverted.

To exercise the whole pipeline without waiting for the market, publish a synthetic `schemaVersion: 2`
`pareto.model.moved` event to the collector's Pub/Sub topic and watch it reach X. Note this posts
publicly to the real account — get the owner's agreement first, and prefer a subject name nobody can
mistake for a real model.

`apps/x-publisher/scripts/publish-sample.mjs` also still works and is the quickest way to prove the
renderer and OAuth path, but it bypasses Pub/Sub and Firestore, so it proves nothing about the
deployment. `--existing "<model name>"` replays the real arrival of a model already in the data, and
refuses to publish if any model it names is newer than the subject — a post cannot claim something
displaced a model that did not exist yet.

## What not to do

- Do not add a `google_secret_manager_secret_version` with a credential to the Terraform config.
- Do not apply with `collector_image = null`.
- Do not enable `DIGEST_BURSTS` in `apps/api/src/collector/definitions.js`. It is deliberately off:
  every arrival and promotion gets its own post.
- Do not add `og:`/`twitter:` meta tags to `apps/web/index.html`. Preview cards were tried and the
  owner preferred the bare URL.
- Do not replace `strictEncode` in `apps/x-publisher/src/render.js` with `encodeURIComponent`. X's
  link parser stops at a parenthesis and almost every model here is named "Something (high)".
