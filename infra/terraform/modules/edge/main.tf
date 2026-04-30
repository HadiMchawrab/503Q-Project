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

  name  = "${var.name}-cloudfront"
  scope = "CLOUDFRONT"

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
# CloudFront — caches static assets and terminates TLS at the edge.
# Origin is the public ALB managed by AWS Load Balancer Controller.
# ---------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  web_acl_id      = aws_wafv2_web_acl.cloudfront.arn
  comment         = "${var.name} edge"

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

  default_cache_behavior {
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
