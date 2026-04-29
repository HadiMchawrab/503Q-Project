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
