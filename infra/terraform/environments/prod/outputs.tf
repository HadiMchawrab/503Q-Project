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
