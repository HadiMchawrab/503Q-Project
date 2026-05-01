"""End-to-end smoke test for the local docker-compose stack.

Only valid in local dev mode (APP_ENV != production and no Cognito configured) —
exercises the HS256 /login + /register path. Refuses to run otherwise.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request


BASE_URL = "http://localhost:8080"


def request(path: str, method: str = "GET", token: str | None = None, body: dict | None = None) -> dict:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE_URL + path, data=payload, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    print("Checking ShopCloud gateway...")
    for _ in range(40):
        try:
            request("/api/catalog/categories")
            break
        except Exception:
            time.sleep(1)
    else:
        print("Gateway/catalog did not become ready.")
        return 1

    config = request("/api/auth/config")
    if config.get("mode") != "local":
        print(f"Smoke test only runs in local mode (got mode={config.get('mode')}).")
        return 1

    products = request("/api/catalog/products")
    count = products.get("count", 0)
    print(f"Catalog products: {count}")
    if count < 1:
        print("No products returned from catalog.")
        return 1

    unique = int(time.time())
    customer = request(
        "/api/auth/register",
        method="POST",
        body={"name": "Smoke Customer", "email": f"smoke.{unique}@shopcloud.local", "password": "Customer123!"},
    )
    customer_token = customer["token"]
    first_product = products["products"][0]
    request(
        "/api/cart/items",
        method="POST",
        token=customer_token,
        body={"productId": first_product["id"], "quantity": 1},
    )
    cart = request("/api/cart/", token=customer_token)
    if cart["cart"].get("item_count") != 1:
        print("Cart check failed.")
        return 1
    print("Customer register/cart flow: OK")

    login = request(
        "/api/auth/login",
        method="POST",
        body={"email": "admin@shopcloud.local", "password": "Admin123!"},
    )
    token = login["token"]
    summary = request("/api/admin/summary", token=token)
    print("Admin summary:", summary["summary"])
    print("Smoke test passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
