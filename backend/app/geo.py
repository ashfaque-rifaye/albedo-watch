"""Small geodesy helpers (no heavy GIS deps)."""
from __future__ import annotations

import math

R_KM = 6371.0
INDIA_BBOX = (6.0, 66.0, 37.5, 98.0)  # lat_min, lon_min, lat_max, lon_max (incl. transboundary IGP)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_KM * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def compass(deg: float) -> str:
    dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    return dirs[int((deg % 360) / 22.5 + 0.5) % 16]


def offset(lat: float, lon: float, dx_km: float, dy_km: float) -> tuple[float, float]:
    """Move a point by east/north kilometres (small-displacement approximation)."""
    dlat = dy_km / 111.32
    dlon = dx_km / (111.32 * max(0.1, math.cos(math.radians(lat))))
    return lat + dlat, lon + dlon


def wind_uv(speed_kmh: float, dir_from_deg: float) -> tuple[float, float]:
    """Meteorological (speed, direction *from*) → (u east, v north) in km/h."""
    rad = math.radians(dir_from_deg)
    return -speed_kmh * math.sin(rad), -speed_kmh * math.cos(rad)


def interpolate_path(points: list[tuple[float, float]], step_km: float) -> list[tuple[float, float]]:
    """Densify a polyline so consecutive samples are ≈ step_km apart."""
    out: list[tuple[float, float]] = []
    for (a_lat, a_lon), (b_lat, b_lon) in zip(points, points[1:]):
        d = haversine_km(a_lat, a_lon, b_lat, b_lon)
        n = max(1, int(d // step_km))
        for i in range(n):
            t = i / n
            out.append((a_lat + (b_lat - a_lat) * t, a_lon + (b_lon - a_lon) * t))
    if points:
        out.append(points[-1])
    return out


def in_bbox(lat: float, lon: float, bbox=INDIA_BBOX) -> bool:
    return bbox[0] <= lat <= bbox[2] and bbox[1] <= lon <= bbox[3]
