"""Albedo-Watch REST API."""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import math
import time
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import llm
from ..agents import citizen, command
from ..config import settings
from ..engines import attribution, datahub, federated, forecast, hotspots, place, response
from ..engines.naqi import category, grap_stage
from ..registry import CITY_BY_ID, COUNTRIES, LANGUAGE_NAMES, STATES, WORLD_COUNTRIES, languages_for_country, languages_of
from ..sources import cache, gibs, google
from ..store import store

log = logging.getLogger("albedo.api")
router = APIRouter(prefix="/api")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
async def _cities() -> list[dict]:
    await federated.ensure_model()
    return await cache.cached("cities_built", 600, forecast.all_cities)


async def _city(cid: str) -> dict:
    for c in await _cities():
        if c["id"] == cid:
            return c
    raise HTTPException(404, f"unknown city '{cid}'")


async def _attribution(cid: str) -> dict:
    c = await _city(cid)
    return await cache.cached(f"attr:{cid}", 1800, lambda: attribution.attribute_city(c))


def _freshness() -> dict:
    return {k: (round(a) if (a := cache.age_s(k)) is not None else None) for k in ("city_series", "wind", "fires", "truth")}


# --------------------------------------------------------------------------- #
# meta
# --------------------------------------------------------------------------- #
@router.get("/health")
async def health():
    return {"ok": True, "ai": llm.available(), "store": store.backend, "offline": settings.offline}


@router.get("/meta")
async def meta():
    return {
        "product": "Albedo-Watch", "model": llm.model_label(), "store": store.backend,
        "maps_browser_key": settings.google_browser_key or None,
        "states": {k: {"name": s.name, "languages": list(s.languages), "authority": s.authority} for k, s in STATES.items()},
        "languages": LANGUAGE_NAMES, "countries": COUNTRIES, "freshness": _freshness(),
        "country_languages": {k: list(v.languages) for k, v in WORLD_COUNTRIES.items()},
        "measures": response.MEASURES,
        "sources": [
            {"name": "CAMS global composition forecast (via Open-Meteo)", "use": "PM2.5, PM10, NO₂, SO₂, O₃, CO, dust — hourly, 4-day"},
            {"name": "NWP winds & boundary layer (via Open-Meteo)", "use": "wind field, ventilation index"},
            {"name": "NASA FIRMS VIIRS (S-NPP + NOAA-20)", "use": "active fires, last 48 h"},
            {"name": "Google Air Quality API — history", "use": "station-fused ground truth for federated training"},
            {"name": "Google Geocoding API", "use": "jurisdiction for reports & hotspots"},
            {"name": f"Google {llm.model_label()}", "use": "multimodal evidence, attribution narrative, alert drafting, Q&A"},
            {"name": "Gemini TTS", "use": "voice advisories in Indian languages"},
        ],
    }


# --------------------------------------------------------------------------- #
# national pulse & forecasts
# --------------------------------------------------------------------------- #
_saved: dict[str, float] = {}


def _persist(name: str, data: dict, every: int = 600) -> None:
    """Throttled snapshot to Firestore so a cold instance can answer instantly."""
    if time.time() - _saved.get(name, 0) < every:
        return
    _saved[name] = time.time()
    asyncio.get_running_loop().run_in_executor(None, store.put_blob, name, data)


def _snapshot(name: str) -> dict | None:
    key = f"snap:{name}"
    hit = cache.peek(key)
    if hit is None:
        hit = store.get_blob(name)
        if hit is not None:
            cache.put(key, hit)
    return hit


@router.get("/pulse")
async def pulse():
    if cache.peek("cities_built") is None and (snap := _snapshot("pulse")):
        asyncio.get_running_loop().create_task(_cities())  # warm in the background
        return {**snap, "stale": True}
    cities = await _cities()
    out = {
        "generated_at": time.time(), "summary": forecast.pulse_summary(cities),
        "cities": [forecast.public(c) for c in cities], "freshness": _freshness(),
        "model": federated.current().summary if federated.current() else None,
    }
    _persist("pulse", out)
    return out


