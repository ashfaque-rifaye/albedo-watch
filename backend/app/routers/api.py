"""Albedo-Watch REST API."""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import time
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import llm
from ..agents import citizen, command
from ..config import settings
from ..engines import attribution, datahub, federated, forecast, hotspots, response
from ..engines.naqi import category, grap_stage
from ..geo import in_bbox
from ..registry import CITY_BY_ID, COUNTRIES, LANGUAGE_NAMES, STATES, authority_for
from ..sources import cache
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
        "states": {k: {"name": s.name, "languages": list(s.languages), "authority": s.authority} for k, s in STATES.items()},
        "languages": LANGUAGE_NAMES, "countries": COUNTRIES, "freshness": _freshness(),
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
@router.get("/pulse")
async def pulse():
    cities = await _cities()
    return {
        "generated_at": time.time(), "summary": forecast.pulse_summary(cities),
        "cities": [forecast.public(c) for c in cities], "freshness": _freshness(),
        "model": federated.current().summary if federated.current() else None,
    }


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
        vals = {}
        for c in cities:
            s = c["_series"]
            k = s["now_offset"] + h
            if 0 <= k < len(s["naqi"]):
                vals[c["id"]] = s["naqi"][k]
        t = cities[0]["_series"]["time"][cities[0]["_series"]["now_offset"]] + h * 3600 if cities else 0
        frames.append({"h": h, "t": t, "naqi": vals})
    return {"frames": frames}


@router.get("/corridors")
async def corridors():
    return {"corridors": forecast.corridors(await _cities())}


@router.get("/wind")
async def wind(h: int = 0):
    field = await datahub.wind_field()
    return {"h": h, "step": datahub.GRID_STEP, "vectors": datahub.wind_snapshot(field, time.time() + h * 3600)}


@router.get("/fires")
async def fires():
    f = await datahub.fires()
    return {"count": len(f), "fires": [{"lat": x["lat"], "lon": x["lon"], "frp": x["frp"],
                                        "age_h": round((time.time() - x["t"]) / 3600, 1)} for x in f[:6000]]}


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
async def hotspot_list():
    return await cache.cached("hotspots", 900, hotspots.find)


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
    if not in_bbox(lat, lon):
        raise HTTPException(422, "location outside the supported region")
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
    _invalidate("hotspots")
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
    kind: Literal["city", "hotspot", "report"]
    city: str | None = None
    report_id: str | None = None
    lat: float | None = None
    lon: float | None = None
    languages: list[str] | None = Field(default=None, max_length=4)


