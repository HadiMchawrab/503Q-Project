variable "name" {
  description = "Prefix used in resource names and tags."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
}

variable "azs" {
  description = "List of availability zones to deploy subnets into."
  type        = list(string)
}
