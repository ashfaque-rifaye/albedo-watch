"""Data hub — assembles the national picture from live sources, cached.

* city series   — CAMS composition + NWP met for every registry city (hourly, −72 h … +96 h)
* wind field    — 2.5° wind lattice over the subcontinent, interpolated in space & time
* fires         — NASA FIRMS VIIRS detections, last 48 h
* truth         — Google AQ station-fused PM2.5 history for federated ground-truth sites
"""
from __future__ import annotations

import asyncio
import bisect
import logging
import math
import time
from dataclasses import dataclass

from ..config import settings
from ..geo import wind_uv
from ..registry import CITIES, CITY_BY_ID
from ..sources import cache, firms, google, openmeteo

log = logging.getLogger("albedo.hub")

# --------------------------------------------------------------------------- #
# City series
# --------------------------------------------------------------------------- #
_AQ_MAP = {"pm2_5": "pm25", "pm10": "pm10", "nitrogen_dioxide": "no2", "sulphur_dioxide": "so2",
           "ozone": "o3", "carbon_monoxide": "co", "dust": "dust", "aerosol_optical_depth": "aod"}
_WX_MAP = {"wind_speed_10m": "ws", "wind_direction_10m": "wd", "boundary_layer_height": "blh",
           "relative_humidity_2m": "rh", "temperature_2m": "temp", "precipitation": "rain"}


async def _fetch_city_series() -> dict[str, dict]:
    pts = [(c.lat, c.lon) for c in CITIES]
    aq, wx = await asyncio.gather(openmeteo.air_quality(pts), openmeteo.city_weather(pts, past_days=3))
    out: dict[str, dict] = {}
    for city, a, w in zip(CITIES, aq, wx):
        times = a.get("time") or []
        s: dict[str, list] = {"time": times}
        for src, dst in _AQ_MAP.items():
            vals = a.get(src) or [None] * len(times)
            if dst == "co":  # µg/m³ → mg/m³ for NAQI
                vals = [v / 1000 if v is not None else None for v in vals]
            s[dst] = vals
        wmap = {t: i for i, t in enumerate(w.get("time") or [])}
        for src, dst in _WX_MAP.items():
            wv = w.get(src) or []
            s[dst] = [wv[wmap[t]] if t in wmap and wmap[t] < len(wv) else None for t in times]
        out[city.id] = s
    return out


async def city_series() -> dict[str, dict]:
    return await cached_or_offline("city_series", settings.aq_ttl, _fetch_city_series)


# --------------------------------------------------------------------------- #
# Wind field
# --------------------------------------------------------------------------- #
GRID_STEP = 2.5
GRID_LATS = [5.0 + GRID_STEP * i for i in range(14)]    # 5 … 37.5
GRID_LONS = [65.0 + GRID_STEP * j for j in range(14)]   # 65 … 97.5


@dataclass
class WindField:
    times: list[int]
    u: list[list[list[float]]]   # [t][i][j] km/h
    v: list[list[list[float]]]

    def at(self, lat: float, lon: float, t: float) -> tuple[float, float]:
        fi = min(max((lat - GRID_LATS[0]) / GRID_STEP, 0), len(GRID_LATS) - 1.001)
        fj = min(max((lon - GRID_LONS[0]) / GRID_STEP, 0), len(GRID_LONS) - 1.001)
        i, j = int(fi), int(fj)
        di, dj = fi - i, fj - j
        k = bisect.bisect_right(self.times, t) - 1
        k = min(max(k, 0), len(self.times) - 2)
        dt = (t - self.times[k]) / max(1, self.times[k + 1] - self.times[k])
        dt = min(max(dt, 0.0), 1.0)

        def bil(g) -> float:
            return (g[i][j] * (1 - di) * (1 - dj) + g[i + 1][j] * di * (1 - dj)
                    + g[i][j + 1] * (1 - di) * dj + g[i + 1][j + 1] * di * dj)

        u = bil(self.u[k]) * (1 - dt) + bil(self.u[k + 1]) * dt
        v = bil(self.v[k]) * (1 - dt) + bil(self.v[k + 1]) * dt
        return u, v


async def _fetch_wind() -> WindField:
    pts = [(la, lo) for la in GRID_LATS for lo in GRID_LONS]
    rows = await openmeteo.grid_wind(pts)
    times = rows[0].get("time") or []
    nI, nJ = len(GRID_LATS), len(GRID_LONS)
    u = [[[0.0] * nJ for _ in range(nI)] for _ in times]
    v = [[[0.0] * nJ for _ in range(nI)] for _ in times]
    for idx, row in enumerate(rows):
        i, j = divmod(idx, nJ)
        ws, wd = row.get("wind_speed_10m") or [], row.get("wind_direction_10m") or []
        for k in range(len(times)):
            s = ws[k] if k < len(ws) and ws[k] is not None else 0.0
            d = wd[k] if k < len(wd) and wd[k] is not None else 0.0
            u[k][i][j], v[k][i][j] = wind_uv(s, d)
    return WindField(times, u, v)


