"""Web Push alerts for a citizen's hub — before unhealthy air arrives.

Subscriptions (browser endpoint + hub + health profile) live in Firestore. A
Cloud Scheduler job calls /api/push/run every two hours; each hub is checked
against its nearest city's corrected forecast and notified at most every 10 h.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time

from ..config import settings
from ..registry import CITIES
from ..geo import haversine_km
from ..store import store
from . import protect

log = logging.getLogger("albedo.push")

PROFILES = {  # highest category level that is still fine for this person outdoors
    "general": 2, "asthma": 1, "child": 1, "elderly": 1, "pregnant": 1, "heart": 1, "outdoor_worker": 2, "athlete": 1,
}
NAMES = {"general": "you", "asthma": "people with asthma", "child": "children", "elderly": "older adults", "pregnant": "pregnancy",
         "heart": "heart conditions", "outdoor_worker": "outdoor work", "athlete": "exercise"}


def sub_id(endpoint: str) -> str:
    return hashlib.sha1(endpoint.encode()).hexdigest()[:20]


def _nearest(lat: float, lon: float):
    return min(CITIES, key=lambda c: haversine_km(lat, lon, c.lat, c.lon))


def message_for(city: dict, profile: str, now: float | None = None) -> dict | None:
    """What to tell this person about the next 24 h, or None if nothing needs saying."""
    s = city["_series"]
    k0 = s["now_offset"]
    limit = PROFILES.get(profile, 2)
    ahead = [(s["time"][k], s["naqi"][k], s["level"][k]) for k in range(k0, min(len(s["time"]), k0 + 24)) if s["level"][k] is not None]
    bad = [(t, v, lvl) for t, v, lvl in ahead if lvl > limit]
    if not bad:
        return None
    t, v, lvl = max(bad, key=lambda x: x[1] or 0)
    tz = protect.tz_offset_h(city["lat"], city["lon"], city.get("country"))
    first = bad[0][0]
    hrs = max(0, round((first - (now or time.time())) / 3600))
    peak_hrs = max(0, round((t - (now or time.time())) / 3600))
    when = "now" if peak_hrs <= 1 else f"by {time.strftime('%H:%M', time.gmtime(t + tz * 3600))}"
    cat = city["peak_category"]["label"] if v == city.get("peak72") else ("Poor" if lvl == 3 else "Very poor" if lvl == 4 else "Severe" if lvl >= 5 else "Moderate")
    w = protect.windows(s["time"], s["level"], k0, tz, sensitive_max=limit)
    ok = w["outdoor_ok"][:1]
    best = f" Best time outdoors: {time.strftime('%H:%M', time.gmtime(ok[0][0] + tz * 3600))}–{time.strftime('%H:%M', time.gmtime(ok[0][1] + tz * 3600))}." if ok else ""
    return {"title": f"{city['name']}: {cat} air {when}",
            "body": f"{city['index_system']} up to {v} around {time.strftime('%H:%M', time.gmtime(t + tz * 3600))}. "
                    f"Unhealthy for {NAMES.get(profile, 'you')}: keep windows shut, limit time outside.{best}",
            "url": f"/app?mode=place&lat={city['lat']:.4f}&lon={city['lon']:.4f}", "level": lvl}


def send(sub: dict, payload: dict) -> bool:
    from pywebpush import WebPushException, webpush
    try:
        webpush(subscription_info=sub["subscription"], data=json.dumps(payload),
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": "https://albedo-watch-621000818329.asia-south1.run.app"}, ttl=6 * 3600)
        return True
    except WebPushException as exc:
        code = getattr(exc.response, "status_code", None)
        if code in (404, 410):  # the browser unsubscribed: forget it
            sub["disabled"] = True
            store.put("push_subs", sub)
        log.info("push failed (%s)", code)
        return False


async def run(cities: list[dict], force: bool = False) -> dict:
    by_id = {c["id"]: c for c in cities}
    sent = checked = 0
    for sub in store.list("push_subs", 1000):
        if sub.get("disabled"):
            continue
        checked += 1
        city = by_id.get(_nearest(sub["lat"], sub["lon"]).id)
        if not city:
            continue
        msg = message_for(city, sub.get("profile", "general"))
        if not msg or (not force and time.time() - sub.get("last_sent", 0) < 10 * 3600):
            continue
        if await asyncio.to_thread(send, sub, msg):
            sub["last_sent"] = time.time()
            store.put("push_subs", sub)
            sent += 1
    return {"checked": checked, "sent": sent}
