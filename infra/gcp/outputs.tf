output "public_data_bucket" {
  description = "Bucket that serves generated public datasets."
  value       = google_storage_bucket.public_data.name
}

output "firebase_hosting_url" {
  description = "Default URL for the static web application."
  value       = google_firebase_hosting_site.web.default_url
}

output "artifact_repository" {
  description = "Docker repository prefix used by Cloud Build."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
}

output "builder_service_account" {
  description = "Full service-account resource name for gcloud builds submit."
  value       = google_service_account.builder.name
}

output "artificial_analysis_secret" {
  description = "Secret Manager resource that must receive a version outside Terraform."
  value       = google_secret_manager_secret.artificial_analysis.id
}

output "collector_job" {
  description = "Cloud Run Job name, or null during the bootstrap-only phase."
  value       = try(google_cloud_run_v2_job.collector[0].name, null)
}

output "collector_schedule" {
  description = "UTC schedule, or null until a collector image is supplied."
  value       = try(google_cloud_scheduler_job.collector[0].schedule, null)
}

output "publisher_service" {
  description = "Private Cloud Run publisher name, or null until its image and X user ID are supplied."
  value       = try(google_cloud_run_v2_service.x_publisher[0].name, null)
}

output "publisher_subscription" {
  description = "Pub/Sub push subscription, or null until the publisher is enabled."
  value       = try(google_pubsub_subscription.x_publisher[0].name, null)
}

output "publisher_dead_letter_subscription" {
  description = "Pull subscription retaining X events that exhausted delivery retries."
  value       = try(google_pubsub_subscription.x_publisher_dead_letter[0].name, null)
}
