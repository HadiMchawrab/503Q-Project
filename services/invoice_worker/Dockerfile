# Image for the in-cluster invoice worker (KEDA-scaled SQS consumer).
# Bundles services/invoice_worker/main.py with the Lambda's handler.py so
# both code paths stay in lockstep without copy-paste.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system shopcloud \
    && adduser --system --ingroup shopcloud shopcloud

# Lambda's deps — boto3, psycopg, reportlab. Keep this in sync with
# lambda/invoice_generator/requirements.txt.
COPY lambda/invoice_generator/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Pull in the shared invoice logic and the SQS-polling entrypoint.
COPY lambda/invoice_generator ./lambda/invoice_generator
COPY services/invoice_worker ./services/invoice_worker

RUN chown -R shopcloud:shopcloud /app
USER shopcloud

CMD ["python", "-m", "services.invoice_worker.main"]
