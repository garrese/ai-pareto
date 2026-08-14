resource "google_firebase_project" "platform" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.required]
}

resource "google_firebase_hosting_site" "web" {
  provider = google-beta
  project  = var.project_id
  site_id  = local.firebase_site_id

  deletion_policy = "ABANDON"

  depends_on = [google_firebase_project.platform]
}
