resource "google_service_account" "collector" {
  project      = var.project_id
  account_id   = "aa-collector"
  display_name = "Artificial Analyzer collector"
  description  = "Runs the scheduled model collector with least-privilege access."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "scheduler" {
  project      = var.project_id
  account_id   = "aa-scheduler"
  display_name = "Artificial Analyzer scheduler"
  description  = "Invokes only the Artificial Analyzer Cloud Run Job."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "builder" {
  project      = var.project_id
  account_id   = "aa-image-builder"
  display_name = "Artificial Analyzer image builder"
  description  = "Builds application images and writes them to Artifact Registry."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "x_publisher" {
  project      = var.project_id
  account_id   = "aa-x-publisher"
  display_name = "Artificial Analyzer X publisher"
  description  = "Consumes Pareto events and updates only X delivery state."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "pubsub_push" {
  project      = var.project_id
  account_id   = "aa-pubsub-push"
  display_name = "Artificial Analyzer Pub/Sub push identity"
  description  = "Authenticates Pub/Sub pushes to the private X publisher service."

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "collector_secret_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.artificial_analysis.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.collector.email}"
}

resource "google_storage_bucket_iam_member" "collector_object_admin" {
  bucket = google_storage_bucket.public_data.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.collector.email}"
}

resource "google_pubsub_topic_iam_member" "collector_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.pareto_changes.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.collector.email}"
}

resource "google_project_iam_member" "collector_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.collector.email}"
}

resource "google_project_iam_member" "collector_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.collector.email}"
}

resource "google_artifact_registry_repository_iam_member" "builder_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.containers.location
  repository = google_artifact_registry_repository.containers.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.builder.email}"
}

resource "google_project_iam_member" "builder_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.builder.email}"
}

resource "google_project_iam_member" "builder_source_reader" {
  project = var.project_id
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${google_service_account.builder.email}"
}

resource "google_secret_manager_secret_iam_member" "publisher_secret_accessor" {
  for_each = google_secret_manager_secret.x

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.x_publisher.email}"
}

resource "google_project_iam_member" "publisher_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.x_publisher.email}"
}

resource "google_project_iam_member" "publisher_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.x_publisher.email}"
}

resource "google_service_account_iam_member" "pubsub_push_token_creator" {
  service_account_id = google_service_account.pubsub_push.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"

  depends_on = [google_project_service.required]
}
