variable "role_name" {
  description = "IAM role name."
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace of the service account that will assume this role. Use `namespaces` instead to allow multiple."
  type        = string
  default     = ""
}

variable "namespaces" {
  description = "List of namespaces whose <namespace>:<service_account_name> service accounts can assume this role. Takes precedence over `namespace` when non-empty."
  type        = list(string)
  default     = []
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
