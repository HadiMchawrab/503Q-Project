from __future__ import annotations

from pathlib import Path

from fastapi.staticfiles import StaticFiles

from shared.service import create_app


PUBLIC_DIR = Path(__file__).resolve().parent / "public"

app = create_app("web")
app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="static")
