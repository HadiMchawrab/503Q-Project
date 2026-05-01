variable "name" {
  description = "Resource prefix (e.g. shopcloud)."
  type        = string
}

variable "vpc_id" {
  description = "VPC the Client VPN endpoint terminates into."
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR — used for the egress SG rule and the auth rule that lets clients reach internal resources."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets where Client VPN ENIs land. One per AZ for HA."
  type        = list(string)
}

variable "client_cidr_block" {
  description = "CIDR assigned to connected VPN clients. Must NOT overlap the VPC."
  type        = string
  default     = "10.99.0.0/22"
}

variable "acm_server_cert_arn" {
  description = "ACM ARN of the server cert used by the VPN endpoint."
  type        = string
}

variable "acm_client_root_cert_arn" {
  description = "ACM ARN of the client root CA cert used to verify admin client certs."
  type        = string
}

variable "saml_provider_arn" {
  description = <<-EOT
    Optional IAM SAML provider ARN. When set, the endpoint requires both a
    client certificate AND a SAML login (which the IdP enforces with MFA),
    matching the cert+MFA admin path in the architecture diagram. Leave empty
    to fall back to certificate-only auth (dev/test).
  EOT
  type        = string
  default     = ""
}

variable "self_service_saml_provider_arn" {
  description = <<-EOT
    Optional IAM SAML provider ARN used by the AWS Client VPN self-service
    portal (where admins download their .ovpn config). Usually points at the
    same IdP as saml_provider_arn. Required by AWS when saml_provider_arn is
    set; if you leave this empty the module reuses saml_provider_arn.
  EOT
  type        = string
  default     = ""
}
