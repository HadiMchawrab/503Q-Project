# AWS Client VPN — admin-only ingress to the internal ALB.
# Mutual TLS (cert-based) primary auth, with federated SAML or Cognito MFA layered on top.
#
# This module wires the endpoint, network association, and authorization rules.
# The server/client certificates are imported into ACM out-of-band (acm_server_cert_arn,
# acm_client_root_cert_arn) — Terraform should NOT generate them in source control.
#
# To connect:
#   1. Admin downloads the Client VPN config from AWS console
#   2. Imports their personal cert (issued from the same CA as acm_client_root_cert_arn)
#   3. Authenticates with cert + MFA
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

resource "aws_ec2_client_vpn_endpoint" "this" {
  description            = "${var.name} admin VPN"
  server_certificate_arn = var.acm_server_cert_arn
  client_cidr_block      = var.client_cidr_block

  authentication_options {
    type                       = "certificate-authentication"
    root_certificate_chain_arn = var.acm_client_root_cert_arn
  }

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
