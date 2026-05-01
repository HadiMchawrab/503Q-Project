# Private S3 bucket holding the customer storefront's static assets.
# Served only through CloudFront via Origin Access Control (OAC) — direct S3
# URLs are blocked. CI uploads new builds with `aws s3 sync` and invalidates
# the CloudFront cache after each deploy.

resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name

  # Don't accidentally delete a bucket with content via `terraform destroy`.
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Bucket policy -- only CloudFront distributions in THIS account can read the
# bucket. The earlier version locked the policy to a specific distribution
# ARN passed in by the edge module, but that creates a graph cycle when both
# modules are `for_each`-keyed (edge[*] -> s3_frontend[*] -> edge[*]).
#
# `aws:SourceAccount` is sufficient for a single-tenant setup: only this
# account's CloudFront distributions can use this bucket as an origin, and
# CloudFront enforces that only origins explicitly attached to a distribution
# get its requests. Any other CloudFront distribution in the same account
# would still need to be explicitly configured with this bucket as an origin
# (which only the edge module does).
data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "cloudfront_read" {
  statement {
    sid     = "AllowCloudFrontRead"
    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.this.arn}/*",
    ]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = data.aws_iam_policy_document.cloudfront_read.json
}
