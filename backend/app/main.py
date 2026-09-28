"""Albedo-Watch — India's citizen-powered air-intelligence network.

One Cloud Run service: FastAPI serves the JSON API and the compiled React SPA.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import hardening
from .config import settings
from .engines import datahub, federated
from .routers import api

logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("albedo")
# httpx logs full request URLs at INFO — those carry API keys. Never let them reach logs.
for _noisy in ("httpx", "httpcore", "google_genai"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)


async def _warm():
    await datahub.warm()
    await federated.ensure_model()
    try:
        await api._cities()
        from .engines import hotspots
        from .sources import cache
        await cache.cached("hotspots:world", 900, lambda: hotspots.find("world"))
        await cache.cached("hotspots:india", 900, lambda: hotspots.find("india"))
    except Exception as exc:
        log.warning("warm-up incomplete (%s)", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = None if settings.offline else asyncio.create_task(_warm())
    yield
    if task and not task.done():
        task.cancel()


app = FastAPI(title="Albedo-Watch API", version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins_list, allow_methods=["GET", "POST"], allow_headers=["*"])
hardening.install(app, settings.rate_limit_per_minute)
app.include_router(api.router)

_STATIC = Path(__file__).resolve().parent.parent / "static"
if _STATIC.exists():
    app.mount("/assets", StaticFiles(directory=_STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        f = _STATIC / path
        if path and f.is_file() and _STATIC in f.resolve().parents:
            return FileResponse(f)
        if "." in path.rsplit("/", 1)[-1] or path.startswith("api/"):
            return JSONResponse({"detail": "not found"}, status_code=404)  # never serve the SPA for a missing asset
        return FileResponse(_STATIC / "index.html", headers={"Cache-Control": "no-cache"})
