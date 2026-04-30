output "endpoint_id" {
  value = aws_ec2_client_vpn_endpoint.this.id
}

output "dns_name" {
  description = "DNS name admins use when downloading the .ovpn config."
  value       = aws_ec2_client_vpn_endpoint.this.dns_name
}
