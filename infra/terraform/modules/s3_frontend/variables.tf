variable "bucket_name" {
  description = "Globally unique S3 bucket name for the storefront static assets."
  type        = string
}

variable "cloudfront_distribution_arn" {
  description = <<-EOT
    DEPRECATED: ignored. Was used to scope the bucket policy to a specific
    CloudFront distribution, but the resulting edge<->s3_frontend dependency
    creates a graph cycle when both modules are for_each-keyed. The bucket
    policy now scopes by `aws:SourceAccount` instead, which is sufficient
    for single-tenant setups.

    Kept here so callers do not break; remove the input from the caller in
    a follow-up. Defaults to "" so new callers can omit it.
  EOT
  type        = string
  default     = ""
}
