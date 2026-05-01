# Edge module — Route 53 latency routing + CloudFront + WAF.
# This is the public entry path for customers (left side of the architecture diagram).
#
# Traffic flow:
#   Route 53 (latency-based) -> CloudFront (CDN, TLS at edge) -> WAF -> Public ALB -> EKS
#
# Provider note: WAFv2 CLOUDFRONT-scoped Web ACLs MUST be created in us-east-1.
# The caller is expected to pass an aliased provider as `providers = { aws.us_east_1 = aws.us_east_1 }`.

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.0"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

# ---------------------------------------------------------------------------
# WAF — managed rule sets (OWASP common, known bad inputs) + rate limit.
# Shield Standard is automatic on CloudFront/Route 53; Shield Advanced is
# enabled at the account level (not via Terraform here).
# ---------------------------------------------------------------------------
resource "aws_wafv2_web_acl" "cloudfront" {
  provider = aws.us_east_1

  # name_prefix instead of name avoids the destroy/recreate race when the
  # caller renames `var.name` (e.g. shopcloud -> shopcloud-dev for env-keyed
  # modules). With name_prefix, AWS appends a random suffix; new WAFs can be
  # created while the old one still exists, then `lifecycle.create_before_destroy`
  # below guarantees CloudFront is attached to the new WAF before the old one
  # is destroyed.
  name_prefix = "${var.name}-cloudfront-"
  scope       = "CLOUDFRONT"

  lifecycle {
    create_before_destroy = true
  }

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimit"
    priority = 3
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name}-cloudfront"
    sampled_requests_enabled   = true
  }
}

# ---------------------------------------------------------------------------
# CloudFront — terminates TLS at the edge. Two origins:
#   - "alb": the public ALB. Receives /api/* (uncached, dynamic).
#   - "s3" : the storefront S3 bucket via OAC. Receives everything else (cached).
# ---------------------------------------------------------------------------

# Origin Access Control — replaces the older OAI mechanism. CloudFront signs
# requests to S3 with SigV4 so the bucket can stay fully private.
resource "aws_cloudfront_origin_access_control" "s3_frontend" {
  count = var.frontend_bucket_regional_domain_name == "" ? 0 : 1

  name                              = "${var.name}-s3-frontend"
  description                       = "OAC for ${var.name} storefront bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  web_acl_id          = aws_wafv2_web_acl.cloudfront.arn
  comment             = "${var.name} edge"
  default_root_object = var.frontend_bucket_regional_domain_name == "" ? null : "index.html"

  # ALB origin (always present) — serves /api/*.
  origin {
    domain_name = var.alb_dns_name
    origin_id   = "alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # S3 origin (optional) — serves the storefront static assets.
  dynamic "origin" {
    for_each = var.frontend_bucket_regional_domain_name == "" ? [] : [1]
    content {
      domain_name              = var.frontend_bucket_regional_domain_name
      origin_id                = "s3"
      origin_access_control_id = aws_cloudfront_origin_access_control.s3_frontend[0].id
    }
  }

  # Default behavior — serves the storefront from S3 when configured, otherwise
  # falls through to the ALB (legacy single-origin layout).
  default_cache_behavior {
    target_origin_id       = var.frontend_bucket_regional_domain_name == "" ? "alb" : "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    # S3 default: cache for an hour. Long-cache hashed asset URLs are handled
    # by per-file Cache-Control headers set during `aws s3 sync` in CI.
    min_ttl     = 0
    default_ttl = var.frontend_bucket_regional_domain_name == "" ? 0 : 3600
    max_ttl     = var.frontend_bucket_regional_domain_name == "" ? 0 : 86400
  }

  # /api/* — dynamic, always proxied to the ALB, never cached.
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Host"]
      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # SPA-style routing: when CloudFront gets a 403/404 from S3 (deep link to a
  # path that exists only client-side), serve index.html instead so the JS
  # router can take over. Only meaningful when the S3 origin exists.
  dynamic "custom_error_response" {
    for_each = var.frontend_bucket_regional_domain_name == "" ? [] : [403, 404]
    content {
      error_code            = custom_error_response.value
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    }
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
# Route 53 — latency-based routing.
# One A-alias record per region pointing at the same CloudFront distribution.
# Route 53 picks the lowest-latency record per client. CloudFront then routes
# to its nearest PoP, which serves the request and (on miss) hits the regional ALB.
# ---------------------------------------------------------------------------
resource "aws_route53_record" "primary" {
  count   = var.hosted_zone_id == "" ? 0 : 1
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  set_identifier = "${var.name}-${var.primary_region}"
  latency_routing_policy {
    region = var.primary_region
  }

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "secondary" {
  count   = var.hosted_zone_id == "" || var.secondary_region == "" ? 0 : 1
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  set_identifier = "${var.name}-${var.secondary_region}"
  latency_routing_policy {
    region = var.secondary_region
  }

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
