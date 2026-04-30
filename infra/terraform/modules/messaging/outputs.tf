output "queue_url" {
  description = "Main queue URL — checkout sends messages here."
  value       = aws_sqs_queue.invoice.url
}

output "queue_arn" {
  description = "Main queue ARN — used by the Lambda event source mapping."
  value       = aws_sqs_queue.invoice.arn
}

output "dlq_arn" {
  value = aws_sqs_queue.invoice_dlq.arn
}
