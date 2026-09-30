"""Live news photos about smoke, smog and fires (GDELT DOC 2.0 — open, keyless).

Each article is pinned to the monitored city it names, so a notification can fly
the globe to the place the photo is about. Articles we cannot place are dropped;
images are shown with their source and a link back to the publisher.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone

import httpx

from ..config import settings
from ..registry import CITIES, STATES, WORLD_COUNTRIES

log = logging.getLogger("albedo.news")

GDELT = "https://api.gdeltproject.org/api/v2/doc/doc"
QUERIES = (
    '(smog OR "air pollution" OR "air quality" OR "stubble burning" OR "crop burning" OR "forest fire" '
    'OR wildfire OR haze OR "dust storm" OR "toxic air")',
    # India-first: regional press covers the local stories international wires miss
    '(smog OR pollution OR AQI OR "stubble burning" OR parali OR "farm fires" OR haze) sourcecountry:IN',
)

# longest names first so "New Delhi" wins over "Delhi"
_NAMES = sorted({(c.name, c.id) for c in CITIES} | {(c.local_name, c.id) for c in CITIES if c.local_name and c.local_name.isascii()},
                key=lambda x: -len(x[0]))
_RX = re.compile(r"\b(" + "|".join(re.escape(n) for n, _ in _NAMES) + r")\b", re.I)
_BY_NAME = {n.lower(): cid for n, cid in _NAMES}
_CITY = {c.id: c for c in CITIES}
# a story that names a state or a country is pinned to its largest monitored city
_BIGGEST: dict[str, object] = {}
for _c in sorted(CITIES, key=lambda c: -c.pop_m):
    _BIGGEST.setdefault(("st", _c.state), _c) if _c.state else None
    _BIGGEST.setdefault(("cc", _c.country), _c)
_AREAS = {st.name.lower(): _BIGGEST.get(("st", code)) for code, st in STATES.items()}
_AREAS |= {co.name.lower(): _BIGGEST.get(("cc", code)) for code, co in WORLD_COUNTRIES.items()}
_AREAS = {k: v for k, v in _AREAS.items() if v}
_ARX = re.compile(r"\b(" + "|".join(re.escape(n) for n in sorted(_AREAS, key=len, reverse=True)) + r")\b", re.I)
# the headline itself must be about the air, not merely mention a place
_TOPIC = re.compile(r"smog|pollut|air quality|\baqi\b|haze|smoke|stubble|parali|crop.?burn|wildfire|forest fire|bushfire|dust ?storm|"
                    r"toxic air|emission|pm ?2\.?5|fire|प्रदूषण|स्मॉग|धुआं|पराली|एक्यूआई|जहरीली हवा", re.I)


_LOCAL = [(c.local_name, c) for c in CITIES if c.local_name and not c.local_name.isascii()]


def locate(text: str):
    for name, c in _LOCAL:  # city names in their own script (Hindi, Tamil, Chinese…)
        if name in (text or ""):
            return c
    m = _RX.search(text or "")
    if m:
        return _CITY.get(_BY_NAME.get(m.group(1).lower()))
    m = _ARX.search(text or "")
    return _AREAS.get(m.group(1).lower()) if m else None


def _ts(s: str) -> int:
    try:
        return int(datetime.strptime(s, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).timestamp())
    except (TypeError, ValueError):
        return 0


async def fetch_news() -> list[dict]:
    if settings.offline:
        return []
    articles: list[dict] = []
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "Albedo-Watch/1.0 (civic air-quality prototype)"}) as client:
        for qi, q in enumerate(QUERIES):
            params = {"query": q, "mode": "artlist", "format": "json", "maxrecords": 200, "timespan": "36h", "sort": "datedesc"}
            if qi:
                await asyncio.sleep(6)  # GDELT allows one request per 5 s
            for attempt in range(3):
                r = await client.get(GDELT, params=params)
                if r.status_code != 429:
                    break
                await asyncio.sleep(7 * (attempt + 1))
            if r.status_code == 200 and r.text.lstrip().startswith("{"):
                articles += r.json().get("articles", [])
    if not articles:
        raise RuntimeError("GDELT unavailable")
    out, seen = [], set()
    for a in sorted(articles, key=lambda a: a.get("seendate", ""), reverse=True):
        title, img = (a.get("title") or "").strip(), a.get("socialimage") or ""
        if not title or not img.startswith("https://") or not _TOPIC.search(title):
            continue
        key = re.sub(r"\W+", "", title.lower())[:60]
        if key in seen:
            continue
        city = locate(title)
        if not city:
            continue
        seen.add(key)
        out.append({"id": f"news:{abs(hash(key)) % 10**10}", "kind": "news", "t": _ts(a.get("seendate", "")),
                    "title": title, "image": img, "url": a.get("url"), "source": a.get("domain"),
                    "lang": a.get("language"), "lat": city.lat, "lon": city.lon, "place": city.name,
                    "country": city.country, "city": city.id})
    log.info("GDELT: %d placed news photos", len(out))
    return out[:60]
