# Invoice request queue + dead-letter queue.
# Checkout publishes here. Lambda consumes via an event source mapping
# (defined in the lambda module).

resource "aws_sqs_queue" "invoice_dlq" {
  name                       = "${var.name}-invoice-dlq"
  message_retention_seconds  = 1209600 # 14 days — max
  sqs_managed_sse_enabled    = true
}

resource "aws_sqs_queue" "invoice" {
  name                       = "${var.name}-invoice-events"
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = 345600 # 4 days
  sqs_managed_sse_enabled    = true

  # After max_receive_count failed attempts, the message moves to the DLQ.
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.invoice_dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# Alarm when anything lands in the DLQ — those are messages we permanently failed
# to process. Without this, failures are silent.
resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "${var.name}-invoice-dlq-not-empty"
  alarm_description   = "Messages have ended up in the invoice DLQ -- investigate."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.invoice_dlq.name
  }
}
