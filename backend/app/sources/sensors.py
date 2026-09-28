"""Ground-level measurements.

* Sensor.Community — ~10,000 open citizen PM sensors worldwide (5-min averages,
  keyless). Low-cost optical sensors: indicative, uncalibrated, humidity-biased;
  labelled as such in the UI.
* OpenAQ v3 — official regulatory monitors in 100+ countries (needs a free key).
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

import httpx

from ..config import settings

log = logging.getLogger("albedo.sensors")

SC_URL = "https://data.sensor.community/static/v2/data.dust.min.json"
OPENAQ_LATEST = "https://api.openaq.org/v3/parameters/2/latest"  # parameter 2 = PM2.5 µg/m³


def _ts(s: str) -> int:
    try:
        return int(datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
    except (ValueError, TypeError):
        return int(time.time())


async def fetch_sensor_community() -> list[dict]:
    async with httpx.AsyncClient(timeout=60, headers={"User-Agent": "Albedo-Watch/1.0"}) as client:
        r = await client.get(SC_URL)
        r.raise_for_status()
        rows = r.json()
    seen: dict[str, dict] = {}
    for row in rows:
        loc = row.get("location") or {}
        if str(loc.get("indoor", 0)) == "1":
            continue
        vals = {v.get("value_type"): v.get("value") for v in row.get("sensordatavalues", [])}
        try:
            pm25 = float(vals["P2"])
            pm10 = float(vals.get("P1")) if vals.get("P1") is not None else None
            lat, lon = float(loc["latitude"]), float(loc["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (0 <= pm25 <= 500) or (lat == 0 and lon == 0):
            continue
        key = str(loc.get("id"))
        rec = {"lat": round(lat, 4), "lon": round(lon, 4), "pm25": round(pm25, 1),
               "pm10": round(pm10, 1) if pm10 is not None and 0 <= pm10 <= 1000 else None,
               "t": _ts(row.get("timestamp", "")), "cc": loc.get("country") or ""}
        if key not in seen or rec["t"] > seen[key]["t"]:
            seen[key] = rec
    out = list(seen.values())
    log.info("Sensor.Community: %d outdoor PM sensors", len(out))
    return out


async def fetch_openaq(max_pages: int = 40) -> list[dict]:
    headers = {"X-API-Key": settings.openaq_api_key, "User-Agent": "Albedo-Watch/1.0"}
    out: list[dict] = []
    cutoff = time.time() - 6 * 3600
    async with httpx.AsyncClient(timeout=45, headers=headers) as client:
        for page in range(1, max_pages + 1):
            r = await client.get(OPENAQ_LATEST, params={"limit": 1000, "page": page})
            if r.status_code == 429:
                await asyncio.sleep(3)
                continue
            if r.status_code != 200:
                log.warning("OpenAQ HTTP %s", r.status_code)
                break
            res = r.json().get("results", [])
            for x in res:
                try:
                    t = int(datetime.fromisoformat(x["datetime"]["utc"].replace("Z", "+00:00")).timestamp())
                    v = float(x["value"])
                    c = x["coordinates"]
                except (KeyError, TypeError, ValueError):
                    continue
                if t < cutoff or not (0 <= v <= 1000):
                    continue
                out.append({"lat": round(c["latitude"], 4), "lon": round(c["longitude"], 4), "pm25": round(v, 1),
                            "t": t, "id": x.get("locationsId")})
            if len(res) < 1000:
                break
            await asyncio.sleep(0.3)
    log.info("OpenAQ: %d stations reporting PM2.5 in the last 6 h", len(out))
    return out
