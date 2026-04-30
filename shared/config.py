import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    """Runtime configuration loaded from environment variables.

    The same settings object is used by every FastAPI service so local Docker Compose
    and future EKS deployments can inject configuration consistently.
    """

    environment: str = os.getenv("APP_ENV", os.getenv("PYTHON_ENV", "development"))
    port: int = int(os.getenv("PORT", "3000"))
    root_path: str = os.getenv("ROOT_PATH", "")

    jwt_secret: str = os.getenv("JWT_SECRET", "change-me-in-production")
    jwt_issuer: str = os.getenv("JWT_ISSUER", "shopcloud-local-auth")
    jwt_expiration_hours: int = int(os.getenv("JWT_EXPIRATION_HOURS", "8"))

    admin_email: str = os.getenv("ADMIN_EMAIL", "admin@shopcloud.local")
    admin_password: str = os.getenv("ADMIN_PASSWORD", "Admin123!")
    admin_name: str = os.getenv("ADMIN_NAME", "ShopCloud Admin")

    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgres://shopcloud:shopcloud@postgres:5432/shopcloud",
    )
    redis_url: str = os.getenv("REDIS_URL", "redis://redis:6379")

    catalog_service_url: str = os.getenv("CATALOG_SERVICE_URL", "http://catalog:3001")
    cart_service_url: str = os.getenv("CART_SERVICE_URL", "http://cart:3002")
    checkout_service_url: str = os.getenv("CHECKOUT_SERVICE_URL", "http://checkout:3003")
    auth_service_url: str = os.getenv("AUTH_SERVICE_URL", "http://auth:3004")
    admin_service_url: str = os.getenv("ADMIN_SERVICE_URL", "http://admin:3005")

    aws_region: str = os.getenv("AWS_REGION", "eu-west-1")
    invoice_queue_url: str = os.getenv("INVOICE_QUEUE_URL", "")


settings = Settings()
