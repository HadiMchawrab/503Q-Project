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
