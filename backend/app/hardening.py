"""Production middleware: rate limiting, security headers, request logging.

Dependency-free (in-memory) by design — Cloud Run runs a single container for
this app, so a process-local fixed-window limiter is sufficient and keeps the
$0 budget intact. If the service ever scales out, swap for a shared store.
"""
import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("albedo")

# path prefixes that are static content — never rate-limited
_STATIC_PREFIXES = ("/assets/", "/favicon", "/icons/", "/manifest")


def request_id(request: Request) -> str:
    """Propagate an inbound correlation id, or mint a short one."""
    inbound = request.headers.get("x-request-id")
    return inbound.strip()[:64] if inbound else uuid.uuid4().hex[:12]

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self), payment=()",
}


class RateLimiter:
    """Fixed-window per-client limiter (requests / minute)."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: dict[str, tuple[int, int]] = {}  # ip -> (window, count)

    def allow(self, ip: str) -> bool:
        window = int(time.time() // 60)
        w, count = self._hits.get(ip, (window, 0))
        if w != window:
            count = 0
        count += 1
        self._hits[ip] = (window, count)
        # opportunistic cleanup so the map can't grow unbounded
        if len(self._hits) > 10_000:
            self._hits = {k: v for k, v in self._hits.items() if v[0] == window}
        return count <= self.per_minute


def client_ip(request: Request) -> str:
    # Cloud Run puts the real client at the front of X-Forwarded-For.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def install(app: FastAPI, rate_per_minute: int) -> None:
    limiter = RateLimiter(rate_per_minute)

    @app.middleware("http")
    async def _observe(request: Request, call_next):
        path = request.url.path
        static = path.startswith(_STATIC_PREFIXES) or "." in path.rsplit("/", 1)[-1]

        rid = request_id(request)
        request.state.request_id = rid  # available to handlers
        base_headers = {"X-Request-Id": rid, **_SECURITY_HEADERS}

        if not static and not limiter.allow(client_ip(request)):
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded — try again in a minute.", "request_id": rid},
                headers={"Retry-After": "60", **base_headers},
            )

        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.exception("[%s] unhandled error on %s %s", rid, request.method, path)
            return JSONResponse(
                status_code=500,
                content={"detail": "Internal server error.", "request_id": rid},
                headers=base_headers,
            )
        if not static:
            log.info(
                "[%s] %s %s -> %s (%.0f ms)",
                rid, request.method, path, response.status_code,
                (time.perf_counter() - start) * 1000,
            )
        for k, v in base_headers.items():
            response.headers.setdefault(k, v)
        return response
