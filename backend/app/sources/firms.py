"""NASA FIRMS thermal-anomaly detections (VIIRS S-NPP + NOAA-20), global, last 24 h.

A *detection* is one 375 m satellite pixel that is anomalously hot during an
overpass — usually a vegetation or crop fire, sometimes a gas flare, volcano or
industrial heat source. Public NRT CSVs, no key. The two satellites pass ~50 min
apart and see the same fire twice, so detections are merged into ~1 km clusters.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone

import httpx


log = logging.getLogger("albedo.firms")

FEEDS = {
    "VIIRS S-NPP": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv",
    "VIIRS NOAA-20": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv",
}


def _parse(text: str, sensor: str) -> list[dict]:
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
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
    # merge the two satellites' views of the same fire: ~1 km clusters, max FRP, latest time
    bins: dict[tuple[int, int], dict] = {}
    for f in raw:
        k = (round(f["lat"] / 0.01), round(f["lon"] / 0.01))
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
