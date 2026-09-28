"""Indian National Air Quality Index (CPCB, 2014).

Sub-index per pollutant by piecewise-linear interpolation over the CPCB
breakpoints; NAQI = max sub-index (needs ≥1 of PM2.5 / PM10). PM uses 24-h
averages, CO/O3 8-h, others 24-h — callers pass the appropriate averages.
Also maps NAQI onto GRAP stages (CAQM, 2024 revision).
"""
from __future__ import annotations

_IDX = [(0, 50), (51, 100), (101, 200), (201, 300), (301, 400), (401, 500)]

# concentration breakpoints (µg/m³; CO in mg/m³)
_BP: dict[str, list[tuple[float, float]]] = {
    "pm25": [(0, 30), (31, 60), (61, 90), (91, 120), (121, 250), (251, 380)],
    "pm10": [(0, 50), (51, 100), (101, 250), (251, 350), (351, 430), (431, 600)],
    "no2":  [(0, 40), (41, 80), (81, 180), (181, 280), (281, 400), (401, 800)],
    "so2":  [(0, 40), (41, 80), (81, 380), (381, 800), (801, 1600), (1601, 2400)],
    "o3":   [(0, 50), (51, 100), (101, 168), (169, 208), (209, 748), (749, 1000)],
    "co":   [(0, 1.0), (1.1, 2.0), (2.1, 10), (10.1, 17), (17.1, 34), (34.1, 50)],
}

CATEGORIES = [
    (50, "Good", "#2bb673"),
    (100, "Satisfactory", "#9ccc3a"),
    (200, "Moderate", "#f2c230"),
    (300, "Poor", "#f08a24"),
    (400, "Very Poor", "#e0452b"),
    (10_000, "Severe", "#9b1c3a"),
]

LABELS = {
    "pm25": "PM2.5", "pm10": "PM10", "no2": "NO₂", "so2": "SO₂", "o3": "O₃", "co": "CO",
}

HEALTH = {
    "Good": "Minimal impact.",
    "Satisfactory": "Minor breathing discomfort to sensitive people.",
    "Moderate": "Breathing discomfort for people with lung/heart disease, children and older adults.",
    "Poor": "Breathing discomfort to most people on prolonged exposure.",
    "Very Poor": "Respiratory illness on prolonged exposure.",
    "Severe": "Affects healthy people; seriously impacts those with existing disease.",
}


def sub_index(pollutant: str, conc: float | None) -> float | None:
    if conc is None or conc != conc or conc < 0:  # None / NaN / negative
        return None
    bps = _BP[pollutant]
    for (lo, hi), (ilo, ihi) in zip(bps, _IDX):
        if conc <= hi:
            lo = min(lo, conc)
            return ilo + (ihi - ilo) * (conc - lo) / max(hi - lo, 1e-9)
    # beyond scale: extrapolate on the top band, cap at 500
    lo, hi = bps[-1]
    return min(500.0, 401 + 99 * (conc - lo) / (hi - lo))


def naqi(conc: dict[str, float | None]) -> tuple[int | None, str | None]:
    """Return (index, dominant pollutant code)."""
    subs = {p: sub_index(p, conc.get(p)) for p in _BP}
    subs = {p: v for p, v in subs.items() if v is not None}
    if not subs or ("pm25" not in subs and "pm10" not in subs):
        return None, None
    dom = max(subs, key=subs.get)
    return int(round(subs[dom])), dom


def category(index: float | None) -> dict:
    if index is None:
        return {"label": "No data", "color": "#6b7280", "level": -1}
    for level, (ceiling, label, color) in enumerate(CATEGORIES):
        if index <= ceiling:
            return {"label": label, "color": color, "level": level, "health": HEALTH[label]}
    return {"label": "Severe", "color": "#9b1c3a", "level": 5, "health": HEALTH["Severe"]}


def grap_stage(index: float | None) -> dict:
    """CAQM GRAP (2024): I Poor 201–300 · II Very Poor 301–400 · III Severe 401–450 · IV Severe+ >450."""
    if index is None or index <= 200:
        return {"stage": 0, "name": "No GRAP stage", "trigger": "NAQI ≤ 200"}
    if index <= 300:
        return {"stage": 1, "name": "Stage I — Poor", "trigger": "NAQI 201–300"}
    if index <= 400:
        return {"stage": 2, "name": "Stage II — Very Poor", "trigger": "NAQI 301–400"}
    if index <= 450:
        return {"stage": 3, "name": "Stage III — Severe", "trigger": "NAQI 401–450"}
    return {"stage": 4, "name": "Stage IV — Severe+", "trigger": "NAQI > 450"}


