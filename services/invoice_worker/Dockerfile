FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system shopcloud \
    && adduser --system --ingroup shopcloud shopcloud \
    && mkdir -p /app/invoices

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared ./shared
COPY services/__init__.py ./services/__init__.py
COPY services/invoice_worker ./services/invoice_worker

RUN chown -R shopcloud:shopcloud /app
USER shopcloud

CMD ["python", "-m", "services.invoice_worker.main"]