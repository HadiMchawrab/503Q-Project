# Two Cognito User Pools — one for customers, one for admins.
# Services validate JWTs issued by these pools (see shared/auth.py).

resource "aws_cognito_user_pool" "customers" {
  name = "${var.name}-customers"

  password_policy {
    minimum_length    = 10
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  # `email` must be both auto-verified AND a username alias for the Hosted UI
  # signup form to render an email input. Without alias_attributes Cognito
  # treats username as opaque and skips the email field, then the verification
  # send fails because the user has no email -> 302 to the generic /error page.
  auto_verified_attributes = ["email"]
  alias_attributes         = ["email"]

  # Schema attributes are immutable after pool creation. `Required = true`
  # on email forces the Hosted UI signup form to render an email input box
  # and prevents writing user records without one.
  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 2048
    }
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_client" "customers" {
  name                                 = "${var.name}-customers-web"
  user_pool_id                         = aws_cognito_user_pool.customers.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = var.customer_callback_urls
  logout_urls                          = var.customer_logout_urls
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}

resource "aws_cognito_user_pool_domain" "customers" {
  domain       = var.customer_domain_prefix
  user_pool_id = aws_cognito_user_pool.customers.id
}

resource "aws_cognito_user_pool" "admins" {
  name = "${var.name}-admins"

  password_policy {
    minimum_length    = 14
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  # Same email-as-alias / required-email reasoning as the customer pool.
  # Admins are admin-created (allow_admin_create_user_only = true below) so
  # the Hosted UI signup form is never used here -- but keeping the schema
  # consistent across pools means shared/auth.py JWT validation logic does
  # not need to handle two different shapes.
  auto_verified_attributes = ["email"]
  alias_attributes         = ["email"]

  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 2048
    }
  }

  mfa_configuration = "ON"
  software_token_mfa_configuration {
    enabled = true
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }
}

resource "aws_cognito_user_pool_client" "admins" {
  name                                 = "${var.name}-admins-web"
  user_pool_id                         = aws_cognito_user_pool.admins.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = var.admin_callback_urls
  logout_urls                          = var.admin_logout_urls
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}

resource "aws_cognito_user_pool_domain" "admins" {
  domain       = var.admin_domain_prefix
  user_pool_id = aws_cognito_user_pool.admins.id
}