async def wind_field() -> WindField:
    return await cached_or_offline("wind", settings.wind_ttl, _fetch_wind)


def wind_snapshot(field: WindField, t: float, stride: int = 1) -> list[dict]:
    """Vectors for the map's animated flow layer at time t."""
    out = []
    for i in range(0, len(GRID_LATS), stride):
        for j in range(0, len(GRID_LONS), stride):
            u, v = field.at(GRID_LATS[i], GRID_LONS[j], t)
            out.append({"lat": GRID_LATS[i], "lon": GRID_LONS[j], "u": round(u, 2), "v": round(v, 2)})
    return out


# --------------------------------------------------------------------------- #
# Fires & ground truth
# --------------------------------------------------------------------------- #
async def fires() -> list[dict]:
    return await cached_or_offline("fires", settings.fires_ttl, firms.fetch_fires)


TRUTH_CITIES = [c for c in CITIES if c.truth]


async def _fetch_truth() -> dict[str, dict[int, float]]:
    sem = asyncio.Semaphore(6)

    async def one(c):
        async with sem:
            try:
                return c.id, await google.aq_history(c.lat, c.lon, 72)
            except Exception as exc:
                log.warning("truth %s failed (%s)", c.id, type(exc).__name__)
                return c.id, {}

    pairs = await asyncio.gather(*(one(c) for c in TRUTH_CITIES))
    got = {k: v for k, v in pairs if v}
    if not got:
        raise RuntimeError("no ground truth available")
    return got


async def truth() -> dict[str, dict[int, float]]:
    return await cached_or_offline("truth", settings.truth_ttl, _fetch_truth)


# --------------------------------------------------------------------------- #
# Offline fallback: deterministic synthetic data (tests / air-gapped demos only)
# --------------------------------------------------------------------------- #
async def cached_or_offline(key: str, ttl: int, fetch):
    if settings.offline:
        return cache.peek(key) or _synthetic(key)
    return await cache.cached(key, ttl, fetch)


def _hours() -> list[int]:
    now = int(time.time() // 3600 * 3600)
    return [now + 3600 * k for k in range(-72, 96)]


def _synthetic(key: str):
    hrs = _hours()
    if key == "city_series":
        out = {}
        for n, c in enumerate(CITIES):
            base = 40 + 60 * max(0.0, (c.lat - 18) / 14) + (n % 5) * 6
            pm = [base * (1 + 0.35 * math.sin((h / 3600 + n) / 24 * 2 * math.pi)) + (k / 12) for k, h in enumerate(hrs)]
            out[c.id] = {
                "time": hrs, "pm25": pm, "pm10": [p * 1.8 for p in pm], "no2": [25.0] * len(hrs),
                "so2": [8.0] * len(hrs), "o3": [40.0] * len(hrs), "co": [0.9] * len(hrs),
                "dust": [p * 0.2 for p in pm], "aod": [0.5] * len(hrs), "ws": [8.0] * len(hrs),
                "wd": [300.0] * len(hrs), "blh": [600.0] * len(hrs), "rh": [60.0] * len(hrs),
                "temp": [28.0] * len(hrs), "rain": [0.0] * len(hrs),
            }
        return out
    if key == "wind":
        nI, nJ = len(GRID_LATS), len(GRID_LONS)
        u, v = wind_uv(12, 310)
        return WindField(hrs, [[[u] * nJ for _ in range(nI)] for _ in hrs], [[[v] * nJ for _ in range(nI)] for _ in hrs])
    if key == "fires":
        now = hrs[72]
        return [{"lat": 30.2 + 0.05 * k, "lon": 75.0 + 0.07 * k, "frp": 12.0 + k, "t": now - 3600 * (k % 20),
                 "conf": "n", "sensor": "synthetic", "day": True, "n": 1} for k in range(40)]
    if key == "truth":
        cs = _synthetic("city_series")
        return {c.id: {t: v * 0.6 for t, v in zip(cs[c.id]["time"][:72], cs[c.id]["pm25"][:72])} for c in TRUTH_CITIES}
    return None


def now_index(times: list[int]) -> int:
    return max(0, bisect.bisect_right(times, time.time()) - 1)


def city(cid: str):
    return CITY_BY_ID.get(cid)


async def warm() -> None:
    """Background warm-up so the first page view is instant."""
    for name, fn in (("city_series", city_series), ("wind", wind_field), ("fires", fires), ("truth", truth)):
        try:
            await fn()
            log.info("warmed %s", name)
        except Exception as exc:
            log.warning("warm %s failed (%s)", name, type(exc).__name__)