def rolling_mean(values: list[float | None], window: int) -> list[float | None]:
    out: list[float | None] = []
    for i in range(len(values)):
        win = [v for v in values[max(0, i - window + 1): i + 1] if v is not None]
        out.append(sum(win) / len(win) if win else None)
    return out


# --------------------------------------------------------------------------- #
# US EPA AQI (2024 PM2.5 revision) — used outside India
# --------------------------------------------------------------------------- #
_EPA_IDX = [(0, 50), (51, 100), (101, 150), (151, 200), (201, 300), (301, 500)]
_EPA_BP = {
    "pm25": [(0.0, 9.0), (9.1, 35.4), (35.5, 55.4), (55.5, 125.4), (125.5, 225.4), (225.5, 325.4)],
    "pm10": [(0, 54), (55, 154), (155, 254), (255, 354), (355, 424), (425, 604)],
}
EPA_LABELS = ["Good", "Moderate", "Unhealthy for Sensitive Groups", "Unhealthy", "Very Unhealthy", "Hazardous"]
EPA_HEALTH = {
    "Good": "Air quality is satisfactory.",
    "Moderate": "Unusually sensitive people should consider reducing prolonged outdoor exertion.",
    "Unhealthy for Sensitive Groups": "Children, older adults and people with heart or lung disease should reduce prolonged exertion.",
    "Unhealthy": "Everyone may begin to experience health effects; sensitive groups more seriously.",
    "Very Unhealthy": "Health alert: everyone may experience more serious health effects.",
    "Hazardous": "Health warning of emergency conditions for the entire population.",
}
LEVEL_COLORS = [c for _, _, c in CATEGORIES]


def epa_aqi(conc: dict[str, float | None]) -> tuple[int | None, str | None]:
    best, dom = None, None
    for p, bps in _EPA_BP.items():
        v = conc.get(p)
        if v is None or v != v or v < 0:
            continue
        v = round(v, 1) if p == "pm25" else round(v)
        idx = 500.0
        for (lo, hi), (ilo, ihi) in zip(bps, _EPA_IDX):
            if v <= hi:
                idx = ilo + (ihi - ilo) * (v - lo) / max(hi - lo, 1e-9)
                break
        if best is None or idx > best:
            best, dom = idx, p
    return (int(round(max(0, min(500, best)))), dom) if best is not None else (None, None)


def index_for(system: str, conc: dict[str, float | None]) -> tuple[int | None, str | None]:
    return naqi(conc) if system == "naqi" else epa_aqi({"pm25": conc.get("pm25"), "pm10": conc.get("pm10")})


def category_for(system: str, index: float | None) -> dict:
    if system == "naqi":
        return category(index) | {"system": "NAQI"}
    if index is None:
        return {"label": "No data", "color": "#6b7280", "level": -1, "system": "US AQI"}
    ceilings = [50, 100, 150, 200, 300, 10_000]
    level = next(i for i, c in enumerate(ceilings) if index <= c)
    label = EPA_LABELS[level]
    return {"label": label, "color": LEVEL_COLORS[level], "level": level, "health": EPA_HEALTH[label], "system": "US AQI"}


def stage_for(system: str, index: float | None) -> dict:
    """Graded response stage: CAQM GRAP in India; a generic 3-tier episode plan elsewhere."""
    if system == "naqi":
        return grap_stage(index) | {"framework": "GRAP"}
    lvl = category_for(system, index)["level"]
    if lvl <= 2:
        return {"stage": 0, "name": "No episode", "trigger": "US AQI ≤ 150", "framework": "Episode plan"}
    names = {3: "Alert — Unhealthy", 4: "Warning — Very Unhealthy", 5: "Emergency — Hazardous"}
    triggers = {3: "US AQI 151–200", 4: "US AQI 201–300", 5: "US AQI > 300"}
    return {"stage": lvl - 2, "name": names[lvl], "trigger": triggers[lvl], "framework": "Episode plan"}
