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
