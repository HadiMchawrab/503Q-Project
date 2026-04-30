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

COPY shared ./shared
COPY services/__init__.py ./services/__init__.py
COPY services/catalog ./services/catalog

RUN chown -R shopcloud:shopcloud /app
USER shopcloud

CMD ["uvicorn", "services.catalog.main:app", "--host", "0.0.0.0", "--port", "3001"]