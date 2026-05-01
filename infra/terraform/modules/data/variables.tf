variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "vpc_id" {
  description = "VPC where the security groups live."
  type        = string
}

variable "db_subnet_ids" {
  description = "Subnet IDs for the RDS subnet group (database subnets)."
  type        = list(string)
}

variable "redis_subnet_ids" {
  description = "Subnet IDs for the Redis subnet group (database subnets)."
  type        = list(string)
}

variable "allowed_source_sg" {
  description = "Security group ID allowed to talk to RDS/Redis (the EKS node SG)."
  type        = string
}

variable "db_username" {
  description = "Postgres master username."
  type        = string
}

variable "db_password" {
  description = "Postgres master password."
  type        = string
  sensitive   = true
}

variable "environment_databases" {
  description = "Per-environment databases to create on the same RDS instance. The app's K8s overlays point each namespace at one of these via DATABASE_URL."
  type        = list(string)
  default     = ["shopcloud_prod", "shopcloud_dev"]
}

variable "create_per_env_databases" {
  description = "Whether terraform should connect to RDS and CREATE DATABASE for each environment. Set false when running terraform from outside the VPC (e.g. local laptop) — then create the databases manually from a bastion: `psql ... -c 'CREATE DATABASE shopcloud_prod;'`."
  type        = bool
  default     = true
}
