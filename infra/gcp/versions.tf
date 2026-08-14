terraform {
  required_version = ">= 1.8, < 2.0"

  backend "gcs" {
    bucket = "ia-models-analyzer-terraform-state"
    prefix = "platform/production"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.41"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.41"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}
