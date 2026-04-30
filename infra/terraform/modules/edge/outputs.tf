output "cloudfront_domain_name" {
  description = "Use this as the CNAME target if you manage DNS outside Route 53."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "waf_web_acl_arn" {
  value = aws_wafv2_web_acl.cloudfront.arn
}
