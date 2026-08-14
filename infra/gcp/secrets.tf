resource "google_secret_manager_secret" "artificial_analysis" {
  project             = var.project_id
  secret_id           = "artificial-analysis-api-key"
  deletion_protection = true

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

locals {
  x_secret_ids = {
    api_key             = "x-api-key"
    api_secret          = "x-api-secret"
    access_token        = "x-access-token"
    access_token_secret = "x-access-token-secret"
  }
}

resource "google_secret_manager_secret" "x" {
  for_each = local.x_secret_ids

  project             = var.project_id
  secret_id           = each.value
  deletion_protection = true

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}
