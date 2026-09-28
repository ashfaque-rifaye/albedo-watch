"""Forecast engine — hourly NAQI for every city, spike detection with lead time,
stagnation (ventilation index) and corridor heat-strips.

PM2.5 is bias-corrected by the federated Model Commons before NAQI is computed.
"""
from __future__ import annotations

import time

from ..registry import WORLD_COUNTRIES, CITIES, CITY_BY_ID, CORRIDORS, authority_for, country_name, is_india, node_of, region_name
from . import datahub, federated
from .naqi import LABELS, LEVEL_COLORS, category_for, index_for, rolling_mean, stage_for

PAST_H = 24
AHEAD_H = 72


def _ventilation(s: dict, k: int) -> float | None:
    blh, ws = s["blh"][k], s["ws"][k]
    if blh is None or ws is None:
        return None
    # Ventilation uses the mean wind *through* the mixing layer; lift the 10 m wind
    # with the 1/7 power-law profile before multiplying by mixing height.
    ws_bl = ws / 3.6 * (max(blh, 10.0) / 10.0) ** (1 / 7) * 0.8
    return blh * ws_bl  # m²/s ; < 6000 = poor dispersion (IITM/CPCB convention)


def build_city(cid: str, s: dict) -> dict:
    city = CITY_BY_ID[cid]
    times = s["time"]
    n = len(times)
    pm25c, kinds = [], set()
    for k in range(n):
        v, kind = federated.correct(node_of(city), s, k)
        pm25c.append(v)
        kinds.add(kind)
    # PM10 shares PM2.5's bias source → apply the same correction ratio.
    pm10c = [p10 * min(2.0, max(0.25, c / r)) if p10 is not None and c is not None and r else p10
             for p10, c, r in zip(s["pm10"], pm25c, s["pm25"])]
    # O₃ / CO are excluded from the headline index: CAMS ozone carries a strong
    # coastal high bias in India and we have no ground truth to correct it yet.
    avg24 = {p: rolling_mean(vals, 24) for p, vals in (("pm25", pm25c), ("pm10", pm10c), ("no2", s["no2"]), ("so2", s["so2"]))}
    idx_series, dom_series = [], []
    for k in range(n):
        conc = {p: avg24[p][k] for p in avg24}
        i, d = index_for(city.index, conc)
        idx_series.append(i)
        dom_series.append(d)

    k0 = datahub.now_index(times)
    lo, hi = max(0, k0 - PAST_H), min(n, k0 + AHEAD_H + 1)
    now_i = idx_series[k0]
    ahead = [(k, idx_series[k]) for k in range(k0 + 1, hi) if idx_series[k] is not None]
    peak_k, peak_i = max(ahead, key=lambda kv: kv[1]) if ahead else (k0, now_i)
    system = city.index
    now_cat, peak_cat = category_for(system, now_i), category_for(system, peak_i)

    # spike: next 72 h reaches Poor+ AND is a category jump (or +60 index points)
    spike = None
    if peak_i is not None and now_i is not None and peak_cat["level"] >= 3 and (
            peak_cat["level"] > now_cat["level"] or peak_i - now_i >= 60):
        first = next(k for k, v in ahead if category_for(system, v)["level"] >= peak_cat["level"])
        spike = {
            "peak": peak_i, "peak_time": times[peak_k], "category": peak_cat["label"],
            "lead_hours": max(1, round((times[first] - time.time()) / 3600)),
            "onset_time": times[first], "grap": stage_for(system, peak_i), "peak_category": peak_cat,
        }

    vis = [_ventilation(s, k) for k in range(k0, min(n, k0 + 48))]
    # stagnation = *daytime* (10:00–17:00 IST) ventilation below 6000 m²/s; night-time
    # collapse of the mixing layer is normal and not a signal.
    stagnant_h = sum(1 for k in range(k0, min(n, k0 + 48))
                     if 10 <= (times[k] // 3600 + 5.5) % 24 <= 17 and (v := _ventilation(s, k)) is not None and v < 6000)

    trend = None
    if k0 >= 24 and idx_series[k0 - 24] is not None and now_i is not None:
        trend = now_i - idx_series[k0 - 24]

    return {
        "id": cid, "name": city.name, "local_name": city.local_name or city.name, "state": city.state or city.country,
        "state_name": region_name(city), "country": city.country, "country_name": country_name(city),
        "india": is_india(city), "index_system": "NAQI" if system == "naqi" else "US AQI",
        "region": WORLD_COUNTRIES[city.country].region,
        "lat": city.lat, "lon": city.lon,
        "pop_m": city.pop_m, "stations": city.stations, "profile": city.profile,
        "naqi": now_i, "category": now_cat, "dominant": LABELS.get(dom_series[k0] or "", None),
        "pm25": round(pm25c[k0], 1) if pm25c[k0] is not None else None,
        "pm25_cams": round(s["pm25"][k0], 1) if s["pm25"][k0] is not None else None,
        "correction": "personalised" if "personalised" in kinds else ("federated-global" if "federated-global" in kinds else "cams-raw"),
        "peak72": peak_i, "peak72_time": times[peak_k], "peak_category": peak_cat,
        "spike": spike, "trend24": trend, "grap": stage_for(system, now_i),
        "ventilation_now": round(vis[0]) if vis and vis[0] is not None else None,
        "stagnant_hours_48": stagnant_h,
        "wind": {"speed": s["ws"][k0], "dir": s["wd"][k0]},
        "authority": authority_for(city),
        "_series": {
            "time": times[lo:hi], "naqi": idx_series[lo:hi], "pm25": pm25c[lo:hi], "pm25_cams": s["pm25"][lo:hi],
            "pm10": pm10c[lo:hi], "no2": s["no2"][lo:hi], "so2": s["so2"][lo:hi], "o3": s["o3"][lo:hi],
            "dust": s["dust"][lo:hi], "blh": s["blh"][lo:hi], "ws": s["ws"][lo:hi], "wd": s["wd"][lo:hi],
            "level": [category_for(system, v)["level"] for v in idx_series[lo:hi]],
            "now_offset": k0 - lo,
        },
    }


async def all_cities() -> list[dict]:
    import asyncio
    series = await datahub.city_series()
    # CPU-bound (NAQI + federated correction for ~9k city-hours): keep it off the event loop
    return await asyncio.to_thread(lambda: [build_city(c.id, series[c.id]) for c in CITIES if c.id in series])


def public(c: dict, with_series: bool = False) -> dict:
    out = {k: v for k, v in c.items() if k != "_series"}
    if with_series:
        out["series"] = c["_series"]
    return out


def pulse_summary(cities: list[dict]) -> dict:
    valid = [c for c in cities if c["naqi"] is not None]
    pop_poor = sum(c["pop_m"] for c in valid if c["category"]["level"] >= 3)
    india = [c for c in cities if c["india"]]
    spikes = sorted((c for c in cities if c["spike"]), key=lambda c: (-c["spike"]["peak"], c["spike"]["lead_hours"]))
    worst = sorted(valid, key=lambda c: (-c["category"]["level"], -c["naqi"]))[:5]
    return {
        "cities": len(cities),
        "countries": len({c["country"] for c in cities}),
        "india_cities": len(india),
        "states": len({c["state"] for c in india}),
        "pop_covered_m": round(sum(c["pop_m"] for c in cities), 1),
        "pop_poor_now_m": round(pop_poor, 1),
        "spikes_72h": len(spikes),
        "pop_spike_m": round(sum(c["pop_m"] for c in spikes), 1),
        "worst": [{"id": c["id"], "name": c["name"], "naqi": c["naqi"], "category": c["category"]["label"]} for c in worst],
        "stagnant_cities": sum(1 for c in cities if c["stagnant_hours_48"] >= 8),
        "national_median": (sorted(c["naqi"] for c in india if c["naqi"] is not None) or [None])[len([c for c in india if c["naqi"] is not None]) // 2] if india else None,
    }


def corridors(cities: list[dict]) -> list[dict]:
    by_id = {c["id"]: c for c in cities}
    out = []
    for cor in CORRIDORS:
        members = [by_id[cid] for cid in cor.cities if cid in by_id]
        if not members:
            continue
        # 6-hourly strip over the next 72 h for each city on the corridor
        strip = []
        for c in members:
            s = c["_series"]
            k0 = s["now_offset"]
            cells = []
            for h in range(0, AHEAD_H + 1, 6):
                k = k0 + h
                v = s["naqi"][k] if k < len(s["naqi"]) else None
                lv = s["level"][k] if k < len(s["level"]) else -1
                cells.append({"h": h, "naqi": v, "color": category_for("naqi", v)["color"] if lv < 0 else LEVEL_COLORS[lv]})
            strip.append({"id": c["id"], "name": c["name"], "lat": c["lat"], "lon": c["lon"], "cells": cells})
        peak = max((c["peak72"] or 0) for c in members)
        worst = max(members, key=lambda c: c["peak72"] or 0)
        out.append({
            "id": cor.id, "name": cor.name, "kind": cor.kind, "blurb": cor.blurb,
            "path": [[c["lon"], c["lat"]] for c in members],
            "peak72": peak, "peak_category": worst["peak_category"], "worst_city": worst["name"],
            "worst_time": worst["peak72_time"],
            "pop_m": round(sum(c["pop_m"] for c in members), 1),
            "spikes": sum(1 for c in members if c["spike"]),
            "strip": strip,
        })
    return out
