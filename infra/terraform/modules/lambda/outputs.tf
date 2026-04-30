output "function_arn" {
  value = aws_lambda_function.this.arn
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "ecr_repository_url" {
  description = "ECR repo URL for the Lambda container image. CI pushes here."
  value       = aws_ecr_repository.lambda.repository_url
}

output "role_arn" {
  value = aws_iam_role.exec.arn
}
