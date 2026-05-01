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

# Bucket policy — only the CloudFront distribution that the caller passes in
# can read objects. `var.cloudfront_distribution_arn` is a chicken-and-egg with
# the edge module; resolve it by passing the distribution ARN in after both
# resources are planned (terraform handles the dependency graph).
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
      variable = "AWS:SourceArn"
      values   = [var.cloudfront_distribution_arn]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = data.aws_iam_policy_document.cloudfront_read.json
}
