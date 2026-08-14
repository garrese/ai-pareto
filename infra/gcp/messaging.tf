resource "google_pubsub_topic" "pareto_changes" {
  project = var.project_id
  name    = "pareto-change-events"

  message_retention_duration = "604800s"

  depends_on = [google_project_service.required]
}

resource "google_pubsub_topic" "pareto_changes_dlq" {
  project = var.project_id
  name    = "pareto-change-events-dlq"

  message_retention_duration = "1209600s"

  depends_on = [google_project_service.required]
}
