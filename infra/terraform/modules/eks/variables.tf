variable "name" {
  description = "Cluster name and resource prefix."
  type        = string
}

variable "kubernetes_version" {
  description = "Kubernetes version for the EKS control plane."
  type        = string
}

variable "vpc_id" {
  description = "VPC the cluster lives in."
  type        = string
}

variable "subnet_ids" {
  description = "Subnets where nodes are placed (private subnets)."
  type        = list(string)
}
