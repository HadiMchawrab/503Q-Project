variable "bucket_name" {
  description = "Globally unique S3 bucket name for the storefront static assets."
  type        = string
}

variable "cloudfront_distribution_arn" {
  description = "ARN of the CloudFront distribution allowed to read this bucket. Pass module.edge.cloudfront_distribution_arn from the prod environment."
  type        = string
}