@router.get("/overview")
async def overview():
    """Tiny, always-fast summary for the landing page (never waits on a rebuild)."""
    cities = cache.peek("cities_built")
    p = {"summary": forecast.pulse_summary(cities)} if cities else (_snapshot("pulse") or {})
    hs = cache.peek("hotspots:world") or _snapshot("hotspots_world") or {}
    fires = cache.peek("fires") or (await datahub.fires() if settings.offline else None)
    m = federated.current()
    commons = m.summary if m else ((_snapshot("commons") or {}).get("summary"))
    out = {
        "summary": p.get("summary"), "fires": _fire_summary(fires) if fires else (_snapshot("overview") or {}).get("fires"),
        "unmonitored_share": hs.get("unmonitored_share"), "sensors": hs.get("sensors"), "stations": hs.get("stations"),
        "commons": commons,
    }
    if all(out.get(k) is not None for k in ("summary", "fires", "commons")):
        _persist("overview", out, every=300)
    elif (snap := _snapshot("overview")):
        out = {k: (v if v is not None else snap.get(k)) for k, v in out.items()}
    return out


@router.get("/city/{cid}")
async def city_detail(cid: str):
    c = await _city(cid)
    return forecast.public(c, with_series=True)


@router.get("/timeline")
async def timeline():
    """NAQI for every city at 3-hourly steps from −24 h to +72 h (map time-scrubber)."""
    cities = await _cities()
    frames = []
    for h in range(-24, 73, 3):
        vals, lvls = {}, {}
        for c in cities:
            s = c["_series"]
            k = s["now_offset"] + h
            if 0 <= k < len(s["naqi"]):
                vals[c["id"]] = s["naqi"][k]
                lvls[c["id"]] = s["level"][k]
        t = cities[0]["_series"]["time"][cities[0]["_series"]["now_offset"]] + h * 3600 if cities else 0
        frames.append({"h": h, "t": t, "naqi": vals, "level": lvls})
    return {"frames": frames}


@router.get("/corridors")
async def corridors():
    return {"corridors": forecast.corridors(await _cities())}


@router.get("/wind")
async def wind(h: int = 0, scope: Literal["global", "india"] = "global"):
    field = await (datahub.global_wind() if scope == "global" else datahub.wind_field())
    step = field.lats[1] - field.lats[0]
    return {"h": h, "step": step, "scope": scope, "vectors": datahub.wind_snapshot(field, time.time() + h * 3600)}


