from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from shared.config import settings
from shared.errors import register_error_handlers, success


REQUEST_ID_HEADER = "X-Request-ID"
MAX_REQUEST_ID_LENGTH = 128


def request_id_from(request: Request) -> str:
    incoming = request.headers.get(REQUEST_ID_HEADER, "").strip()
    if incoming and len(incoming) <= MAX_REQUEST_ID_LENGTH:
        return incoming
    return str(uuid4())


def create_app(service_name: str, lifespan: Callable | None = None) -> FastAPI:
    app = FastAPI(
        title=f"ShopCloud {service_name} service",
        version="2.0.0-fastapi",
        docs_url="/docs",
        redoc_url=None,
        lifespan=lifespan,
        root_path=settings.root_path,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def common_headers(request: Request, call_next):
        request_id = request_id_from(request)
        request.state.request_id = request_id

        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    @app.get("/health")
    async def health():
        return success(
            {
                "service": service_name,
                "status": "healthy",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    register_error_handlers(app)
    return app