@router.post("/alerts/draft")
async def draft(req: DraftReq):
    if req.kind == "city":
        if not req.city:
            raise HTTPException(422, "city required")
        c = await _city(req.city)
        a = await _attribution(req.city)
        st = c["state"]
        peak_cat = c["peak_category"]["label"]
        ctx = {
            "place": c["name"], "state": c["state_name"], "authority": c["authority"]["primary"],
            "framework": c["authority"]["framework"], "naqi_now": c["naqi"], "category": c["category"]["label"],
            "naqi_peak": c["peak72"], "peak_category": peak_cat, "spike": c["spike"],
            "grap": c["spike"]["grap"] if c["spike"] else grap_stage(max(c["naqi"] or 0, c["peak72"] or 0)),
            "pm25": c["pm25"], "population_m": c["pop_m"], "stagnant_hours_next_48": c["stagnant_hours_48"],
            "sources": {s["label"]: s["share"] for s in a["sources"]},
            "upwind_fire_clusters": [f"{x['place']['label']} ({x['fires']} fires, ~{x['transport_h']} h transport)" for x in a["clusters"][:3]],
            "evidence": [f"NAQI {c['naqi']} now, peak {c['peak72']} forecast", f"Fire influence index {a['fire_influence']}"],
            "summary": f"{c['name']} NAQI {c['naqi']} ({c['category']['label']}); 72 h peak {c['peak72']} ({peak_cat}).",
        }
        target = {"kind": "city", "id": c["id"], "lat": c["lat"], "lon": c["lon"], "name": c["name"]}
    elif req.kind == "report":
        r = store.get("reports", req.report_id or "")
        if not r:
            raise HTTPException(404, "report not found")
        an, j = r["analysis"], r["jurisdiction"]
        st = j["state_code"]
        ctx = {
            "place": j.get("locality") or j.get("district") or j["city"], "state": j["state"],
            "authority": j["route_to"], "category": f"citizen-reported {an['source_label'].lower()}",
            "report": {"summary": an.get("summary_en"), "severity": an["severity"], "evidence": an.get("visual_evidence"),
                       "verification": r["verification"]["status"], "verification_score": r["verification"]["score"]},
            "nearby_satellite_fires": r["verification"]["nearby_fires"][:3],
            "downwind_cities": r.get("downwind", {}).get("cities", []),
            "grap": {"stage": 0, "name": "Source-level enforcement"},
            "summary": an.get("summary_en"),
        }
        target = {"kind": "report", "id": r["id"], "lat": r["lat"], "lon": r["lon"], "name": ctx["place"]}
    else:
        if req.lat is None or req.lon is None:
            raise HTTPException(422, "lat/lon required")
        hs = (await cache.cached("hotspots", 900, hotspots.find))["hotspots"]
        h = min(hs, key=lambda x: (x["lat"] - req.lat) ** 2 + (x["lon"] - req.lon) ** 2) if hs else None
        if not h:
            raise HTTPException(404, "no hotspot near that point")
        near = min(CITY_BY_ID.values(), key=lambda c: (c.lat - h["lat"]) ** 2 + (c.lon - h["lon"]) ** 2)
        st = near.state
        ctx = {
            "place": h["admin"].get("district") or h["place"]["label"], "state": STATES[st].name,
            "authority": f"District Collector, {h['admin'].get('district') or near.name} + {STATES[st].authority}",
            "category": "unmonitored hotspot", "hotspot": {k: h[k] for k in ("fires", "frp", "reports", "coverage", "why")},
            "downwind": h["downwind"], "grap": {"stage": 1, "name": "Source-level enforcement"},
            "summary": h["why"],
        }
        target = {"kind": "hotspot", "id": f"{h['lat']},{h['lon']}", "lat": h["lat"], "lon": h["lon"], "name": ctx["place"]}

    langs = req.languages or command.languages_for(st)
    t0 = time.perf_counter()
    draft_json = await asyncio.to_thread(command.draft_alert, ctx, langs)
    doc = store.put("alerts", {
        "target": target, "context": ctx, "draft": draft_json, "languages": langs, "state": st,
        "status": "draft", "timeline": [{"status": "draft", "at": time.time(), "by": "Albedo-Watch AI"}],
        "ai": {"model": draft_json.pop("_model", None) or "template (AI unavailable)", "ms": round((time.perf_counter() - t0) * 1000)},
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
        "cities": [{"city": c["name"], "state": c["state_name"], "naqi": c["naqi"], "category": c["category"]["label"],
                    "pm25": c["pm25"], "peak72": c["peak72"], "spike": bool(c["spike"])} for c in cities],
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
    hs = cache.peek("hotspots")
    if hs:
        digest["hidden_hotspots"] = [{"where": h["place"]["label"], "why": h["why"]} for h in hs["hotspots"][:5]]
    return await asyncio.to_thread(command.ask, req.question, digest)


# --------------------------------------------------------------------------- #
# Model Commons (federated) & interoperability
# --------------------------------------------------------------------------- #
@router.get("/commons")
async def commons():
    m = await federated.ensure_model()
    if not m:
        return {"status": "unavailable"}
    return {"summary": m.summary, "rounds": m.rounds, "nodes": m.nodes, "card": federated.model_card()}


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
