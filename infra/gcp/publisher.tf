resource "google_cloud_run_v2_service" "x_publisher" {
  count = local.deploy_publisher ? 1 : 0

  project             = var.project_id
  name                = "artificial-analyzer-x-publisher"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.x_publisher.email

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      name  = "x-publisher"
      image = var.publisher_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "X_USER_ID"
        value = var.x_user_id
      }
      env {
        name  = "X_DELIVERY_LEASE_SECONDS"
        value = "300"
      }

      dynamic "env" {
        for_each = var.public_site_url == null ? [] : [var.public_site_url]
        content {
          name  = "PUBLIC_SITE_URL"
          value = env.value
        }
      }

      env {
        name = "X_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.x["api_key"].id
            version = "latest"
          }
        }
      }
      env {
        name = "X_API_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.x["api_secret"].id
            version = "latest"
          }
        }
      }
      env {
        name = "X_ACCESS_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.x["access_token"].id
            version = "latest"
          }
        }
      }
      env {
        name = "X_ACCESS_TOKEN_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.x["access_token_secret"].id
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.publisher_firestore,
    google_project_iam_member.publisher_logging,
    google_secret_manager_secret_iam_member.publisher_secret_accessor,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "pubsub_invoker" {
  count = local.deploy_publisher ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_service.x_publisher[0].location
  name     = google_cloud_run_v2_service.x_publisher[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.pubsub_push.email}"
}

resource "google_pubsub_subscription" "x_publisher" {
  count = local.deploy_publisher ? 1 : 0

  project = var.project_id
  name    = "x-publisher-v1"
  topic   = google_pubsub_topic.pareto_changes.id

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"

  expiration_policy {
    ttl = ""
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.pareto_changes_dlq.id
    max_delivery_attempts = 10
  }

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.x_publisher[0].uri}/pubsub/x"

    oidc_token {
      service_account_email = google_service_account.pubsub_push.email
      audience              = google_cloud_run_v2_service.x_publisher[0].uri
    }
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.pubsub_invoker,
    google_service_account_iam_member.pubsub_push_token_creator,
  ]
}

resource "google_pubsub_topic_iam_member" "pubsub_dlq_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.pareto_changes_dlq.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"

  depends_on = [google_project_service.required]
}

resource "google_pubsub_subscription_iam_member" "pubsub_dlq_forwarder" {
  count = local.deploy_publisher ? 1 : 0

  project      = var.project_id
  subscription = google_pubsub_subscription.x_publisher[0].name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription" "x_publisher_dead_letter" {
  count = local.deploy_publisher ? 1 : 0

  project = var.project_id
  name    = "x-publisher-dead-letter-v1"
  topic   = google_pubsub_topic.pareto_changes_dlq.id

  ack_deadline_seconds       = 60
  message_retention_duration = "1209600s"

  expiration_policy {
    ttl = ""
  }
}
