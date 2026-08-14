variable "project_id" {
  description = "Existing billing-enabled Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Artifact Registry, Scheduler, and Storage."
  type        = string
  default     = "europe-west1"
}

variable "firestore_location" {
  description = "Permanent location of the default Firestore database."
  type        = string
  default     = "europe-west1"
}

variable "public_data_bucket_name" {
  description = "Globally unique public snapshot bucket name; null derives it from the project ID."
  type        = string
  default     = null
  nullable    = true
}

variable "firebase_site_id" {
  description = "Globally unique Firebase Hosting site ID; null uses the Google Cloud project ID."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.firebase_site_id == null ||
      can(regex("^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$", var.firebase_site_id))
    )
    error_message = "firebase_site_id must be null or a lowercase domain label of at most 30 characters."
  }
}

variable "snapshot_retention_days" {
  description = "Age after which immutable public snapshots are deleted."
  type        = number
  default     = 30

  validation {
    condition     = var.snapshot_retention_days >= 7
    error_message = "snapshot_retention_days must be at least 7."
  }
}

variable "collector_image" {
  description = "Collector image by immutable digest; null creates only bootstrap infrastructure."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.collector_image == null ||
      can(regex("@sha256:[0-9a-f]{64}$", var.collector_image))
    )
    error_message = "collector_image must be null or an Artifact Registry image ending in @sha256:<64 hex characters>."
  }
}

variable "collector_schedule" {
  description = "UTC cron schedule for the collector."
  type        = string
  default     = "17 */4 * * *"
}

variable "publisher_image" {
  description = "X publisher image by immutable digest; null leaves the service and subscription disabled."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.publisher_image == null ||
      can(regex("@sha256:[0-9a-f]{64}$", var.publisher_image))
    )
    error_message = "publisher_image must be null or an Artifact Registry image ending in @sha256:<64 hex characters>."
  }
}

variable "x_user_id" {
  description = "Numeric X user ID associated with the user access token; required with publisher_image."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.x_user_id == null || can(regex("^[0-9]+$", var.x_user_id))
    error_message = "x_user_id must be null or a numeric X user ID."
  }
}

variable "public_site_url" {
  description = "Optional public site URL included in X posts."
  type        = string
  default     = null
  nullable    = true
}

variable "billing_account_id" {
  description = "Billing account ID for budget alerts; null skips the budget resource."
  type        = string
  default     = null
  nullable    = true
}

variable "monthly_budget_units" {
  description = "Whole currency units for the optional monthly budget."
  type        = number
  default     = 10
}

variable "budget_currency" {
  description = "ISO 4217 currency code for the optional monthly budget."
  type        = string
  default     = "EUR"
}
