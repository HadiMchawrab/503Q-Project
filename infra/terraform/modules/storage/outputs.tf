output "repository_urls" {
  description = "Map of service name to ECR repository URL — used by CI to push images."
  value       = { for k, v in aws_ecr_repository.this : k => v.repository_url }
}
