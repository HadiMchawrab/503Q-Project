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
  description = "Master database name on the RDS instance. NOT what the app uses — see rds_database_url_for(env) outputs for per-environment URLs."
  value       = aws_db_instance.this.db_name
}

output "rds_environment_database_urls" {
  description = "Connection URLs per environment. Each K8s overlay reads its env's URL and merges it into the shopcloud-secrets Secret."
  value = {
    for db in var.environment_databases :
    db => "postgres://${var.db_username}:${var.db_password}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${db}"
  }
  sensitive = true
}

output "rds_arn" {
  description = "ARN of the primary RDS instance — needed to create cross-region read replicas."
  value       = aws_db_instance.this.arn
}
