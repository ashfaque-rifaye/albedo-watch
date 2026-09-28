"""NASA FIRMS active-fire detections (VIIRS S-NPP + NOAA-20), South Asia, last 48 h.

Public NRT CSVs — no key required. Detections are de-duplicated into ~4 km bins
(the two satellites see the same fires minutes apart).
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone

import httpx

from ..geo import in_bbox

log = logging.getLogger("albedo.firms")

FEEDS = {
    "VIIRS S-NPP": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_Asia_48h.csv",
    "VIIRS NOAA-20": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_Asia_48h.csv",
}


def _parse(text: str, sensor: str) -> list[dict]:
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
            if not in_bbox(lat, lon):
                continue
            conf = (r.get("confidence") or "n").lower()[:1]
            if conf == "l":  # drop low-confidence VIIRS detections
                continue
            t = r.get("acq_time", "0000").zfill(4)
            ts = datetime.strptime(f"{r['acq_date']} {t}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
            rows.append({
                "lat": lat, "lon": lon, "frp": float(r.get("frp") or 0.0),
                "t": int(ts.timestamp()), "conf": conf, "sensor": sensor,
                "day": (r.get("daynight") or "D") == "D",
            })
        except (KeyError, ValueError):
            continue
    return rows


async def fetch_fires() -> list[dict]:
    raw: list[dict] = []
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        for sensor, url in FEEDS.items():
            try:
                r = await client.get(url)
                r.raise_for_status()
                raw += _parse(r.text, sensor)
            except httpx.HTTPError as exc:
                log.warning("FIRMS %s unavailable (%s)", sensor, type(exc).__name__)
    if not raw:
        raise RuntimeError("no FIRMS feed reachable")
    # de-duplicate into 0.04° bins, keeping the max FRP and the latest time
    bins: dict[tuple[int, int], dict] = {}
    for f in raw:
        k = (round(f["lat"] / 0.04), round(f["lon"] / 0.04))
        b = bins.get(k)
        if b is None:
            bins[k] = {**f, "n": 1}
        else:
            b["n"] += 1
            b["frp"] = max(b["frp"], f["frp"])
            b["t"] = max(b["t"], f["t"])
    fires = sorted(bins.values(), key=lambda f: -f["frp"])
    log.info("FIRMS: %d raw → %d fires", len(raw), len(fires))
    return fires