def _fire_summary(f: list[dict]) -> dict:
    frps = sorted(x["frp"] for x in f)
    return {"count": len(f), "large": sum(1 for v in frps if v >= 20), "median_frp": frps[len(frps) // 2] if frps else None,
            "definition": "A detection is a ~375 m satellite pixel that was anomalously hot during a NASA VIIRS "
                          "overpass in the last 24 h — usually a crop or vegetation fire, sometimes a gas flare or "
                          "industrial heat source. Two satellites' sightings of the same fire are merged (~1 km). "
                          "Fire radiative power (FRP, megawatts) measures how intense it is: most are small (< 10 MW)."}


@router.get("/fires")
async def fires(bbox: str | None = None, limit: int = 6000):
    """World view: 1° aggregates. With bbox=w,s,e,n: individual detections inside it."""
    f = await datahub.fires()
    now = time.time()
    if bbox:
        try:
            w, so, e, n = (float(x) for x in bbox.split(","))
        except ValueError:
            raise HTTPException(422, "bbox must be w,s,e,n")
        sel = [x for x in f if so <= x["lat"] <= n and (w <= x["lon"] <= e if w <= e else (x["lon"] >= w or x["lon"] <= e))]
        sel.sort(key=lambda x: -x["frp"])
        return {**_fire_summary(sel), "mode": "detections",
                "fires": [[round(x["lat"], 4), round(x["lon"], 4), round(x["frp"], 1), round((now - x["t"]) / 3600, 1)]
                          for x in sel[:min(limit, 12000)]]}
    bins: dict[tuple[int, int], list[float]] = {}
    for x in f:
        k = (math.floor(x["lat"]), math.floor(x["lon"]))
        b = bins.setdefault(k, [0, 0.0, 0.0, 0.0, 0.0])
        b[0] += 1; b[1] += x["frp"]; b[2] = max(b[2], x["frp"]); b[3] += x["lat"]; b[4] += x["lon"]
    return {**_fire_summary(f), "mode": "aggregate",
            "bins": [[round(b[3] / b[0], 2), round(b[4] / b[0], 2), b[0], round(b[1]), round(b[2], 1)] for b in bins.values()]}


@router.get("/sensors")
async def sensors_feed():
    cit, off = await datahub.citizen_sensors(), await datahub.stations()
    now = time.time()
    return {
        "citizen": [[x["lat"], x["lon"], x["pm25"], round((now - x["t"]) / 60)] for x in cit],
        "stations": [[x["lat"], x["lon"], x["pm25"], round((now - x["t"]) / 60)] for x in off],
        "sources": {"citizen": "Sensor.Community open citizen network (low-cost optical PM sensors, uncalibrated)",
                    "stations": "OpenAQ — official regulatory monitors" if off else "OpenAQ not configured"},
    }


@router.get("/place")
async def place_intel(lat: float, lon: float):
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(422, "invalid coordinates")
    return await place.intel(lat, lon)


@router.get("/streetview")
async def streetview(lat: float, lon: float, heading: float | None = None):
    img = await google.streetview_image(lat, lon, heading)
    if not img:
        raise HTTPException(404, "no Street View imagery near this point")
    return Response(content=img, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


# --------------------------------------------------------------------------- #
# attribution, hotspots, response
# --------------------------------------------------------------------------- #
@router.get("/attribution/{cid}")
async def attribution_city(cid: str, narrate: bool = True):
    c = await _city(cid)
    a = await _attribution(cid)
    out = dict(a)
    if narrate:
        out["narrative"] = await asyncio.to_thread(command.explain_sources, c, a)
    out["city_row"] = forecast.public(c)
    return out


@router.get("/hotspots")
async def hotspot_list(scope: Literal["world", "india"] = "world"):
    key = f"hotspots:{scope}"
    if cache.peek(key) is None and (snap := _snapshot(f"hotspots_{scope}")):
        asyncio.get_running_loop().create_task(cache.cached(key, 900, lambda: hotspots.find(scope)))
        return {**snap, "stale": True}
    out = await cache.cached(key, 900, lambda: hotspots.find(scope))
    _persist(f"hotspots_{scope}", out)
    return out


class SimulateReq(BaseModel):
    city: str
    measures: list[str] = Field(default_factory=list, max_length=12)
    compliance: float = Field(0.7, ge=0.1, le=1.0)


@router.post("/simulate")
async def simulate(req: SimulateReq):
    c = await _city(req.city)
    a = await _attribution(req.city)
    shares = {s["key"]: s["share"] for s in a["sources"]}
    s = c["_series"]; k = s["now_offset"]
    pm = c["pm25"] or 0.0
    other = {"pm10": s["pm10"][k], "no2": s["no2"][k], "so2": s["so2"][k]}
    return response.simulate(pm, other, shares, req.measures, req.compliance, c["pop_m"])


# --------------------------------------------------------------------------- #
# citizen reports
# --------------------------------------------------------------------------- #
_IMG = {"image/jpeg", "image/png", "image/webp", "image/heic"}
_AUD = {"audio/webm", "audio/ogg", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac"}
_MAX = 8 * 1024 * 1024


def _thumb(data: bytes) -> str | None:
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("RGB")
        im.thumbnail((480, 480))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=72)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


@router.post("/reports")
async def create_report(
    lat: float = Form(...), lon: float = Form(...), text: str = Form(""), lang: str = Form(""),
    reporter: str = Form("citizen"),
    photos: list[UploadFile] = File(default=[]), voice: UploadFile | None = File(default=None),
):
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(422, "invalid coordinates")
    images = []
    for p in photos[:3]:
        data = await p.read()
        mime = (p.content_type or "").split(";")[0]
        if mime not in _IMG or len(data) > _MAX:
            raise HTTPException(422, f"unsupported photo ({mime or 'unknown'})")
        images.append((data, mime))
    audio = None
    if voice is not None:
        data = await voice.read()
        mime = (voice.content_type or "").split(";")[0]
        if mime not in _AUD or len(data) > _MAX:
            raise HTTPException(422, f"unsupported audio ({mime or 'unknown'})")
        if data:
            audio = (data, mime)
    if not images and not audio and not text.strip():
        raise HTTPException(422, "send a photo, a voice note or some text")
    result = await citizen.analyze(lat=lat, lon=lon, text=text, lang=lang or None, images=images, audio=audio)
    doc = {
        "lat": lat, "lon": lon, "text": text[:1500], "lang": lang, "reporter": reporter[:40],
        "thumb": _thumb(images[0][0]) if images else None, "has_voice": audio is not None,
        "status": "open", **result,
    }
    doc = store.put("reports", doc)
    cache.put("hotspots_dirty", True)
    _invalidate("hotspots:world"); _invalidate("hotspots:india")
    return doc


def _invalidate(key: str) -> None:
    from ..sources.cache import _store
    _store.pop(key, None)


@router.get("/reports")
async def list_reports(limit: int = 100):
    docs = store.list("reports", min(limit, 300))
    return {"reports": [{k: v for k, v in d.items() if k != "downwind"} | {"downwind": {"cities": d.get("downwind", {}).get("cities", [])}}
                        for d in docs]}


@router.get("/reports/{rid}")
async def get_report(rid: str):
    d = store.get("reports", rid)
    if not d:
        raise HTTPException(404, "report not found")
    return d


# --------------------------------------------------------------------------- #
# alerts (command centre)
# --------------------------------------------------------------------------- #
class DraftReq(BaseModel):
    kind: Literal["city", "hotspot", "report", "place"]
    city: str | None = None
    report_id: str | None = None
    lat: float | None = None
    lon: float | None = None
    languages: list[str] | None = Field(default=None, max_length=4)
    attach_imagery: bool = True


SAT_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "visible_smoke": {"type": "BOOLEAN"},
        "visible_haze": {"type": "BOOLEAN"},
        "cloud_cover": {"type": "STRING", "enum": ["clear", "partly cloudy", "mostly cloudy", "overcast"]},
        "observation": {"type": "STRING", "description": "2 factual sentences on what is visible; say if clouds prevent judging"},
    },
    "required": ["visible_smoke", "visible_haze", "cloud_cover", "observation"],
}


