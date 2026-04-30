variable "name" {
  description = "Prefix applied to both user pools (e.g. shopcloud)."
  type        = string
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
