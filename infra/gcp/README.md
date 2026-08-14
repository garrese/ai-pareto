# Google Cloud infrastructure

Terraform configuration for the Artificial Analyzer platform. It manages APIs, the Firebase project
and Hosting site, the public snapshot bucket, Firestore, Secret Manager metadata, Pub/Sub topics,
service accounts, IAM, Artifact Registry, the Cloud Run workloads, the collector's four-hour
schedule, the X push subscription and dead-letter permissions, and an optional billing budget.

Terraform never receives the Artificial Analysis key, so the value cannot enter plans or state. The
secret container is managed here; a separate script sends the ignored local value directly to Secret
Manager through `gcloud` standard input.

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
are null. It also enables Firebase on the existing Google Cloud project and creates the default
Hosting site. The public bucket defaults to `<project-id>-public-data`, and the Hosting site ID
defaults to the project ID; override either in the local values file if needed.

Adding Firebase to a Google Cloud project is permanent. The Hosting site uses an abandon policy so
removing it from Terraform cannot delete the live site. If either resource already exists, import it
before applying rather than attempting to recreate it:

```bash
terraform import google_firebase_project.platform projects/ia-models-analyzer
terraform import google_firebase_hosting_site.web projects/ia-models-analyzer/sites/ia-models-analyzer
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
firebase deploy --project ia-models-analyzer --only hosting
```

The command prints the same URL available as the `firebase_hosting_url` Terraform output.

## Safety notes

- Never add a `google_secret_manager_secret_version` containing credentials to this configuration.
- The bucket cannot be destroyed by Terraform and Firestore is abandoned rather than deleted.
- The Cloud Run Job accepts only digest-pinned images.
- Artifact Registry keeps the five most recent images and removes images older than 30 days.
- Snapshot lifecycle deletion applies only below `public/snapshots/`; it never deletes `latest.json`.
- Set `billing_account_id` locally to enable the EUR 10 monthly budget thresholds.
