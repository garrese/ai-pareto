resource "google_cloud_run_v2_job" "collector" {
  count = local.deploy_collector ? 1 : 0

  project             = var.project_id
  name                = "artificial-analyzer-collector"
  location            = var.region
  deletion_protection = true

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.collector.email
      max_retries     = 2
      timeout         = "600s"

      containers {
        name  = "collector"
        image = var.collector_image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
        env {
          name  = "PUBLIC_DATA_BUCKET"
          value = google_storage_bucket.public_data.name
        }
        env {
          name  = "PARETO_TOPIC"
          value = google_pubsub_topic.pareto_changes.name
        }
        env {
          name  = "COLLECTOR_LEASE_SECONDS"
          value = "900"
        }
        env {
          name = "AA_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.artificial_analysis.id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_project_iam_member.collector_firestore,
    google_project_iam_member.collector_logging,
    google_pubsub_topic_iam_member.collector_publisher,
    google_secret_manager_secret_iam_member.collector_secret_accessor,
    google_storage_bucket_iam_member.collector_object_admin,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_invoker" {
  count = local.deploy_collector ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_job.collector[0].location
  name     = google_cloud_run_v2_job.collector[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "collector" {
  count = local.deploy_collector ? 1 : 0

  project          = var.project_id
  region           = var.region
  name             = "artificial-analyzer-collector"
  description      = "Refresh Artificial Analyzer public snapshots every four hours."
  schedule         = var.collector_schedule
  time_zone        = "Etc/UTC"
  attempt_deadline = "320s"

  retry_config {
    retry_count          = 2
    min_backoff_duration = "60s"
    max_backoff_duration = "600s"
    max_retry_duration   = "1800s"
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.collector[0].name}:run"
    body        = base64encode("{}")

    headers = {
      "Content-Type" = "application/json"
    }

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [
    google_cloud_run_v2_job_iam_member.scheduler_invoker,
    google_project_service.required,
  ]
}
