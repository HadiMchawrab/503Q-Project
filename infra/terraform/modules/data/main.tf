# RDS Postgres (Multi-AZ) and ElastiCache Redis (Multi-AZ).
# Both placed in the database subnets, both locked to ingress from the EKS node SG only.
#
# Per-environment data isolation (Option 1, same instance):
# This module also provisions one Postgres database per logical environment
# (default: shopcloud_prod, shopcloud_dev) on the SAME RDS instance. Pods in
# the prod namespace connect to shopcloud_prod; dev pods connect to shopcloud_dev.
# The master db_name (`shopcloud`) is created by RDS but not used by the app.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = "~> 1.22"
    }
  }
}

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
  engine_version = "16.13"
  instance_class = "db.t3.micro" # smallest available; bump for real load

  allocated_storage     = 20
  max_allocated_storage = 100 # storage autoscaling cap
  storage_encrypted     = true

  db_name  = "shopcloud"
  username = var.db_username
  password = var.db_password

  # Free-tier-eligible accounts cannot use Multi-AZ or backup_retention > 0.
  # For real prod, set multi_az = true and backup_retention_period >= 7.
  multi_az               = false
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  backup_retention_period = 0    # 0 = no automated backups (required by free tier)
  skip_final_snapshot     = true # set to false in real prod

  tags = { Name = "${var.name}-postgres" }
}

# ----------------------------------------------------------------------------
# Per-environment Postgres databases on the same instance.
#
# IMPORTANT: this provisioner connects to RDS. RDS lives in private subnets,
# so the machine running `terraform apply` must be able to reach
# aws_db_instance.this.address — typically a bastion host or a CI runner with
# VPC access. From a laptop outside the VPC this WILL HANG until timeout.
# If you can't reach RDS, set var.create_per_env_databases = false and run
# the CREATE DATABASE statements manually from a bastion.
# ----------------------------------------------------------------------------
provider "postgresql" {
  alias            = "rds"
  host             = aws_db_instance.this.address
  port             = aws_db_instance.this.port
  database         = aws_db_instance.this.db_name # default master DB
  username         = var.db_username
  password         = var.db_password
  sslmode          = "require"
  connect_timeout  = 15
  superuser        = false
  expected_version = "16"
}

resource "postgresql_database" "per_env" {
  for_each = var.create_per_env_databases ? toset(var.environment_databases) : toset([])
  provider = postgresql.rds

  name              = each.key
  owner             = var.db_username
  template          = "template0"
  lc_collate        = "C"
  lc_ctype          = "C"
  connection_limit  = -1
  allow_connections = true
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
