"""Attribution — "where is this air coming from?"

1. Ensemble back-trajectories: 7 air parcels released around the receptor are
   stepped backwards through the interpolated wind field (48 h, 30-min steps).
2. Fire coupling: every FIRMS detection whose location and time are close to a
   parcel's path adds FRP-weighted influence, decaying with transport age.
3. Apportionment: biomass share from fire influence, dust share from CAMS dust
   speciation, the rest split by the city's profile prior tilted by NO₂ / SO₂.

It is a receptor-model *proxy* — transparent, fast and explainable — not a
chemical-transport model; the UI labels it "indicative".
"""
from __future__ import annotations

import math
import time

from ..geo import bearing_deg, compass, haversine_km, offset
from ..registry import CITIES, PROFILES
from . import datahub

STEP_H = 0.5
MEMBER_OFFSETS_KM = [(0, 0)] + [(15 * math.cos(a), 15 * math.sin(a)) for a in [k * math.pi / 3 for k in range(6)]]
SECTORS = ["biomass", "transport", "industry", "dust", "residential", "construction"]
SECTOR_LABEL = {
    "biomass": "Crop-residue & open burning", "transport": "Vehicles & freight", "industry": "Industry & power",
    "dust": "Road & desert dust", "residential": "Household fuel & waste burning", "construction": "Construction & demolition",
}


def trajectories(field: datahub.WindField, lat: float, lon: float, t0: float,
                 hours: int = 48, backward: bool = True) -> list[list[dict]]:
    sign = -1.0 if backward else 1.0
    paths = []
    steps = int(hours / STEP_H)
    for dx, dy in MEMBER_OFFSETS_KM:
        la, lo = offset(lat, lon, dx, dy)
        path = [{"lat": la, "lon": lo, "t": t0, "h": 0.0}]
        for k in range(1, steps + 1):
            t = t0 + sign * (k - 0.5) * STEP_H * 3600
            u, v = field.at(la, lo, t)
            la, lo = offset(la, lo, sign * u * STEP_H, sign * v * STEP_H)
            if not (-5 < la < 45 and 55 < lo < 105):
                break
            path.append({"lat": round(la, 4), "lon": round(lo, 4), "t": t0 + sign * k * STEP_H * 3600, "h": k * STEP_H})
        paths.append(path)
    return paths


def nearest_place(lat: float, lon: float) -> dict:
    c = min(CITIES, key=lambda c: haversine_km(lat, lon, c.lat, c.lon))
    d = haversine_km(c.lat, c.lon, lat, lon)
    return {"city": c.name, "state": c.state, "km": round(d), "dir": compass(bearing_deg(c.lat, c.lon, lat, lon)),
            "label": f"{round(d)} km {compass(bearing_deg(c.lat, c.lon, lat, lon))} of {c.name}" if d > 8 else c.name}


