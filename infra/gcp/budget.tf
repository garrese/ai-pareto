data "google_billing_account" "current" {
  count = var.billing_account_id == null ? 0 : 1

  billing_account = var.billing_account_id
}

resource "google_billing_budget" "monthly" {
  count = var.billing_account_id == null ? 0 : 1

  billing_account = data.google_billing_account.current[0].id
  display_name    = "Artificial Analyzer monthly budget"

  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.monthly_budget_units)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  depends_on = [google_project_service.required]
}
