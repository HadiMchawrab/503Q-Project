from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


def to_cents(value) -> int | None:
    if value is None:
        return None
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return None
    if amount < 0:
        return None
    return int(amount * 100)


def cents_to_dollars(cents: int) -> str:
    return f"{(int(cents or 0) / 100):.2f}"
