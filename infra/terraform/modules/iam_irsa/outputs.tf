output "role_arn" {
  description = "Annotate the K8s service account with eks.amazonaws.com/role-arn=<this>."
  value       = aws_iam_role.this.arn
}
