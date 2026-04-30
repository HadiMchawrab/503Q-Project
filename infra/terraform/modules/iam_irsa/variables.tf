variable "role_name" {
  description = "IAM role name."
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace of the service account that will assume this role."
  type        = string
}

variable "service_account_name" {
  description = "Kubernetes service account name."
  type        = string
}

variable "oidc_provider_arn" {
  description = "From eks module output."
  type        = string
}

variable "oidc_provider_url" {
  description = "From eks module output (no https:// prefix)."
  type        = string
}

variable "policy_json" {
  description = "Inline IAM policy JSON granting whatever AWS permissions the pod needs."
  type        = string
}
