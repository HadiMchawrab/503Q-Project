"""SQS-polling worker that renders invoices, uploads to S3, and emails via SES.

This is the in-cluster equivalent of the Lambda at lambda/invoice_generator/.
Both consume the same queue; the cluster worker exists so KEDA can scale it
to zero on idle and out to many replicas on bursts (see
k8s/base/keda-invoice-scaler.yaml). The actual invoice logic lives in the
Lambda module and is imported here verbatim — one source of truth.

Designed to run alongside the Lambda OR replace it. Not both at once: the
SQS event source mapping on the Lambda would race the worker for messages.
Disable the Lambda mapping (terraform: comment the event source mapping)
before bringing the worker up in production.
"""
from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
from typing import Any

import boto3

# Reuse the Lambda's render/upload/email/db logic.
sys.path.insert(0, "/app/lambda/invoice_generator")
from handler import process  # noqa: E402

QUEUE_URL = os.environ["INVOICE_QUEUE_URL"]
WAIT_SECONDS = int(os.environ.get("SQS_WAIT_SECONDS", "20"))   # long-poll
BATCH_SIZE = int(os.environ.get("SQS_BATCH_SIZE", "5"))
VISIBILITY_TIMEOUT = int(os.environ.get("SQS_VISIBILITY_TIMEOUT", "60"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("invoice-worker")

sqs = boto3.client("sqs")
_stop = False


def _shutdown(_signum: int, _frame: Any) -> None:
    global _stop
    log.info("shutdown signal received, draining current batch then exiting")
    _stop = True


def run() -> None:
    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)
    log.info("polling %s (batch=%d, wait=%ds)", QUEUE_URL, BATCH_SIZE, WAIT_SECONDS)

    while not _stop:
        try:
            resp = sqs.receive_message(
                QueueUrl=QUEUE_URL,
                MaxNumberOfMessages=BATCH_SIZE,
                WaitTimeSeconds=WAIT_SECONDS,
                VisibilityTimeout=VISIBILITY_TIMEOUT,
            )
        except Exception as exc:
            log.exception("receive_message failed: %r", exc)
            time.sleep(5)
            continue

        for msg in resp.get("Messages", []):
            mid = msg.get("MessageId")
            try:
                body = json.loads(msg["Body"])
                process(body)
                sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=msg["ReceiptHandle"])
                log.info("done msg=%s", mid)
            except Exception as exc:
                # Don't delete: the message becomes visible again after the
                # visibility timeout and SQS will retry, eventually moving it
                # to the DLQ via the redrive policy on the queue.
                log.exception("failure msg=%s: %r", mid, exc)


if __name__ == "__main__":
    run()
