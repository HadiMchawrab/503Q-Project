from __future__ import annotations

from uuid import UUID

from shared.errors import AppError


def parse_uuid(value: str, field_name: str = "id") -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise AppError(400, "INVALID_ID", f"Invalid {field_name}") from exc
