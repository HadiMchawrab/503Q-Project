terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
    tls = { source = "hashicorp/tls" } # used to fetch the OIDC issuer cert
  }
}
