variable "services" {
  description = "List of service names — one ECR repo is created per name."
  type        = list(string)
}
