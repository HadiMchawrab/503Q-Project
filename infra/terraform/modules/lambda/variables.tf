variable "function_name" {
  description = "Name for the Lambda function and its ECR repo."
  type        = string
  default     = "invoice-generator"
}

variable "image_tag" {
  description = "Initial image tag pushed by CI. Lambda will be updated by CI on every deploy; Terraform ignores subsequent changes."
  type        = string
  default     = "bootstrap"
}

variable "timeout_seconds" {
  description = "Per-invocation timeout. PDF render is fast; this just covers DB latency."
  type        = number
  default     = 60
}

variable "memory_mb" {
  description = "Lambda memory. Higher = more CPU. ReportLab benefits from more memory."
  type        = number
  default     = 512
}

variable "vpc_id" {
  description = "VPC the Lambda runs inside (so it can reach RDS)."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the Lambda ENIs. Use the EKS private subnets."
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "Security group attached to the RDS instance — we add an ingress rule from this Lambda."
  type        = string
}

variable "sqs_queue_arn" {
  description = "ARN of the SQS queue Lambda consumes from."
  type        = string
}

variable "s3_bucket_name" {
  description = "Bucket name passed as INVOICES_BUCKET env var."
  type        = string
}

variable "s3_bucket_arn" {
  description = "Bucket ARN — used in the s3:PutObject policy."
  type        = string
}

variable "ses_sender" {
  description = "Verified From: address. Must be verified in SES (or a verified domain)."
  type        = string
}

variable "db_secret_arn" {
  description = "Secrets Manager ARN holding the RDS password."
  type        = string
}

variable "db_host" {
  description = "RDS endpoint hostname."
  type        = string
}

variable "db_name" {
  description = "Database name (e.g. shopcloud)."
  type        = string
}

variable "db_user" {
  description = "Database username."
  type        = string
}