async def _satellite_evidence(lat: float, lon: float) -> dict:
    """Today's (or yesterday's) NASA VIIRS true-colour image + thermal detections.
    The image is always attached; Gemini's reading of it is best-effort."""
    for shot in gibs.recent(lat, lon):
        try:
            img = await asyncio.wait_for(gibs.fetch(shot["url"]), 12)
        except asyncio.TimeoutError:
            img = None
        if not img:
            continue
        rec = {"kind": "satellite", "date": shot["date"], "label": shot["label"], "url": shot["url"],
               "source": "NASA GIBS · VIIRS NOAA-20 true colour + thermal anomalies", "ai": None}
        if llm.available():
            prompt = ("This is a NASA VIIRS true-colour satellite image (~70 km across) centred on the location, with "
                      "red/orange dots marking thermal-anomaly (fire) detections. Describe only what is visible: smoke "
                      "plumes, regional haze, fire dots, cloud cover. Be conservative; do not speculate.")
            try:
                rec["ai"] = await asyncio.wait_for(
                    asyncio.to_thread(llm.multimodal_json, prompt, [(img, "image/jpeg")], SAT_SCHEMA, None, 30), 32)
            except asyncio.TimeoutError:
                pass
        return rec
    return {}


def _languages(default: list[str], requested: list[str] | None) -> list[str]:
    langs = [l for l in (requested or default) if l]
    if not requested and "en" not in langs:
        langs = ["en"] + langs
    seen: list[str] = []
    for l in langs:
        if l not in seen:
            seen.append(l)
    return seen[:4]


