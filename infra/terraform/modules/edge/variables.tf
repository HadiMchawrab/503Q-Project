variable "name" {
  description = "Resource prefix (e.g. shopcloud)."
  type        = string
}

variable "alb_dns_name" {
  description = "DNS name of the public ALB the AWS Load Balancer Controller provisions for the cluster."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the customer-facing domain. Empty string disables Route 53 records (CloudFront + WAF still deploy)."
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Customer-facing domain (e.g. shop.shopcloud.com). Required when hosted_zone_id is set."
  type        = string
  default     = ""
}

variable "primary_region" {
  description = "Primary AWS region for latency routing."
  type        = string
  default     = "eu-west-1"
}

variable "secondary_region" {
  description = "Secondary region for latency routing (set empty to disable)."
  type        = string
  default     = "us-east-1"
}

variable "frontend_bucket_regional_domain_name" {
  description = "Regional domain name of the storefront S3 bucket (module.s3_frontend.bucket_regional_domain_name). Empty disables the static origin and CloudFront sends every path to the ALB."
  type        = string
  default     = ""
}
