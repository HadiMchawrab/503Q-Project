output "cluster_name" {
  value = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}

output "cluster_certificate_authority" {
  value = aws_eks_cluster.this.certificate_authority[0].data
}

output "oidc_provider_arn" {
  description = "Used by IRSA roles to trust the cluster's OIDC issuer."
  value       = aws_iam_openid_connect_provider.eks.arn
}

output "oidc_provider_url" {
  description = "OIDC issuer URL (without https://). Used in IRSA trust policy `sub` conditions."
  value       = replace(aws_iam_openid_connect_provider.eks.url, "https://", "")
}

output "node_security_group_id" {
  description = "Security group attached to worker nodes — use this as the source for RDS/Redis ingress rules."
  value       = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
}