@router.post("/alerts/draft")
async def draft(req: DraftReq):
    evidence_imgs: list[dict] = []
    if req.kind == "city":
        if not req.city:
            raise HTTPException(422, "city required")
        c = await _city(req.city)
        a = await _attribution(req.city)
        city = CITY_BY_ID[req.city]
        peak_cat = c["peak_category"]["label"]
        ctx = {
            "place": c["name"], "state": c["state_name"], "country": c["country_name"],
            "authority": c["authority"]["primary"], "framework": c["authority"]["framework"],
            "index_system": c["index_system"], "index_now": c["naqi"], "category": c["category"]["label"],
            "index_peak_72h": c["peak72"], "peak_category": peak_cat, "spike": c["spike"],
            "response_stage": c["spike"]["grap"] if c["spike"] else c["grap"],
            "pm25": c["pm25"], "population_m": c["pop_m"], "stagnant_daytime_hours_next_48": c["stagnant_hours_48"],
            "sources": {x["label"]: x["share"] for x in a["sources"]},
            "upwind_fire_clusters": [f"{x['place']['label']} ({x['fires']} detections, ~{x['transport_h']} h transport)"
                                     for x in a["clusters"][:3]],
            "summary": f"{c['name']} {c['index_system']} {c['naqi']} ({c['category']['label']}); 72 h peak {c['peak72']} ({peak_cat}).",
        }
        lat, lon = c["lat"], c["lon"]
        default_langs = list(languages_of(city))
        target = {"kind": "city", "id": c["id"], "lat": lat, "lon": lon, "name": c["name"]}
    elif req.kind == "report":
        r = store.get("reports", req.report_id or "")
        if not r:
            raise HTTPException(404, "report not found")
        an, j = r["analysis"], r["jurisdiction"]
        ctx = {
            "place": j.get("locality") or j.get("district") or j["city"], "state": j["state"],
            "authority": j["route_to"], "category": f"citizen-reported {an['source_label'].lower()}",
            "report": {"summary": an.get("summary_en"), "severity": an["severity"], "evidence": an.get("visual_evidence"),
                       "verification": r["verification"]["status"], "verification_score": r["verification"]["score"]},
            "nearby_satellite_detections": r["verification"]["nearby_fires"][:3],
            "downwind_cities": r.get("downwind", {}).get("cities", []),
            "response_stage": {"stage": 0, "name": "Source-level enforcement"}, "summary": an.get("summary_en"),
        }
        lat, lon = r["lat"], r["lon"]
        cc = j.get("country_code") or ("IN" if j.get("state_code") else "")
        default_langs = list(languages_for_country(cc or "IN", j.get("state")))
        target = {"kind": "report", "id": r["id"], "lat": lat, "lon": lon, "name": ctx["place"]}
    else:
        if req.lat is None or req.lon is None:
            raise HTTPException(422, "lat/lon required")
        lat, lon = req.lat, req.lon
        p = await place.intel(lat, lon)
        pl = p["place"]
        name = pl.get("locality") or pl.get("district") or pl.get("nearest_city")
        g = p.get("google_aq") or {}
        local = next((i for i in g.get("indexes", []) if i["code"] != "uaqi"), None)
        ctx = {
            "place": name, "state": pl.get("state"), "country": pl.get("country"), "address": pl.get("address"),
            "authority": f"District / municipal administration of {pl.get('district') or name} + {p['authority']}",
            "category": "hidden hotspot" if req.kind == "hotspot" else "location watch",
            "live_air_quality_google": ({"index": local["name"], "value": local["aqi"], "category": local["category"]}
                                        if local else None),
            "forecast": p["forecast"]["now"], "weather_now": p["weather"],
            "satellite_heat_detections_within_50km": p["fires"]["within_50km"],
            "nearest_detections": p["fires"]["nearest"][:4],
            "citizen_sensors_within_10km": p["citizen_sensors"]["count"],
            "median_citizen_pm25": p["citizen_sensors"]["median_pm25"],
            "response_stage": p["forecast"]["now"].get("stage") or {"stage": 0, "name": "Watch"},
            "summary": f"{name}: {p['fires']['within_50km']} satellite heat detections within 50 km in 24 h.",
        }
        default_langs = p["languages"]
        target = {"kind": req.kind, "id": f"{lat:.4f},{lon:.4f}", "lat": lat, "lon": lon, "name": name}
        if p["imagery"]["streetview"].get("available"):
            sv = p["imagery"]["streetview"]
            evidence_imgs.append({"kind": "streetview", "url": f"/api/streetview?lat={sv['lat']}&lon={sv['lon']}",
                                  "date": sv.get("date"), "source": "Google Street View (live, not stored)"})

    t0 = time.perf_counter()
    langs = _languages(["en"] + list(default_langs), req.languages)
    # imagery and drafting run in parallel so the officer is never kept waiting on both
    sat_task = asyncio.create_task(_satellite_evidence(lat, lon)) if req.attach_imagery else None
    try:
        draft_json = await asyncio.wait_for(asyncio.to_thread(command.draft_alert, ctx, langs), 45)
    except asyncio.TimeoutError:
        draft_json = command._fallback_alert(ctx, langs)
    if sat_task:
        try:
            sat = await asyncio.wait_for(sat_task, 40)
        except asyncio.TimeoutError:
            sat = {}
        if sat:
            evidence_imgs.insert(0, sat)
    doc = store.put("alerts", {
        "target": target, "context": ctx, "draft": draft_json, "languages": langs, "evidence": evidence_imgs,
        "status": "draft", "timeline": [{"status": "draft", "at": time.time(), "by": "Albedo-Watch AI"}],
        "ai": {"model": draft_json.pop("_model", None) or "template (AI unavailable)",
               "ms": round((time.perf_counter() - t0) * 1000)},
    })
    return doc


