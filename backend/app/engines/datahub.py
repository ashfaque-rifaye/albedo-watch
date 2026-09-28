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
from ..sources import cache, firms, google, openmeteo, sensors

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
# Wind fields: a fine grid over India (flagship) + on-demand regional grids anywhere
# --------------------------------------------------------------------------- #
GRID_STEP = 2.5
GRID_LATS = [5.0 + GRID_STEP * i for i in range(14)]    # India: 5 … 37.5
GRID_LONS = [65.0 + GRID_STEP * j for j in range(14)]   # India: 65 … 97.5


@dataclass
class WindField:
    times: list[int]
    u: list[list[list[float]]]   # [t][i][j] km/h
    v: list[list[list[float]]]
    lats: list[float] = None     # type: ignore[assignment]
    lons: list[float] = None     # type: ignore[assignment]

    def __post_init__(self):
        if self.lats is None:
            self.lats, self.lons = GRID_LATS, GRID_LONS

    def covers(self, lat: float, lon: float, margin: float = 0.0) -> bool:
        return (self.lats[0] + margin <= lat <= self.lats[-1] - margin
                and self.lons[0] + margin <= lon <= self.lons[-1] - margin)

    def at(self, lat: float, lon: float, t: float) -> tuple[float, float]:
        step_i = self.lats[1] - self.lats[0]
        step_j = self.lons[1] - self.lons[0]
        fi = min(max((lat - self.lats[0]) / step_i, 0), len(self.lats) - 1.001)
        fj = min(max((lon - self.lons[0]) / step_j, 0), len(self.lons) - 1.001)
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


async def _fetch_grid(lats: list[float], lons: list[float], past_days: int = 2, forecast_days: int = 3) -> WindField:
    pts = [(la, lo) for la in lats for lo in lons]
    rows = await openmeteo.grid_wind(pts, past_days=past_days, forecast_days=forecast_days)
    times = rows[0].get("time") or []
    nI, nJ = len(lats), len(lons)
    u = [[[0.0] * nJ for _ in range(nI)] for _ in times]
    v = [[[0.0] * nJ for _ in range(nI)] for _ in times]
    for idx, row in enumerate(rows):
        i, j = divmod(idx, nJ)
        ws, wd = row.get("wind_speed_10m") or [], row.get("wind_direction_10m") or []
        for k in range(len(times)):
            sp = ws[k] if k < len(ws) and ws[k] is not None else 0.0
            d = wd[k] if k < len(wd) and wd[k] is not None else 0.0
            u[k][i][j], v[k][i][j] = wind_uv(sp, d)
    return WindField(times, u, v, list(lats), list(lons))


async def _fetch_wind() -> WindField:
    return await _fetch_grid(GRID_LATS, GRID_LONS)


async def wind_field() -> WindField:
    """India's fine wind field (flagship)."""
    return await cached_or_offline("wind", settings.wind_ttl, _fetch_wind)


GLOBAL_STEP = 10.0
GLOBAL_LATS = [-70.0 + GLOBAL_STEP * i for i in range(15)]     # −70 … 70
GLOBAL_LONS = [-180.0 + GLOBAL_STEP * j for j in range(37)]    # −180 … 180


async def global_wind() -> WindField:
    """Coarse planetary wind for the globe's flow layer (10°, refreshed 6-hourly)."""
    return await cached_or_offline("wind_global", 6 * 3600,
                                   lambda: _fetch_grid(GLOBAL_LATS, GLOBAL_LONS, past_days=0, forecast_days=2))


async def wind_for(lat: float, lon: float) -> WindField:
    """Wind field for trajectories anywhere: India's fine grid, else a 2° regional grid
    (±14°) around the point, cached per 10° tile."""
    india = await wind_field()
    if india.covers(lat, lon, margin=4.0):
        return india
    clat, clon = round(lat / 10) * 10, round(lon / 10) * 10
    lats = [clat - 12 + 2 * i for i in range(13) if -80 <= clat - 12 + 2 * i <= 80]
    lons = [clon - 12 + 2 * j for j in range(13)]
    return await cached_or_offline(f"wind:{clat}:{clon}", settings.wind_ttl, lambda: _fetch_grid(lats, lons))


async def wind_cheap(lat: float, lon: float) -> WindField:
    """No new upstream calls: India's fine grid if it covers the point, else the planetary grid."""
    india = await wind_field()
    if india.covers(lat, lon, margin=1.0):
        return india
    return await global_wind()


def wind_snapshot(field: WindField, t: float, stride: int = 1) -> list[dict]:
    out = []
    for i in range(0, len(field.lats), stride):
        for j in range(0, len(field.lons), stride):
            u, v = field.at(field.lats[i], field.lons[j], t)
            out.append({"lat": field.lats[i], "lon": field.lons[j], "u": round(u, 2), "v": round(v, 2)})
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
    return await cached_or_offline("truth", max(settings.truth_ttl, 12 * 3600), _fetch_truth)


# --------------------------------------------------------------------------- #
# Ground sensors: Sensor.Community citizen network (keyless) + OpenAQ (keyed)
# --------------------------------------------------------------------------- #
async def citizen_sensors() -> list[dict]:
    return await cached_or_offline("sensors", 15 * 60, sensors.fetch_sensor_community)


async def stations() -> list[dict]:
    if not settings.openaq_api_key:
        return []
    return await cached_or_offline("openaq", 60 * 60, sensors.fetch_openaq)


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
    if key in ("sensors", "openaq"):
        return []
    if key == "wind_global" or key.startswith("wind:"):
        return _synthetic("wind")
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
    for name, fn in (("city_series", city_series), ("wind", wind_field), ("fires", fires), ("truth", truth),
                     ("wind_global", global_wind), ("sensors", citizen_sensors), ("openaq", stations)):
        try:
            await fn()
            log.info("warmed %s", name)
        except Exception as exc:
            log.warning("warm %s failed (%s)", name, type(exc).__name__)
