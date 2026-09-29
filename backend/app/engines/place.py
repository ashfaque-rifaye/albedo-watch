"""Place intelligence — everything real-time we know about one coordinate.

Used by the 3D "God's-eye" drill-down and by alerts for any location on Earth.
Nothing here is invented: each block carries its source and timestamp.
"""
from __future__ import annotations

import asyncio
import math
import time

from ..geo import bearing_deg, compass, haversine_km
from ..registry import CITIES, authority_for_country, languages_for_country
from ..sources import cache, gibs, google, openmeteo
from . import datahub, federated
from .naqi import LABELS, category_for, index_for, rolling_mean, stage_for


def _nearest_city(lat, lon):
    c = min(CITIES, key=lambda c: haversine_km(lat, lon, c.lat, c.lon))
    return c, haversine_km(lat, lon, c.lat, c.lon)


async def _point_series(lat: float, lon: float) -> dict:
    from ..config import settings
    if settings.offline:  # tests / air-gapped: reuse the nearest city's synthetic series
        c, _ = _nearest_city(lat, lon)
        s = (await datahub.city_series())[c.id]
        return {"aq": {"time": s["time"], "pm2_5": s["pm25"], "pm10": s["pm10"], "nitrogen_dioxide": s["no2"],
                       "sulphur_dioxide": s["so2"], "dust": s["dust"]},
                "wx": {"time": s["time"], "wind_speed_10m": s["ws"], "wind_direction_10m": s["wd"],
                       "boundary_layer_height": s["blh"], "relative_humidity_2m": s["rh"], "temperature_2m": s["temp"]}}
    aq, wx = await asyncio.gather(openmeteo.air_quality([(lat, lon)], past_days=1, forecast_days=3),
                                  openmeteo.city_weather([(lat, lon)], past_days=1, forecast_days=3))
    return {"aq": aq[0] if aq else {}, "wx": wx[0] if wx else {}}


async def intel(lat: float, lon: float) -> dict:
    key = f"place:{round(lat, 2)}:{round(lon, 2)}"
    return await cache.cached(key, 600, lambda: _intel(lat, lon), swr=False)


