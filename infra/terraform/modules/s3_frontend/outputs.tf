output "bucket_name" {
  value = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}

output "bucket_regional_domain_name" {
  description = "Use as a CloudFront origin domain (S3 regional endpoint, OAC-protected)."
  value       = aws_s3_bucket.this.bucket_regional_domain_name
}
