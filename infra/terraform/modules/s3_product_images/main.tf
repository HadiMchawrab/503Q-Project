# Private S3 bucket for product images uploaded from the admin console.
# Served publicly to the storefront only through CloudFront via Origin Access
# Control (OAC) -- direct S3 URLs are blocked. Admin pods write here via IRSA.
#
# Single bucket shared by both prod and dev because product images are content,
# not environment-specific data: a product image uploaded in either env is
# safe to display anywhere. (Compare to storefront bundles, which are per-env
# because they ship per-env code.)

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

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

resource "aws_s3_bucket_cors_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  # Even though uploads go through the admin pod (not direct browser->S3),
  # the storefront browser fetches images via CloudFront which proxies to S3.
  # CORS on S3 is only relevant if a future change uses presigned-URL uploads
  # from the browser; left permissive on GET so adding that later is friction-
  # free. PUT/POST stay restricted because we don't expose those.
  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

# ---------------------------------------------------------------------------
# CloudFront -- public read path. Uses the same OAC pattern as s3_frontend.
# ---------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "this" {
  name                              = "${var.name}-product-images"
  description                       = "OAC for ${var.name} product images bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name} product images"

  origin {
    domain_name              = aws_s3_bucket.this.bucket_regional_domain_name
    origin_id                = "s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.this.id
  }

  default_cache_behavior {
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    # Product images are immutable per object key (filenames include a UUID),
    # so cache aggressively. If a product needs a new image, the admin upload
    # generates a new key.
    min_ttl     = 0
    default_ttl = 86400      # 1 day
    max_ttl     = 31536000   # 1 year
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# ---------------------------------------------------------------------------
# Bucket policy -- only this account's CloudFront can read.
# Same single-tenant pattern as s3_frontend (no graph-cycle risk here since
# this module owns its own CloudFront, but keeping the pattern consistent).
# ---------------------------------------------------------------------------

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
