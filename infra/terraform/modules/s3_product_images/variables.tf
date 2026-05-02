variable "name" {
  description = "Project name prefix for tagging/naming."
  type        = string
}

variable "bucket_name" {
  description = "Globally unique S3 bucket name for product images."
  type        = string
}
