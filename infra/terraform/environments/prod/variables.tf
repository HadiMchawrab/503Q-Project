# Variables for the prod environment.
# Defaults are set so `terraform apply` works without a tfvars file,
# except for db_password which has no default for safety.

variable "region" {
  description = "AWS region — single region for now (eu-west-1)."
  type        = string
  default     = "eu-west-1"
}

variable "db_password" {
  description = "Master password for the RDS Postgres instance."
  type        = string
  sensitive   = true
  # No default — must be supplied via terraform.tfvars or -var.
}

variable "ses_sender" {
  description = "Verified From: address SES will send invoices from. Domain must be verified in SES (sandbox: per-email)."
  type        = string
  default     = "invoices@shopcloud.local"
}

variable "public_alb_dns_names" {
  description = <<-EOT
    Public ALB DNS names per environment. One CloudFront distribution + S3
    storefront bucket is provisioned per non-empty entry. Get the values from
    `kubectl -n <env> get ingress shopcloud -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'`
    after the AWS Load Balancer Controller has provisioned the per-namespace
    Ingress ALBs.

    Example:
      public_alb_dns_names = {
        prod = "k8s-prod-shopclou-xxx.eu-west-1.elb.amazonaws.com"
        dev  = "k8s-dev-shopclou-yyy.eu-west-1.elb.amazonaws.com"
      }
  EOT
  type        = map(string)
  default     = {}
}

variable "frontend_origin_enabled" {
  description = <<-EOT
    Per-environment flag controlling whether CloudFront wires the S3 storefront
    bucket as an origin. Required because of a Terraform planner limitation:
    `module.edge` and `module.s3_frontend` reference each other through count
    guards, so a `try()` chain on the bucket domain cannot be resolved at plan
    time.

    Two-pass apply for an env:
      PASS 1: frontend_origin_enabled = { prod = false }  (creates CloudFront + bucket)
      PASS 2: frontend_origin_enabled = { prod = true  }  (adds bucket as origin)

    Defaults to false for safety; flip to true only after pass 1 has applied
    successfully for that env.
  EOT
  type        = map(bool)
  default     = {}
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the customer-facing domain. Empty disables Route 53 records (CloudFront + WAF still deploy)."
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Customer-facing domain (e.g. shop.shopcloud.com)."
  type        = string
  default     = ""
}

variable "enable_client_vpn" {
  description = "Whether to provision the admin Client VPN. Requires ACM certs to exist."
  type        = bool
  default     = false
}

variable "enable_cross_region_replica" {
  description = "Whether to provision the us-east-1 RDS read replica for DR."
  type        = bool
  default     = true
}

variable "vpn_server_cert_arn" {
  description = "ACM ARN of the Client VPN server cert."
  type        = string
  default     = ""
}

variable "vpn_client_root_cert_arn" {
  description = "ACM ARN of the client root CA cert used to verify admin client certs."
  type        = string
  default     = ""
}

variable "vpn_saml_provider_arn" {
  description = <<-EOT
    IAM SAML provider ARN that fronts the Client VPN. When set, admins must
    pass BOTH a client cert and a SAML login (with MFA enforced by the IdP)
    to bring up the tunnel. Typically this is the admin Cognito user pool
    federated as a SAML IdP, or an external IdP like Okta / Entra ID.
    Leave empty to fall back to certificate-only auth.
  EOT
  type        = string
  default     = ""
}
