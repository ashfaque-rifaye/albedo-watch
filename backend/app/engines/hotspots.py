"""Blind-spot finder — hidden pollution hotspots.

Evidence (satellite fire radiative power + verified citizen reports) is
accumulated on a 0.5° lattice and discounted by official monitoring coverage.
High evidence × low coverage = a hotspot nobody is officially measuring.
Downwind population turns a hotspot into a priority.
"""
from __future__ import annotations

import math
import time

from ..geo import haversine_km
from ..registry import CITIES
from ..sources import google
from ..store import store
from . import attribution, datahub

CELL = 0.5
_geo_cache: dict[tuple[int, int], dict] = {}


def coverage(lat: float, lon: float) -> float:
    """0 = unmonitored … 1 = densely monitored (stations decay with 12 km scale)."""
    s = 0.0
    for c in CITIES:
        d = haversine_km(lat, lon, c.lat, c.lon)
        if d < 80:
            s += c.stations * math.exp(-d / 12)
    return 1 - math.exp(-s / 2)


async def find(limit: int = 15) -> dict:
    fires = await datahub.fires()
    reports = [r for r in store.list("reports", 500, since=time.time() - 72 * 3600)
               if r.get("analysis", {}).get("is_pollution_event")]
    cells: dict[tuple[int, int], dict] = {}

    def cell(lat, lon):
        key = (math.floor(lat / CELL), math.floor(lon / CELL))
        return cells.setdefault(key, {"key": key, "frp": 0.0, "fires": 0, "reports": 0, "report_score": 0.0,
                                      "sources": {}, "lat_s": 0.0, "lon_s": 0.0, "w": 0.0})

    for f in fires:
        c = cell(f["lat"], f["lon"])
        c["frp"] += f["frp"]; c["fires"] += 1
        c["lat_s"] += f["lat"] * f["frp"]; c["lon_s"] += f["lon"] * f["frp"]; c["w"] += f["frp"]
        c["sources"]["Satellite fire (VIIRS)"] = c["sources"].get("Satellite fire (VIIRS)", 0) + 1
    for r in reports:
        a = r["analysis"]
        c = cell(r["lat"], r["lon"])
        score = a.get("severity", 3) * (0.5 + 0.5 * r.get("verification", {}).get("score", 0.5))
        c["reports"] += 1; c["report_score"] += score
        wt = 40.0 * score
        c["lat_s"] += r["lat"] * wt; c["lon_s"] += r["lon"] * wt; c["w"] += wt
        label = a.get("source_label") or a.get("source_type", "report")
        c["sources"][f"Citizen: {label}"] = c["sources"].get(f"Citizen: {label}", 0) + 1

    ranked = []
    for c in cells.values():
        lat = c["lat_s"] / c["w"] if c["w"] else (c["key"][0] + 0.5) * CELL
        lon = c["lon_s"] / c["w"] if c["w"] else (c["key"][1] + 0.5) * CELL
        evidence = 1 - math.exp(-(c["frp"] / 180 + c["report_score"] / 4))
        cov = coverage(lat, lon)
        score = evidence * (1 - cov)
        if score < 0.15:
            continue
        ranked.append({"lat": round(lat, 4), "lon": round(lon, 4), "evidence": round(evidence, 3),
                       "coverage": round(cov, 3), "score": round(score, 3), "fires": c["fires"],
                       "frp": round(c["frp"], 1), "reports": c["reports"], "signals": c["sources"],
                       "place": attribution.nearest_place(lat, lon)})
    ranked.sort(key=lambda h: -h["score"])
    # Enforcement hotspots must be inside India (fires across the border still
    # count for attribution). Google reverse geocoding decides the country.
    top = []
    for h in ranked[:limit * 4]:
        key = (round(h["lat"] * 10), round(h["lon"] * 10))
        if key not in _geo_cache:
            _geo_cache[key] = await google.reverse_geocode(h["lat"], h["lon"])
        h["admin"] = _geo_cache[key]
        country = h["admin"].get("country") or ("IN" if h["place"]["km"] < 250 else "?")
        if country != "IN":
            continue
        top.append(h)
        if len(top) >= limit:
            break

    field = await datahub.wind_field()
    import asyncio
    dws = await asyncio.to_thread(lambda: [attribution.downwind(field, h["lat"], h["lon"], hours=12) for h in top])
    for h, dw in zip(top, dws):
        h["downwind"] = {"cities": dw["cities"][:4], "pop_at_risk_m": dw["pop_at_risk_m"]}
        h["priority"] = round(h["score"] * (1 + math.log1p(10 * dw["pop_at_risk_m"])), 3)
        h["why"] = _why(h)
    top.sort(key=lambda h: -h["priority"])
    return {
        "hotspots": top, "cells_scanned": len(cells), "fires": len(fires), "reports": len(reports),
        "unmonitored_share": round(sum(1 for h in ranked if h["coverage"] < 0.1) / max(1, len(ranked)), 3),
        "method": "0.5° lattice · evidence = 1−exp(−(FRP/180 + reports/4)) · × (1 − station coverage) · priority × downwind population",
    }


def _why(h: dict) -> str:
    parts = []
    if h["fires"]:
        parts.append(f"{h['fires']} satellite fire detections ({h['frp']:.0f} MW FRP) in 48 h")
    if h["reports"]:
        parts.append(f"{h['reports']} citizen report{'s' if h['reports'] > 1 else ''}")
    cov = "no official monitor nearby" if h["coverage"] < 0.1 else f"only {int(h['coverage'] * 100)}% monitoring coverage"
    dw = h["downwind"]["cities"]
    tail = f"; smoke reaches {dw[0]['name']} in ~{dw[0]['eta_h']:.0f} h" if dw else ""
    return f"{' + '.join(parts)}, {cov}{tail}."
