resource "google_secret_manager_secret" "artificial_analysis" {
  project             = var.project_id
  secret_id           = "artificial-analysis-api-key"
  deletion_protection = true

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}
