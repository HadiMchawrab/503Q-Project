output "bucket_name" {
  description = "Bucket name. Admin service writes here via IRSA."
  value       = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  description = "Bucket ARN. Use to scope IRSA s3:PutObject permissions."
  value       = aws_s3_bucket.this.arn
}

output "cloudfront_domain_name" {
  description = "CloudFront domain serving images publicly. Storefront uses this as the base URL when rendering uploaded images."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "cloudfront_distribution_id" {
  description = "Distribution ID (for cache invalidation if ever needed)."
  value       = aws_cloudfront_distribution.this.id
}
