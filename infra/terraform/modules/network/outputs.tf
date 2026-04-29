output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnets — EKS nodes go here."
  value       = aws_subnet.private[*].id
}

output "database_subnet_ids" {
  description = "Database subnets — RDS and Redis go here."
  value       = aws_subnet.database[*].id
}