class StatusReq(BaseModel):
    status: Literal["approved", "dispatched", "acknowledged", "resolved", "rejected"]
    by: str = Field("Duty Officer", max_length=60)
    note: str = Field("", max_length=300)


@router.post("/alerts/{aid}/status")
async def alert_status(aid: str, req: StatusReq):
    a = store.get("alerts", aid)
    if not a:
        raise HTTPException(404, "alert not found")
    a["status"] = req.status
    entry = {"status": req.status, "at": time.time(), "by": req.by, "note": req.note}
    if req.status == "dispatched":
        entry["channels"] = ["Official email (simulated)", "WhatsApp Business (simulated)", "SMS gateway (simulated)", "IVR voice (simulated)"]
    a.setdefault("timeline", []).append(entry)
    return store.put("alerts", a)


@router.get("/alerts")
async def list_alerts():
    return {"alerts": store.list("alerts", 100)}


class TTSReq(BaseModel):
    text: str = Field(..., min_length=1, max_length=900)
    voice: str = Field("Kore", max_length=20)


@router.post("/tts")
async def tts(req: TTSReq):
    out = await asyncio.to_thread(llm.speak, req.text, req.voice)
    if not out:
        raise HTTPException(503, "voice synthesis unavailable")
    data, mime = out
    return Response(content=data, media_type=mime, headers={"Cache-Control": "private, max-age=3600"})


# --------------------------------------------------------------------------- #
# Ask Albedo
# --------------------------------------------------------------------------- #
class AskReq(BaseModel):
    question: str = Field(..., min_length=2, max_length=800)
    city: str | None = None


@router.post("/ask")
async def ask(req: AskReq):
    cities = await _cities()
    summ = forecast.pulse_summary(cities)
    digest: dict = {
        "national": summ,
        "cities": [{"city": c["name"], "region": c["state_name"], "index": f"{c['index_system']} {c['naqi']}",
                    "category": c["category"]["label"], "pm25": c["pm25"], "peak72": c["peak72"], "spike": bool(c["spike"])}
                   for c in sorted(cities, key=lambda c: (-c["category"]["level"], -(c["naqi"] or 0)))[:45]],
    }
    cid = req.city or command.find_city(req.question)
    if cid and cid in CITY_BY_ID:
        c = await _city(cid)
        a = await _attribution(cid)
        s = c["_series"]; k = s["now_offset"]
        digest["focus_city"] = {
            "name": c["name"], "naqi": c["naqi"], "category": c["category"], "grap": c["grap"],
            "next_24h_naqi_every_3h": [s["naqi"][i] for i in range(k, min(len(s["naqi"]), k + 25), 3)],
            "spike": c["spike"], "sources": {x["label"]: x["share"] for x in a["sources"]},
            "upwind_fires": [x["place"]["label"] for x in a["clusters"][:3]], "authority": c["authority"],
        }
    hs = cache.peek("hotspots:world")
    if hs:
        digest["hidden_hotspots"] = [{"where": h["place"]["label"], "why": h["why"]} for h in hs["hotspots"][:5]]
    return await asyncio.to_thread(command.ask, req.question, digest)


