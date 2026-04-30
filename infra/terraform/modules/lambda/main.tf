# Invoice generator Lambda.
# Triggered by SQS — one invocation per batch of messages.
# Renders PDF, uploads to S3, sends via SES, updates RDS.

# ----------------------------------------------------------------------------
# ECR repo for the Lambda container image.
# CI builds the lambda/invoice_generator Dockerfile and pushes here.
# ----------------------------------------------------------------------------
resource "aws_ecr_repository" "lambda" {
  name                 = var.function_name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "lambda" {
  repository = aws_ecr_repository.lambda.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ----------------------------------------------------------------------------
# IAM execution role.
# Lambda assumes this role when it runs. The role's policies define what AWS
# APIs the function can call.
# ----------------------------------------------------------------------------
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "exec" {
  name               = "${var.function_name}-exec"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Logs to CloudWatch + ENI lifecycle for VPC-attached Lambda.
resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
resource "aws_iam_role_policy_attachment" "vpc" {
  role       = aws_iam_role.exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Permissions specific to this function: read its SQS queue, write to S3,
# send SES email, read DB password from Secrets Manager.
data "aws_iam_policy_document" "permissions" {
  statement {
    sid    = "ConsumeQueue"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
    ]
    resources = [var.sqs_queue_arn]
  }

  statement {
    sid    = "WriteInvoices"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:PutObjectAcl",
      "s3:GetObject",
    ]
    resources = ["${var.s3_bucket_arn}/*"]
  }

  statement {
    sid       = "SendEmail"
    effect    = "Allow"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"] # SES identity ARN can be more specific once verified
  }

  statement {
    sid       = "ReadDbSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.db_secret_arn]
  }
}

resource "aws_iam_role_policy" "permissions" {
  name   = "${var.function_name}-permissions"
  role   = aws_iam_role.exec.id
  policy = data.aws_iam_policy_document.permissions.json
}

# ----------------------------------------------------------------------------
# Security group — Lambda is in the VPC so it can reach RDS.
# Egress only; SQS/S3/SES are reached via VPC endpoints or NAT.
# ----------------------------------------------------------------------------
resource "aws_security_group" "lambda" {
  name        = "${var.function_name}-sg"
  description = "Egress for invoice-generator Lambda."
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ----------------------------------------------------------------------------
# Function.
# Image URI points at the ECR repo above; CI updates the tag.
# ----------------------------------------------------------------------------
resource "aws_lambda_function" "this" {
  function_name = var.function_name
  role          = aws_iam_role.exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.lambda.repository_url}:${var.image_tag}"
  timeout       = var.timeout_seconds
  memory_size   = var.memory_mb

  environment {
    variables = {
      INVOICES_BUCKET = var.s3_bucket_name
      SES_SENDER      = var.ses_sender
      DB_SECRET_ARN   = var.db_secret_arn
      DB_HOST         = var.db_host
      DB_NAME         = var.db_name
      DB_USER         = var.db_user
    }
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  # Don't fight CI: the image tag changes on every deploy, but Terraform
  # shouldn't try to roll it back.
  lifecycle {
    ignore_changes = [image_uri]
  }
}

# ----------------------------------------------------------------------------
# Event source mapping — the wiring between SQS and Lambda.
# AWS polls the queue and invokes the function. No code in the function
# needs to know about SQS polling.
# ----------------------------------------------------------------------------
resource "aws_lambda_event_source_mapping" "sqs" {
  event_source_arn = var.sqs_queue_arn
  function_name    = aws_lambda_function.this.arn
  batch_size       = 10
  enabled          = true

  # Per-record failure reporting: only failed messages get retried.
  function_response_types = ["ReportBatchItemFailures"]
}

# Open up the RDS security group so the Lambda can connect.
# This SG rule lives here (not in the data module) because it's a property
# of the Lambda's relationship to the DB, not of the DB itself.
resource "aws_security_group_rule" "lambda_to_rds" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = var.rds_security_group_id
  source_security_group_id = aws_security_group.lambda.id
  description              = "invoice-generator Lambda → RDS Postgres"
}
