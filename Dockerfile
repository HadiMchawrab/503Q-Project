FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system shopcloud \
    && adduser --system --ingroup shopcloud shopcloud

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# All five backend services ship in the same image. Each k8s Deployment picks
# its service via `command: ["uvicorn", "services.<name>.main:app", ...]`
# (see k8s/base/*.yaml). The customer storefront is no longer in this image —
# it ships as static assets to S3 + CloudFront, see infra/terraform/modules/s3_frontend.
COPY shared ./shared
COPY services ./services

RUN chown -R shopcloud:shopcloud /app
USER shopcloud

CMD ["uvicorn", "services.auth.main:app", "--host", "0.0.0.0", "--port", "3004"]
