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
