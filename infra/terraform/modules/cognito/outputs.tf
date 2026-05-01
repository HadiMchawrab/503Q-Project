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

output "customer_hosted_ui_domain" {
  description = "Customer Hosted UI domain (https://<prefix>.auth.<region>.amazoncognito.com)."
  value       = "https://${aws_cognito_user_pool_domain.customers.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
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

output "admin_hosted_ui_domain" {
  description = "Admin Hosted UI domain."
  value       = "https://${aws_cognito_user_pool_domain.admins.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

data "aws_region" "current" {}