# --------------------------------------------------------------------------- #
# Model Commons (federated) & interoperability
# --------------------------------------------------------------------------- #
@router.get("/commons")
async def commons():
    if federated.current() is None and (snap := _snapshot("commons")):
        asyncio.get_running_loop().create_task(federated.ensure_model())
        return {**snap, "stale": True}
    m = await federated.ensure_model()
    if not m:
        return {"status": "unavailable"}
    out = {"summary": m.summary, "rounds": m.rounds, "nodes": m.nodes, "card": federated.model_card()}
    _persist("commons", out)
    return out


class TrainReq(BaseModel):
    rounds: int = Field(30, ge=5, le=80)
    dp_sigma: float = Field(0.0, ge=0.0, le=0.2)


@router.post("/commons/train")
async def commons_train(req: TrainReq):
    m = await federated.ensure_model(force=True, rounds=req.rounds, dp_sigma=req.dp_sigma)
    _invalidate("cities_built")
    for key in list(cache._store):
        if key.startswith("attr:"):
            cache._store.pop(key, None)
    if not m:
        raise HTTPException(503, "training data unavailable")
    return {"summary": m.summary, "rounds": m.rounds, "nodes": m.nodes, "card": federated.model_card()}


@router.get("/interop/schema")
async def interop_schema():
    return OAEP_SCHEMA


@router.get("/interop/events.geojson")
async def interop_events():
    """Open Air Event Protocol feed — any state/city/country system can consume or publish this."""
    feats = []
    for r in store.list("reports", 200):
        an = r.get("analysis", {})
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
                      "properties": {"oaep": "0.1", "event_type": "citizen_report", "id": r["id"],
                                     "source_type": an.get("source_type"), "severity": an.get("severity"),
                                     "verification": r.get("verification", {}).get("status"),
                                     "jurisdiction": r.get("jurisdiction", {}).get("state"),
                                     "observed_at": r.get("created_at")}})
    for c in await _cities():
        if c["spike"]:
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [c["lon"], c["lat"]]},
                          "properties": {"oaep": "0.1", "event_type": "forecast_spike", "id": f"spike:{c['id']}",
                                         "naqi_peak": c["spike"]["peak"], "onset": c["spike"]["onset_time"],
                                         "grap_stage": c["spike"]["grap"]["stage"], "jurisdiction": c["state_name"]}})
    return {"type": "FeatureCollection", "features": feats}


OAEP_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "Open Air Event Protocol (OAEP) v0.1",
    "description": "Minimal interoperable record for air-pollution events shared between Indian states, cities and BRICS partners.",
    "type": "object",
    "required": ["oaep", "event_type", "id", "observed_at"],
    "properties": {
        "oaep": {"const": "0.1"},
        "event_type": {"enum": ["citizen_report", "satellite_fire", "forecast_spike", "hidden_hotspot", "authority_action"]},
        "id": {"type": "string"},
        "observed_at": {"type": "number", "description": "unix seconds, UTC"},
        "source_type": {"enum": citizen.SOURCE_TYPES},
        "severity": {"type": "integer", "minimum": 1, "maximum": 5},
        "verification": {"enum": ["verified", "probable", "unverified", "rejected"]},
        "naqi_peak": {"type": "integer"},
        "grap_stage": {"type": "integer", "minimum": 0, "maximum": 4},
        "jurisdiction": {"type": "string"},
        "model_ref": {"type": "string", "description": "Model Commons weights version used, if any"},
    },
}
