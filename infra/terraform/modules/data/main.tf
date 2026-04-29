# RDS Postgres (Multi-AZ) and ElastiCache Redis (Multi-AZ).
# Both placed in the database subnets, both locked to ingress from the EKS node SG only.

# ============================================================================
# RDS POSTGRES
# ============================================================================

# Subnet group — tells RDS which subnets it can place instances in
resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db"
  subnet_ids = var.db_subnet_ids
  tags       = { Name = "${var.name}-db-subnet-group" }
}

# Security group — only accepts Postgres traffic from EKS nodes
resource "aws_security_group" "rds" {
  name        = "${var.name}-rds"
  description = "Postgres access from EKS nodes only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Postgres from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.allowed_source_sg]
  }

  # No egress rules needed — RDS doesn't initiate outbound connections.
  # But we leave default-deny by not adding any.
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name}-postgres"
  engine         = "postgres"
  engine_version = "16.3"
  instance_class = "db.t3.micro" # smallest available; bump for real load

  allocated_storage     = 20
  max_allocated_storage = 100 # storage autoscaling cap
  storage_encrypted     = true

  db_name  = "shopcloud"
  username = var.db_username
  password = var.db_password

  multi_az               = true # synchronous standby in another AZ for HA
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  backup_retention_period = 7 # daily snapshots kept for 7 days
  skip_final_snapshot     = true # set to false in real prod

  tags = { Name = "${var.name}-postgres" }
}

# ============================================================================
# ELASTICACHE REDIS
# ============================================================================

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-redis"
  subnet_ids = var.redis_subnet_ids
}

resource "aws_security_group" "redis" {
  name        = "${var.name}-redis"
  description = "Redis access from EKS nodes only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from EKS nodes"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.allowed_source_sg]
  }
}

# Replication group = the modern Redis primitive (replaces standalone clusters).
# Multi-AZ + automatic failover gives us HA.
resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "${var.name}-redis"
  description          = "ShopCloud sessions and cart"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = "cache.t3.micro" # small to start

  num_cache_clusters         = 2 # one primary + one replica
  automatic_failover_enabled = true
  multi_az_enabled           = true

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = { Name = "${var.name}-redis" }
}
