output "rds_endpoint" {
  description = "Postgres connection hostname."
  value       = aws_db_instance.this.address
}

output "rds_port" {
  value = aws_db_instance.this.port
}

output "redis_endpoint" {
  description = "Redis primary endpoint hostname."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "redis_port" {
  value = aws_elasticache_replication_group.this.port
}

output "rds_security_group_id" {
  description = "RDS security group — pass to other modules that need to grant ingress (e.g. the invoice Lambda)."
  value       = aws_security_group.rds.id
}

output "rds_db_name" {
  description = "Database name (matches db_name on the RDS instance)."
  value       = aws_db_instance.this.db_name
}
