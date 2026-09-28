"""NASA GIBS / Worldview snapshots — today's real satellite picture of any place.

VIIRS true-colour imagery (NOAA-20 / S-NPP) with the VIIRS thermal-anomaly
layer on top. U.S. public domain, keyless. Daily composites fill in as the
satellites pass, so "today" can be partial; yesterday is always complete.
"""
from __future__ import annotations

import datetime as dt

import httpx

SNAPSHOT = "https://wvs.earthdata.nasa.gov/api/v1/snapshot"
LAYERS = "VIIRS_NOAA20_CorrectedReflectance_TrueColor,VIIRS_NOAA20_Thermal_Anomalies_375m_All"


def snapshot_url(lat: float, lon: float, day: dt.date, half_deg: float = 0.35, width: int = 900) -> str:
    height = int(width * 0.75)
    bbox = f"{lat - half_deg * 0.75:.4f},{lon - half_deg:.4f},{lat + half_deg * 0.75:.4f},{lon + half_deg:.4f}"
    return (f"{SNAPSHOT}?REQUEST=GetSnapshot&TIME={day.isoformat()}&BBOX={bbox}&CRS=EPSG:4326"
            f"&LAYERS={LAYERS}&WIDTH={width}&HEIGHT={height}&FORMAT=image/jpeg")


def recent(lat: float, lon: float) -> list[dict]:
    today = dt.datetime.now(dt.timezone.utc).date()
    return [{"date": d.isoformat(), "label": label, "url": snapshot_url(lat, lon, d)}
            for d, label in ((today, "Today (may be partial)"), (today - dt.timedelta(days=1), "Yesterday"))]


async def fetch(url: str) -> bytes | None:
    from ..config import settings
    if settings.offline:
        return None
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            r = await client.get(url)
        if r.status_code == 200 and r.headers.get("content-type", "").startswith("image") and len(r.content) > 4000:
            return r.content
    except httpx.HTTPError:
        pass
    return None
