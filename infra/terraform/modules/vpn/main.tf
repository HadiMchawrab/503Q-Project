# AWS Client VPN — admin-only ingress to the internal ALB.
#
# Two-factor admin auth, matching the cert+MFA path in the architecture diagram:
#   1. Mutual TLS — admin's machine presents a client cert chained from
#      acm_client_root_cert_arn. Stops anyone without the cert.
#   2. Federated SAML — when saml_provider_arn is set, the AWS VPN client opens
#      a browser, the admin authenticates against the IdP, and the IdP enforces
#      MFA. AWS Client VPN does not implement TOTP itself; the second factor
#      is delegated to whatever the SAML IdP requires (Cognito with MFA ON,
#      Okta, Entra ID, etc.).
#
# Both blocks must succeed for the tunnel to come up. Leaving saml_provider_arn
# empty drops back to cert-only — convenient for local testing, but the prod
# environment passes a real ARN so MFA is enforced.
#
# Out-of-band setup (NOT Terraformed — keep secrets out of source control):
#   - Server cert + client root CA imported into ACM (acm_server_cert_arn,
#     acm_client_root_cert_arn).
#   - SAML IdP metadata uploaded to IAM, producing saml_provider_arn. The
#     simplest fit here is the admin Cognito user pool (already MFA=ON,
#     see modules/cognito/main.tf:57) configured as a SAML IdP.
#
# To connect:
#   1. Admin downloads .ovpn from the Client VPN self-service portal
#   2. Imports their personal cert (issued from the same CA as acm_client_root_cert_arn)
#   3. Opens AWS VPN Client -> connect -> browser opens -> SAML login + MFA
#   4. Resolves admin.shopcloud.internal -> internal ALB

resource "aws_cloudwatch_log_group" "vpn" {
  name              = "/aws/clientvpn/${var.name}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_stream" "vpn" {
  name           = "${var.name}-connections"
  log_group_name = aws_cloudwatch_log_group.vpn.name
}

resource "aws_security_group" "vpn" {
  name        = "${var.name}-clientvpn"
  description = "Client VPN endpoint — egress to VPC only"
  vpc_id      = var.vpc_id

  egress {
    description = "All egress within VPC"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }
}

locals {
  # Reuse the main SAML provider for the self-service portal unless one is
  # supplied explicitly. AWS requires a non-empty value here when SAML auth
  # is used, even if it points at the same IdP.
  effective_self_service_saml_arn = (
    var.self_service_saml_provider_arn != ""
    ? var.self_service_saml_provider_arn
    : var.saml_provider_arn
  )
  mfa_enabled = var.saml_provider_arn != ""
}

resource "aws_ec2_client_vpn_endpoint" "this" {
  description            = "${var.name} admin VPN"
  server_certificate_arn = var.acm_server_cert_arn
  client_cidr_block      = var.client_cidr_block

  # Factor 1 — client certificate. Always required.
  authentication_options {
    type                       = "certificate-authentication"
    root_certificate_chain_arn = var.acm_client_root_cert_arn
  }

  # Factor 2 — federated SAML (MFA enforced by the IdP). Only attached when
  # saml_provider_arn is set; for_each on a list lets the block be omitted
  # in dev/test where there is no IdP wired up yet.
  dynamic "authentication_options" {
    for_each = local.mfa_enabled ? [1] : []
    content {
      type                           = "federated-authentication"
      saml_provider_arn              = var.saml_provider_arn
      self_service_saml_provider_arn = local.effective_self_service_saml_arn
    }
  }

  # Self-service portal lets admins download their .ovpn config after SAML
  # login. Only meaningful when SAML is configured.
  self_service_portal = local.mfa_enabled ? "enabled" : "disabled"

  connection_log_options {
    enabled               = true
    cloudwatch_log_group  = aws_cloudwatch_log_group.vpn.name
    cloudwatch_log_stream = aws_cloudwatch_log_stream.vpn.name
  }

  vpc_id             = var.vpc_id
  security_group_ids = [aws_security_group.vpn.id]

  split_tunnel = true
}

# Associate the endpoint with each private subnet — ENIs land here.
resource "aws_ec2_client_vpn_network_association" "this" {
  for_each               = toset(var.subnet_ids)
  client_vpn_endpoint_id = aws_ec2_client_vpn_endpoint.this.id
  subnet_id              = each.value
}

# Authorize VPN clients to reach the VPC CIDR (the internal ALB lives there).
resource "aws_ec2_client_vpn_authorization_rule" "vpc" {
  client_vpn_endpoint_id = aws_ec2_client_vpn_endpoint.this.id
  target_network_cidr    = var.vpc_cidr
  authorize_all_groups   = true
}
