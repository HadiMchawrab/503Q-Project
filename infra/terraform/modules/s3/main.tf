# Invoices bucket. Lambda writes PDFs here; the checkout/admin services hand
# out 15-minute presigned URLs to customers. The bucket itself stays private.

resource "aws_s3_bucket" "invoices" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_server_side_encryption_configuration" "invoices" {
  bucket = aws_s3_bucket.invoices.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Belt-and-suspenders against an accidentally public bucket policy.
resource "aws_s3_bucket_public_access_block" "invoices" {
  bucket                  = aws_s3_bucket.invoices.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "invoices" {
  bucket = aws_s3_bucket.invoices.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Move objects to cheaper storage after 30 days; expire after 7 years (tax retention).
resource "aws_s3_bucket_lifecycle_configuration" "invoices" {
  bucket = aws_s3_bucket.invoices.id

  rule {
    id     = "tier-and-expire"
    status = "Enabled"

    filter {}

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = 2555
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}