def fire_influence(paths: list[list[dict]], fires: list[dict]) -> tuple[float, list[dict]]:
    total = 0.0
    clusters: dict[tuple[int, int], dict] = {}
    # coarse spatial index for fires
    grid: dict[tuple[int, int], list[dict]] = {}
    for f in fires:
        grid.setdefault((int(f["lat"] // 1), int(f["lon"] // 1)), []).append(f)
    for path in paths:
        for p in path[::2]:  # hourly samples
            radius = 20 + 1.2 * p["h"]
            decay = math.exp(-p["h"] / 36)
            ci, cj = int(p["lat"] // 1), int(p["lon"] // 1)
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    for f in grid.get((ci + di, cj + dj), ()):
                        if abs(f["t"] - p["t"]) > 12 * 3600:
                            continue
                        d = haversine_km(p["lat"], p["lon"], f["lat"], f["lon"])
                        if d > radius * 2:
                            continue
                        w = f["frp"] * decay * math.exp(-((d / radius) ** 2)) / len(paths)
                        total += w
                        key = (round(f["lat"] / 0.5), round(f["lon"] / 0.5))
                        cl = clusters.setdefault(key, {"weight": 0.0, "fires": set(), "lat": 0.0, "lon": 0.0, "frp": 0.0, "age_h": []})
                        cl["weight"] += w
                        if id(f) not in cl["fires"]:
                            cl["fires"].add(id(f))
                            cl["lat"] += f["lat"]; cl["lon"] += f["lon"]; cl["frp"] += f["frp"]
                            cl["age_h"].append(p["h"])
    out = []
    for cl in clusters.values():
        n = len(cl["fires"])
        lat, lon = cl["lat"] / n, cl["lon"] / n
        out.append({"lat": round(lat, 3), "lon": round(lon, 3), "fires": n, "frp": round(cl["frp"], 1),
                    "weight": cl["weight"], "transport_h": round(sum(cl["age_h"]) / len(cl["age_h"])),
                    "place": nearest_place(lat, lon)})
    out.sort(key=lambda c: -c["weight"])
    tw = sum(c["weight"] for c in out) or 1.0
    for c in out:
        c["share"] = round(c["weight"] / tw, 3)
        c["weight"] = round(c["weight"], 2)
    return total, out


def apportion(profile: str, fi: float, pm25: float | None, dust: float | None,
              no2: float | None, so2: float | None) -> dict[str, float]:
    prior = PROFILES.get(profile, PROFILES["igp_metro"])
    biomass = max(0.03, min(0.72, 0.75 * fi / (fi + 150.0)))
    dust_share = prior["dust"]
    if pm25 and dust is not None:
        dust_share = max(0.04, min(0.5, 0.3 * dust / max(pm25, 1.0)))
    rest = max(0.0, 1.0 - biomass - dust_share)
    tilt = {
        "transport": prior["transport"] * min(2.0, max(0.5, math.sqrt((no2 or 30) / 30))),
        "industry": prior["industry"] * min(2.0, max(0.5, math.sqrt((so2 or 10) / 10))),
        "residential": prior["residential"],
        "construction": prior["construction"],
    }
    tsum = sum(tilt.values()) or 1.0
    shares = {"biomass": biomass, "dust": dust_share} | {k: rest * v / tsum for k, v in tilt.items()}
    return {k: round(shares[k], 3) for k in SECTORS}


async def attribute_city(city_row: dict) -> dict:
    field, fires = await datahub.wind_field(), await datahub.fires()
    import asyncio
    t0 = time.time()

    def work():
        p = trajectories(field, city_row["lat"], city_row["lon"], t0)
        return (p, *fire_influence(p, fires))

    paths, fi, clusters = await asyncio.to_thread(work)
    s = city_row["_series"]
    k = s["now_offset"]
    shares = apportion(city_row["profile"], fi, s["pm25"][k], s["dust"][k], s["no2"][k], s["so2"][k])
    pm = city_row["pm25"] or 0.0
    return {
        "city": city_row["id"], "name": city_row["name"],
        "paths": [[[p["lon"], p["lat"], p["h"]] for p in path] for path in paths],
        "fire_influence": round(fi, 1),
        "clusters": clusters[:12],
        "fires_considered": len(fires),
        "sources": [{"key": k2, "label": SECTOR_LABEL[k2], "share": v, "ugm3": round(v * pm, 1)} for k2, v in
                    sorted(shares.items(), key=lambda kv: -kv[1])],
        "pm25": city_row["pm25"],
        "method": "48 h ensemble back-trajectories (7 members) × NASA FIRMS VIIRS FRP; CAMS dust speciation; profile priors (indicative)",
    }


def downwind(field: datahub.WindField, lat: float, lon: float, hours: int = 12) -> dict:
    """Forward plume: where will this source's smoke go, and who lives there?"""
    paths = trajectories(field, lat, lon, time.time(), hours=hours, backward=False)
    hit: dict[str, dict] = {}
    for path in paths:
        for p in path:
            for c in CITIES:
                d = haversine_km(p["lat"], p["lon"], c.lat, c.lon)
                if d < 25 and (c.id not in hit or p["h"] < hit[c.id]["eta_h"]):
                    hit[c.id] = {"id": c.id, "name": c.name, "pop_m": c.pop_m, "eta_h": round(p["h"], 1)}
    return {
        "paths": [[[p["lon"], p["lat"], p["h"]] for p in path] for path in paths],
        "cities": sorted(hit.values(), key=lambda c: c["eta_h"]),
        "pop_at_risk_m": round(sum(c["pop_m"] for c in hit.values()), 2),
    }
