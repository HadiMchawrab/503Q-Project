variable "name" {
  description = "Prefix for queue names."
  type        = string
}

variable "visibility_timeout_seconds" {
  description = "How long a message is hidden after a consumer picks it up. Must be longer than the Lambda timeout."
  type        = number
  default     = 90
}

variable "max_receive_count" {
  description = "After this many failed attempts, the message moves to the DLQ."
  type        = number
  default     = 3
}
