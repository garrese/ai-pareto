locals {
  public_data_bucket_name = coalesce(
    var.public_data_bucket_name,
    "${var.project_id}-public-data",
  )
  firebase_site_id = coalesce(var.firebase_site_id, var.project_id)
  deploy_collector = var.collector_image != null
  deploy_publisher = var.publisher_image != null && var.x_user_id != null

  required_services = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbilling.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])
}

check "publisher_configuration" {
  assert {
    condition     = (var.publisher_image == null) == (var.x_user_id == null)
    error_message = "publisher_image and x_user_id must either both be set or both be null."
  }
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