async def _intel(lat: float, lon: float) -> dict:
    geo, aq_now, sv, pts, fires, sensors, stations = await asyncio.gather(
        google.reverse_geocode(lat, lon), google.aq_current(lat, lon), google.streetview_meta(lat, lon),
        _point_series(lat, lon), datahub.fires(), datahub.citizen_sensors(), datahub.stations())
    cc = geo.get("country") or ""
    near_city, near_km = _nearest_city(lat, lon)
    cc = cc or near_city.country
    system = "naqi" if cc == "IN" else "epa"

    # ---- forecast at the exact point (bias-corrected like the city network) ----
    a, w = pts["aq"], pts["wx"]
    times = a.get("time") or []
    series = None
    if times:
        wmap = {t: i for i, t in enumerate(w.get("time") or [])}

        def col(src, name, scale=1.0):
            v = src.get(name) or []
            return [(x * scale if x is not None else None) for x in v]

        s = {"time": times, "pm25": col(a, "pm2_5"), "pm10": col(a, "pm10"), "no2": col(a, "nitrogen_dioxide"),
             "so2": col(a, "sulphur_dioxide"), "dust": col(a, "dust")}
        for src, dst in (("wind_speed_10m", "ws"), ("wind_direction_10m", "wd"), ("boundary_layer_height", "blh"),
                         ("relative_humidity_2m", "rh"), ("temperature_2m", "temp")):
            wv = w.get(src) or []
            s[dst] = [wv[wmap[t]] if t in wmap and wmap[t] < len(wv) else None for t in times]
        node = f"IN-{near_city.state}" if cc == "IN" and near_city.country == "IN" else cc
        pm25c = [federated.correct(node, s, k)[0] for k in range(len(times))]
        avg = {"pm25": rolling_mean(pm25c, 24), "pm10": rolling_mean(s["pm10"], 24),
               "no2": rolling_mean(s["no2"], 24), "so2": rolling_mean(s["so2"], 24)}
        idx = [index_for(system, {p: avg[p][k] for p in avg})[0] for k in range(len(times))]
        k0 = datahub.now_index(times)
        hi = min(len(times), k0 + 73)
        series = {"time": times[max(0, k0 - 12):hi], "index": idx[max(0, k0 - 12):hi],
                  "level": [category_for(system, v)["level"] for v in idx[max(0, k0 - 12):hi]],
                  "pm25": [round(v, 1) if v is not None else None for v in pm25c[max(0, k0 - 12):hi]],
                  "now_offset": k0 - max(0, k0 - 12)}
        ahead = [(k, v) for k, v in enumerate(idx[k0:hi]) if v is not None]
        peak_k, peak = max(ahead, key=lambda kv: kv[1]) if ahead else (0, None)
        now = {"index": idx[k0], "system": "NAQI" if system == "naqi" else "US AQI",
               "category": category_for(system, idx[k0]), "pm25": round(pm25c[k0], 1) if pm25c[k0] is not None else None,
               "pm25_cams": s["pm25"][k0], "dominant": LABELS.get(index_for(system, {p: avg[p][k0] for p in avg})[1] or "", None),
               "peak72": peak, "peak_time": times[k0 + peak_k] if ahead else None,
               "peak_category": category_for(system, peak), "stage": stage_for(system, peak)}
        weather = {"temp_c": s["temp"][k0], "rh": s["rh"][k0], "wind_kmh": s["ws"][k0], "wind_from": s["wd"][k0],
                   "wind_from_compass": compass(s["wd"][k0]) if s["wd"][k0] is not None else None,
                   "mixing_height_m": s["blh"][k0]}
    else:
        now, weather = {}, {}

    # ---- satellite heat detections nearby ----
    near_fires = []
    for f in fires:
        if abs(f["lat"] - lat) > 0.6 or abs(f["lon"] - lon) > 0.6 / max(0.2, math.cos(math.radians(lat))):
            continue
        d = haversine_km(lat, lon, f["lat"], f["lon"])
        if d <= 50:
            near_fires.append({"lat": f["lat"], "lon": f["lon"], "km": round(d, 1), "frp": f["frp"],
                               "hours_ago": round((time.time() - f["t"]) / 3600, 1), "sensor": f.get("sensor"),
                               "dir": compass(bearing_deg(lat, lon, f["lat"], f["lon"]))})
    near_fires.sort(key=lambda x: x["km"])

    # ---- ground sensors nearby ----
    def around(pts_, radius):
        out = []
        for p in pts_:
            if abs(p["lat"] - lat) > 0.5 or abs(p["lon"] - lon) > 0.7:
                continue
            d = haversine_km(lat, lon, p["lat"], p["lon"])
            if d <= radius:
                out.append({**p, "km": round(d, 1), "age_min": round((time.time() - p["t"]) / 60)})
        return sorted(out, key=lambda x: x["km"])

    cit, off = around(sensors, 10), around(stations, 25)
    cit_pm = sorted(x["pm25"] for x in cit)

    langs = ["en"] + [l for l in languages_for_country(cc, geo.get("state")) if l != "en"]
    return {
        "lat": lat, "lon": lon, "fetched_at": time.time(),
        "place": {"address": geo.get("address"), "locality": geo.get("locality"), "district": geo.get("district"),
                  "state": geo.get("state"), "country": cc,
                  "nearest_city": near_city.name, "nearest_city_id": near_city.id, "nearest_city_km": round(near_km)},
        "google_aq": aq_now,
        "forecast": {"now": now, "series": series, "source": "CAMS global forecast (Open-Meteo), bias-corrected by the Model Commons"},
        "weather": weather,
        "fires": {"within_50km": len(near_fires), "nearest": near_fires[:8],
                  "source": "NASA FIRMS VIIRS S-NPP + NOAA-20, last 24 h"},
        "citizen_sensors": {"count": len(cit), "median_pm25": cit_pm[len(cit_pm) // 2] if cit_pm else None,
                            "nearest": cit[:5], "source": "Sensor.Community (low-cost, uncalibrated)"},
        "stations": {"count": len(off), "nearest": off[:5], "source": "OpenAQ" if stations else None},
        "imagery": {"satellite": gibs.recent(lat, lon),
                    "streetview": ({"available": True, "date": sv.get("date"), "lat": sv["location"]["lat"],
                                    "lon": sv["location"]["lng"], "pano": sv.get("pano_id"),
                                    "official": "google" in (sv.get("copyright") or "").lower()}
                                   if sv.get("location") else {"available": False})},
        "languages": langs[:4],
        "authority": authority_for_country(cc, geo.get("state")),
    }
