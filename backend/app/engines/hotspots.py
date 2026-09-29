"""Blind-spot finder — hidden pollution hotspots, anywhere on Earth.

Evidence (satellite heat detections + verified citizen reports) is accumulated
on a 0.5° lattice and discounted by *measured* monitoring coverage: official
stations (OpenAQ when configured; India's CPCB network otherwise) and, at a
lower weight, open citizen sensors (Sensor.Community). High evidence where no
one is measuring = a blind spot. People downwind turn it into a priority.

Every number the UI shows is in plain units: detections, megawatts, kilometres
to the nearest monitor, people downwind.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import math
import time

import httpx

from ..geo import haversine_km
from ..registry import INDIA_CITIES
from ..config import settings
from ..sources import cache, gibs, google, openmeteo
from ..store import store
from . import attribution, datahub

CELL = 0.5
_geo_cache: dict[tuple[int, int], dict] = {}
_pm_cache: dict[tuple[int, int], tuple[float, float | None]] = {}


class _Index:
    """1° bucket index for nearest-neighbour queries over thousands of points."""

    def __init__(self, pts: list[dict]):
        self.b: dict[tuple[int, int], list[dict]] = {}
        for p in pts:
            self.b.setdefault((math.floor(p["lat"]), math.floor(p["lon"])), []).append(p)

    def near(self, lat: float, lon: float, ring: int = 1):
        ci, cj = math.floor(lat), math.floor(lon)
        for di in range(-ring, ring + 1):
            for dj in range(-ring, ring + 1):
                yield from self.b.get((ci + di, cj + dj), ())


def _coverage(lat, lon, official: _Index, citizen: _Index) -> tuple[float, float | None, float | None]:
    s, d_off, d_cit = 0.0, None, None
    for p in official.near(lat, lon):
        d = haversine_km(lat, lon, p["lat"], p["lon"])
        s += p.get("w", 1.0) * math.exp(-d / 12)
        d_off = d if d_off is None else min(d_off, d)
    for p in citizen.near(lat, lon):
        d = haversine_km(lat, lon, p["lat"], p["lon"])
        s += 0.3 * math.exp(-d / 5)
        d_cit = d if d_cit is None else min(d_cit, d)
    return 1 - math.exp(-s / 2), d_off, d_cit


async def _site_pm25(points: list[tuple[float, float]]) -> list[float | None]:
    """Current CAMS PM2.5 at each candidate site (one multi-point Open-Meteo call per 40)."""
    def key(p):
        return (round(p[0] * 4), round(p[1] * 4))
    todo = [p for p in points if key(p) not in _pm_cache or time.time() - _pm_cache[key(p)][0] > 3600]
    if todo and not settings.offline:
        try:
            async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "Albedo-Watch/1.0"}) as client:
                for k in range(0, len(todo), 40):
                    chunk = todo[k:k + 40]
                    r = await client.get(openmeteo.AQ_URL, params={
                        "latitude": ",".join(f"{p[0]:.3f}" for p in chunk),
                        "longitude": ",".join(f"{p[1]:.3f}" for p in chunk),
                        "current": "pm2_5,pm10", "timezone": "GMT"})
                    if r.status_code != 200:
                        break
                    rows = r.json()
                    rows = rows if isinstance(rows, list) else [rows]
                    for p, row in zip(chunk, rows):
                        _pm_cache[key(p)] = (time.time(), (row.get("current") or {}).get("pm2_5"))
        except httpx.HTTPError:
            pass
    return [(_pm_cache.get(key(p)) or (0, None))[1] for p in points]


def _confidence(c: dict) -> str:
    repeat = len(c["sats"]) > 1 or (c["t_max"] - c["t_min"]) >= 3 * 3600
    if c["reports_verified"] or (repeat and c["fires"] >= 5 and c["frp"] >= 40):
        return "high"
    if c["fires"] >= 3 or c["reports"]:
        return "medium"
    return "low"


async def find(scope: str = "world", limit: int = 20) -> dict:
    fires = await datahub.fires()
    sensors = await datahub.citizen_sensors()
    sites = await datahub.monitor_sites()
    stations = await datahub.stations()
    official_src = "OpenAQ reference monitors" if sites else "CPCB network (India, approximate counts)"
    official_pts = sites or [{"lat": c.lat, "lon": c.lon, "w": c.stations} for c in INDIA_CITIES if c.stations]
    official, citizen = _Index(official_pts), _Index(sensors)
    reports = [r for r in store.list("reports", 500, since=time.time() - 72 * 3600)
               if r.get("analysis", {}).get("is_pollution_event")]

    def in_scope(lat, lon):
        return scope != "india" or (6 <= lat <= 37.5 and 68 <= lon <= 97.5)

    cells: dict[tuple[int, int], dict] = {}

    def cell(lat, lon):
        key = (math.floor(lat / CELL), math.floor(lon / CELL))
        return cells.setdefault(key, {"key": key, "frp": 0.0, "frp_max": 0.0, "fires": 0, "reports": 0, "reports_verified": 0,
                                      "report_score": 0.0, "lat_s": 0.0, "lon_s": 0.0, "w": 0.0, "newest": 0,
                                      "t_min": 1 << 62, "t_max": 0, "sats": set()})

    for f in fires:
        if not in_scope(f["lat"], f["lon"]):
            continue
        c = cell(f["lat"], f["lon"])
        c["frp"] += f["frp"]; c["frp_max"] = max(c["frp_max"], f["frp"]); c["fires"] += 1
        c["newest"] = max(c["newest"], f["t"])
        c["t_min"] = min(c["t_min"], f.get("t0", f["t"])); c["t_max"] = max(c["t_max"], f["t"])
        c["sats"].update(f.get("sats") or [f.get("sensor", "")])
        c["lat_s"] += f["lat"] * f["frp"]; c["lon_s"] += f["lon"] * f["frp"]; c["w"] += f["frp"]
    for r in reports:
        if not in_scope(r["lat"], r["lon"]):
            continue
        a = r["analysis"]
        c = cell(r["lat"], r["lon"])
        ver = r.get("verification", {})
        score = a.get("severity", 3) * (0.5 + 0.5 * ver.get("score", 0.5))
        c["reports"] += 1; c["report_score"] += score
        c["reports_verified"] += 1 if ver.get("status") == "verified" else 0
        wt = 40.0 * score
        c["lat_s"] += r["lat"] * wt; c["lon_s"] += r["lon"] * wt; c["w"] += wt

    ranked = []
    for c in cells.values():
        if c["w"] <= 0:
            continue
        # Minimum evidence: one small detection is noise, not a hotspot.
        if not (c["reports"] or c["fires"] >= 3 or c["frp"] >= 40):
            continue
        lat, lon = c["lat_s"] / c["w"], c["lon_s"] / c["w"]
        evidence = 1 - math.exp(-(c["frp"] / 180 + c["report_score"] / 4))
        if evidence < 0.2:
            continue
        cov, d_off, d_cit = _coverage(lat, lon, official, citizen)
        score = evidence * (1 - cov)
        if score < 0.15:
            continue
        ranked.append({
            "lat": round(lat, 4), "lon": round(lon, 4), "evidence": round(evidence, 3), "coverage": round(cov, 3),
            "score": round(score, 3), "fires": c["fires"], "frp": round(c["frp"], 1), "frp_max": round(c["frp_max"], 1),
            "reports": c["reports"], "newest": c["newest"], "confidence": _confidence(c),
            "satellites": sorted(x for x in c["sats"] if x),
            "span_h": round(max(0, c["t_max"] - c["t_min"]) / 3600, 1) if c["fires"] else 0,
            "nearest_monitor_km": round(d_off) if d_off is not None else None,
            "nearest_sensor_km": round(d_cit, 1) if d_cit is not None else None,
            "place": attribution.nearest_place(lat, lon),
        })
    ranked.sort(key=lambda h: -h["score"])

    # One entry per fire complex: fold weaker candidates within 100 km into the stronger one.
    kept: list[dict] = []
    for h in ranked:
        host = next((k for k in kept if haversine_km(h["lat"], h["lon"], k["lat"], k["lon"]) < 100), None)
        if host:
            host["merged"] = host.get("merged", 0) + 1
            host["complex_fires"] = host.get("complex_fires", host["fires"]) + h["fires"]
            continue
        kept.append(h)
        if len(kept) >= limit * 3:
            break
    top = kept

    pm = await _site_pm25([(h["lat"], h["lon"]) for h in top])

    async def enrich(h, site_pm):
        field = await datahub.wind_cheap(h["lat"], h["lon"])
        dw = await asyncio.to_thread(attribution.downwind, field, h["lat"], h["lon"], 12)
        h["downwind"] = {"cities": dw["cities"][:4], "pop_at_risk_m": dw["pop_at_risk_m"]}
        h["site_pm25"] = round(site_pm, 1) if site_pm is not None else None
        # Air impact: CAMS-modelled PM2.5 at the site (CAMS assimilates fire emissions).
        # Fires that leave the air clean are real, but not a priority.
        impact = 1.0 if site_pm is None else min(2.0, max(0.15, (site_pm - 5) / 30))
        h["impact"] = (None if site_pm is None else "low" if site_pm < 12 else "high" if site_pm >= 35 else "moderate")
        conf = {"high": 1.0, "medium": 0.8, "low": 0.5}[h["confidence"]]
        # people downwind dominate: smoke over empty land ranks below smoke heading for a town
        h["priority"] = round(h["score"] * impact * conf * (0.25 + math.log1p(10 * dw["pop_at_risk_m"])), 3)

    await asyncio.gather(*(enrich(h, v) for h, v in zip(top, pm)))
    top.sort(key=lambda h: -h["priority"])
    top = top[:limit]
    yday = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)
    for h in top:  # Google geocoding only for what we show, cached per 0.1°
        key = (round(h["lat"] * 10), round(h["lon"] * 10))
        if key not in _geo_cache:
            _geo_cache[key] = await google.reverse_geocode(h["lat"], h["lon"])
        h["admin"] = _geo_cache[key]
        h["why"] = _why(h)
        h["image"] = {"url": gibs.snapshot_url(h["lat"], h["lon"], yday, half_deg=0.25, width=640), "date": yday.isoformat()}
    known = ranked if (sites or scope == "india") else [h for h in ranked if 6 <= h["lat"] <= 37.5 and 68 <= h["lon"] <= 97.5]
    return {
        "scope": scope, "hotspots": top, "cells_scanned": len(cells), "fires": len(fires), "reports": len(reports),
        "sensors": len(sensors), "stations": len(stations), "monitor_sites": len(sites), "official_source": official_src,
        # share of evidence far from official monitors — only where station locations are actually known
        "official_coverage_known": bool(sites) or scope == "india",
        "unmonitored_share": round(sum(1 for h in known if (h["nearest_monitor_km"] or 999) > 25) / max(1, len(known)), 3),
        "candidates": len(ranked),
        "method": "Evidence = NASA VIIRS fire radiative power (≥ 3 detections or ≥ 40 MW per 0.5° cell) + verified citizen reports · "
                  f"discounted by measured monitoring coverage ({official_src}; citizen sensors at 30% weight) · one entry per "
                  "fire complex (100 km) · weighted by CAMS-modelled PM2.5 at the site, detection confidence and people downwind in 12 h",
    }


def _why(h: dict) -> str:
    parts = []
    if h["fires"]:
        parts.append(f"{h['fires']} satellite heat detection{'s' if h['fires'] > 1 else ''} in 24 h "
                     f"(largest {h['frp_max']:.0f} MW)")
    if h["reports"]:
        parts.append(f"{h['reports']} citizen report{'s' if h['reports'] > 1 else ''}")
    mon = h["nearest_monitor_km"]
    india = 6 <= h["lat"] <= 37.5 and 68 <= h["lon"] <= 97.5
    if mon is not None:
        cov = f"nearest official monitor {mon} km away"
    elif india or cache.peek("openaq_sites"):
        cov = "no official monitor within 100 km"
    else:
        cov = "official monitor locations not yet connected here"
    air = f"; CAMS models PM2.5 of {h['site_pm25']:.0f} µg/m³ here" if h.get("site_pm25") is not None else ""
    dw = h["downwind"]["cities"]
    tail = ""
    if dw:
        eta = dw[0]["eta_h"]
        tail = f"; smoke drifts over {dw[0]['name']} " + ("now" if eta < 1 else f"in ~{eta:.0f} h")
    return f"{' + '.join(parts)}; {cov}{air}{tail}."
