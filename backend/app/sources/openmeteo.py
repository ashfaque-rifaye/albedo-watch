"""Open-Meteo: CAMS global atmospheric-composition forecasts + NWP winds.

Free, keyless, multi-location. All times are UTC unix seconds so they align
with NASA FIRMS overpasses and Google AQ history.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

log = logging.getLogger("albedo.openmeteo")

AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WX_URL = "https://api.open-meteo.com/v1/forecast"

AQ_VARS = "pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide,dust,aerosol_optical_depth"
CITY_WX_VARS = "wind_speed_10m,wind_direction_10m,boundary_layer_height,relative_humidity_2m,temperature_2m,precipitation"
GRID_WX_VARS = "wind_speed_10m,wind_direction_10m"

_BATCH = 40


async def _get(client: httpx.AsyncClient, url: str, params: dict) -> list[dict]:
    for attempt in range(3):
        try:
            r = await client.get(url, params=params, timeout=45)
            if r.status_code == 429:
                await asyncio.sleep(2 + attempt * 3)
                continue
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, list) else [data]
        except httpx.HTTPError as exc:
            if attempt == 2:
                raise
            log.info("open-meteo retry %s (%s)", attempt + 1, type(exc).__name__)
            await asyncio.sleep(1.5 * (attempt + 1))
    return []


async def fetch_many(url: str, points: list[tuple[float, float]], hourly: str,
                     past_days: int, forecast_days: int, extra: dict | None = None) -> list[dict[str, Any]]:
    """Returns one dict per point: {"time": [unix...], var: [values...], ...}."""
    out: list[dict[str, Any]] = []
    async with httpx.AsyncClient(headers={"User-Agent": "Albedo-Watch/1.0 (civic air-intelligence prototype)"}) as client:
        for i in range(0, len(points), _BATCH):
            chunk = points[i:i + _BATCH]
            params = {
                "latitude": ",".join(f"{p[0]:.4f}" for p in chunk),
                "longitude": ",".join(f"{p[1]:.4f}" for p in chunk),
                "hourly": hourly,
                "past_days": past_days,
                "forecast_days": forecast_days,
                "timezone": "GMT",
                "timeformat": "unixtime",
                **(extra or {}),
            }
            rows = await _get(client, url, params)
            for row in rows:
                h = row.get("hourly") or {}
                out.append({k: v for k, v in h.items()})
            if i + _BATCH < len(points):
                await asyncio.sleep(0.4)  # be polite to the free API
    return out


async def air_quality(points: list[tuple[float, float]], past_days: int = 3, forecast_days: int = 4):
    return await fetch_many(AQ_URL, points, AQ_VARS, past_days, forecast_days)


async def city_weather(points: list[tuple[float, float]], past_days: int = 2, forecast_days: int = 4):
    return await fetch_many(WX_URL, points, CITY_WX_VARS, past_days, forecast_days)


async def grid_wind(points: list[tuple[float, float]], past_days: int = 2, forecast_days: int = 3):
    return await fetch_many(WX_URL, points, GRID_WX_VARS, past_days, forecast_days)
