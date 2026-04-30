output "bucket_name" {
  description = "Bucket name — passed to the Lambda as INVOICES_BUCKET."
  value       = aws_s3_bucket.invoices.id
}

output "bucket_arn" {
  description = "Bucket ARN — used in IAM policies that grant s3:PutObject."
  value       = aws_s3_bucket.invoices.arn
}
