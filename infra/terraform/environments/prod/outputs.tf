# Useful values to print after `terraform apply`.
# Things you'll need when configuring kubectl, CI, or services.

output "cluster_name" {
  description = "EKS cluster name — use this with `aws eks update-kubeconfig`."
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "Kubernetes API endpoint."
  value       = module.eks.cluster_endpoint
}

output "ecr_repository_urls" {
  description = "ECR repo URLs, one per service. Push images here from CI."
  value       = module.storage.repository_urls
}

output "rds_endpoint" {
  description = "Postgres endpoint hostname for application config."
  value       = module.data.rds_endpoint
}

# Per-environment Postgres URLs. Both databases live on the same instance —
# isolation is at the Postgres database level, not the instance level.
# CI consumes these to set DATABASE_URL on each K8s overlay's Secret.
output "rds_url_prod" {
  description = "Connection URL for the prod K8s namespace's database."
  value       = lookup(module.data.rds_environment_database_urls, "shopcloud_prod", "")
  sensitive   = true
}

output "rds_url_dev" {
  description = "Connection URL for the dev K8s namespace's database."
  value       = lookup(module.data.rds_environment_database_urls, "shopcloud_dev", "")
  sensitive   = true
}

output "redis_endpoint" {
  description = "Redis primary endpoint for application config."
  value       = module.data.redis_endpoint
}

# Invoice pipeline outputs

output "invoice_queue_url" {
  description = "SQS queue URL — set on the checkout pod as INVOICE_QUEUE_URL."
  value       = module.messaging.queue_url
}

output "invoice_bucket_name" {
  description = "S3 bucket where invoice PDFs are stored."
  value       = module.s3_invoices.bucket_name
}

output "invoice_lambda_ecr_url" {
  description = "ECR repo for the invoice-generator Lambda container image. CI pushes here."
  value       = module.lambda_invoice.ecr_repository_url
}

output "checkout_irsa_role_arn" {
  description = "Annotate the prod/checkout K8s service account with this role ARN so the pod can call sqs:SendMessage."
  value       = module.irsa_checkout.role_arn
}

# Cognito — wire these into the service ConfigMap (COGNITO_USER_POOL_ID, COGNITO_ADMIN_POOL_ID)
# so shared/auth.py validates Cognito JWTs.
output "cognito_customer_pool_id" {
  value = module.cognito.customer_pool_id
}

output "cognito_admin_pool_id" {
  value = module.cognito.admin_pool_id
}

output "cognito_customer_client_id" {
  value = module.cognito.customer_pool_client_id
}

output "cognito_admin_client_id" {
  value = module.cognito.admin_pool_client_id
}

output "cognito_customer_hosted_ui_domain" {
  value = module.cognito.customer_hosted_ui_domain
}

output "cognito_admin_hosted_ui_domain" {
  value = module.cognito.admin_hosted_ui_domain
}

# Edge
output "cloudfront_domain_name" {
  description = "CNAME this from your DNS provider if hosted_zone_id is empty."
  value       = try(module.edge[0].cloudfront_domain_name, "")
}

output "cloudfront_distribution_id" {
  description = "Pass to `aws cloudfront create-invalidation` after pushing new static assets."
  value       = try(module.edge[0].cloudfront_distribution_id, "")
}

# Storefront
output "frontend_bucket_name" {
  description = "S3 bucket holding storefront static assets. CI runs `aws s3 sync frontend/ s3://<this>`."
  value       = try(module.s3_frontend[0].bucket_name, "")
}

# DR
output "rds_replica_endpoint" {
  description = "us-east-1 read replica endpoint."
  value       = aws_db_instance.replica_us_east_1.address
}
