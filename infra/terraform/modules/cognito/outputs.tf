output "customer_pool_id" {
  value = aws_cognito_user_pool.customers.id
}

output "customer_pool_client_id" {
  value = aws_cognito_user_pool_client.customers.id
}

output "customer_pool_issuer" {
  description = "OIDC issuer URL — services use this to fetch JWKS and validate tokens."
  value       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.customers.id}"
}

output "admin_pool_id" {
  value = aws_cognito_user_pool.admins.id
}

output "admin_pool_client_id" {
  value = aws_cognito_user_pool_client.admins.id
}

output "admin_pool_issuer" {
  value = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.admins.id}"
}

data "aws_region" "current" {}
