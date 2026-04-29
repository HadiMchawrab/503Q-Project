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
