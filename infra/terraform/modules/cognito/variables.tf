variable "name" {
  description = "Prefix applied to both user pools (e.g. shopcloud)."
  type        = string
}

variable "customer_domain_prefix" {
  description = "Hosted UI subdomain for the customer pool (e.g. shopcloud-auth → shopcloud-auth.auth.<region>.amazoncognito.com). Must be globally unique."
  type        = string
  default     = "shopcloud-customers"
}

variable "admin_domain_prefix" {
  description = "Hosted UI subdomain for the admin pool. Must be globally unique."
  type        = string
  default     = "shopcloud-admins"
}

variable "customer_logout_urls" {
  description = "Allowed sign-out redirect targets for the customers app client."
  type        = list(string)
  default     = ["https://shopcloud.local/"]
}

variable "admin_logout_urls" {
  description = "Allowed sign-out redirect targets for the admins app client."
  type        = list(string)
  default     = ["https://admin.shopcloud.local/"]
}

variable "customer_callback_urls" {
  description = "OAuth callback URLs registered on the customers app client."
  type        = list(string)
  default     = ["https://shopcloud.local/callback"]
}

variable "admin_callback_urls" {
  description = "OAuth callback URLs registered on the admins app client."
  type        = list(string)
  default     = ["https://admin.shopcloud.local/callback"]
}
