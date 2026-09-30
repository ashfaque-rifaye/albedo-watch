"""Albedo Copilot — a Gemini agent that operates Albedo-Watch.

Gemini plans, calls our own engines as tools (forecast, hotspots, source tracing,
schools & hospitals, response simulation, drafting an order), and answers in the
user's language. Every tool also returns a UI action, so the globe visibly follows
the agent's reasoning: flying to a city, opening Detect, showing a draft order.
Facts come only from tools; the model is told never to invent numbers.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

from ..config import settings
from ..engines import health as health_value
from ..engines import place, protect
from ..llm.gemini_provider import GeminiProvider
from ..registry import CITIES, CITY_BY_ID
from ..sources import cache, google

log = logging.getLogger("albedo.copilot")

SYSTEM = """You are Albedo Copilot, the operator of Albedo-Watch: live air-quality intelligence for India and the world.
Work like an analyst on duty:
1. Use the tools to get facts. Never invent a number, place or time; if a tool returns nothing, say so.
2. Chain tools when the question needs it (e.g. find the city -> forecast -> schools -> draft a notice).
3. Answer in the user's language and script. Be concise: a short paragraph or a few bullets with concrete numbers,
   local times and places. Mention the evidence (CAMS forecast corrected by the federated model, Google Air Quality,
   NASA FIRMS, OpenAQ monitors, OpenStreetMap).
4. When asked to act (order, notice, advisory, alert), call draft_order — with audience "schools" when the user means
   principals or schools, "hospitals" for hospitals — and the requested languages. Say that a human officer must approve it
   before anything is sent.
5. After the tools, always write the final answer yourself: what you found, what you drafted, and what the person should do.
India uses the NAQI with GRAP stages; other countries use the US AQI. Health advice follows WHO guidance."""

from ..engines.response import MEASURES as _M  # noqa: E402
MEASURES = [m["id"] for m in _M]

DECLS: list[dict] = [
    {"name": "find_place", "description": "Resolve a city, district, landmark or address to coordinates and the nearest monitored city.",
     "parameters": {"type": "OBJECT", "properties": {"query": {"type": "STRING"}}, "required": ["query"]}},
    {"name": "city_air", "description": "Air now and the 72-hour forecast for a monitored city: index, category, peak and when, response stage, "
                                         "and today's hours that are fine for outdoor activity.",
     "parameters": {"type": "OBJECT", "properties": {"city_id": {"type": "STRING"}}, "required": ["city_id"]}},
    {"name": "worst_air", "description": "Cities with the worst air now or the biggest forecast spikes, optionally in one country (ISO code, e.g. IN).",
     "parameters": {"type": "OBJECT", "properties": {"country": {"type": "STRING"}, "limit": {"type": "INTEGER"}}}},
    {"name": "hidden_hotspots", "description": "Pollution sources (satellite fire clusters, verified citizen reports) that no official monitor covers, ranked.",
     "parameters": {"type": "OBJECT", "properties": {"scope": {"type": "STRING", "enum": ["india", "world"]}}}},
    {"name": "trace_sources", "description": "Where a city's PM2.5 comes from (source shares) and which upwind fire clusters feed it.",
     "parameters": {"type": "OBJECT", "properties": {"city_id": {"type": "STRING"}}, "required": ["city_id"]}},
    {"name": "sensitive_sites", "description": "Schools, colleges, hospitals and clinics in a city (OpenStreetMap) with safe outdoor hours and hours to stay indoors.",
     "parameters": {"type": "OBJECT", "properties": {"city_id": {"type": "STRING"}}, "required": ["city_id"]}},
    {"name": "place_air", "description": "Live air quality measured at an exact point (Google Air Quality), local forecast, nearby fires and sensors.",
     "parameters": {"type": "OBJECT", "properties": {"lat": {"type": "NUMBER"}, "lon": {"type": "NUMBER"}}, "required": ["lat", "lon"]}},
    {"name": "simulate_measures", "description": "What a package of response measures would do to a city's PM2.5, with health and money value. "
                                                 f"Measure ids: {', '.join(MEASURES)}.",
     "parameters": {"type": "OBJECT", "properties": {"city_id": {"type": "STRING"}, "measures": {"type": "ARRAY", "items": {"type": "STRING"}},
                                                     "compliance": {"type": "NUMBER"}}, "required": ["city_id", "measures"]}},
    {"name": "draft_order", "description": "Draft an action order or advisory for a city (for the authority, school principals, hospitals or the public) "
                                           "in English plus local languages. Creates a draft that a human officer approves.",
     "parameters": {"type": "OBJECT", "properties": {"city_id": {"type": "STRING"},
                                                     "audience": {"type": "STRING", "enum": ["authority", "schools", "hospitals", "public"]},
                                                     "languages": {"type": "ARRAY", "items": {"type": "STRING"}}}, "required": ["city_id"]}},
]


def _resolve_city(cid: str | None) -> str | None:
    if not cid:
        return None
    if cid in CITY_BY_ID:
        return cid
    t = cid.strip().lower()
    for c in CITIES:
        if c.name.lower() == t or c.id == t.replace(" ", "") or (c.local_name and c.local_name == cid):
            return c.id
    for c in CITIES:
        if t in c.name.lower():
            return c.id
    return None


class Session:
    """Tool implementations for one request; collects steps and UI actions."""

    def __init__(self):
        self.steps: list[dict] = []
        self.actions: list[dict] = []

    async def _cities(self) -> list[dict]:
        from ..routers import api
        return await api._cities()

    async def _city(self, cid: str | None) -> dict:
        from ..routers import api
        rid = _resolve_city(cid)
        if not rid:
            raise ValueError(f"unknown city '{cid}' — call find_place first")
        return await api._city(rid)

    async def find_place(self, query: str) -> dict:
        rid = _resolve_city(query)
        if rid:
            c = CITY_BY_ID[rid]
            self.actions.append({"type": "fly", "lat": c.lat, "lon": c.lon, "range": 260000})
            return {"city_id": rid, "name": c.name, "country": c.country, "lat": c.lat, "lon": c.lon}
        g = await google.forward_geocode(query)
        if not g:
            return {"error": f"could not find '{query}'"}
        near, km = place._nearest_city(g["lat"], g["lon"])
        self.actions.append({"type": "fly", "lat": g["lat"], "lon": g["lon"], "range": 60000})
        return {**g, "nearest_monitored_city": {"city_id": near.id, "name": near.name, "km": round(km)}}

    async def city_air(self, city_id: str) -> dict:
        c = await self._city(city_id)
        pr = protect.windows(c["_series"]["time"], c["_series"]["level"], c["_series"]["now_offset"],
                             protect.tz_offset_h(c["lat"], c["lon"], c["country"]))
        from ..routers.api import fmt_windows
        self.actions.append({"type": "city", "id": c["id"]})
        return {"city": c["name"], "country": c["country_name"], "index_system": c["index_system"], "now": c["naqi"],
                "category": c["category"]["label"], "pm25_ugm3": c["pm25"], "dominant": c["dominant"],
                "peak_72h": c["peak72"], "peak_category": c["peak_category"]["label"],
                "peak_time_local": _local(c["peak72_time"], c), "trend_24h": c["trend24"],
                "response_stage": c["spike"]["grap"]["name"] if c["spike"] else c["grap"]["name"],
                "spike": bool(c["spike"]), "today": fmt_windows(pr),
                "forecast_source": "CAMS global forecast corrected by Albedo-Watch's federated model"}

    async def worst_air(self, country: str | None = None, limit: int = 6) -> dict:
        cs = [c for c in await self._cities() if (not country or c["country"] == country.upper()) and c["naqi"] is not None]
        spikes = sorted([c for c in cs if c["spike"]], key=lambda c: -c["spike"]["peak"])[:limit]
        now = sorted(cs, key=lambda c: -(c["naqi"] or 0))[:limit]
        self.actions.append({"type": "mode", "mode": "pulse"})
        return {"worst_now": [{"city_id": c["id"], "name": c["name"], "country": c["country"], "index": c["naqi"],
                               "category": c["category"]["label"]} for c in now],
                "forecast_spikes": [{"city_id": c["id"], "name": c["name"], "peak": c["spike"]["peak"],
                                     "category": c["spike"]["category"], "in_hours": c["spike"]["lead_hours"]} for c in spikes]}

    async def hidden_hotspots(self, scope: str = "india") -> dict:
        scope = "world" if scope == "world" else "india"
        from ..engines import hotspots
        hs = cache.peek(f"hotspots:{scope}") or await cache.cached(f"hotspots:{scope}", 1800, lambda: hotspots.find(scope))
        top = hs["hotspots"][:5]
        self.actions.append({"type": "detect", "scope": scope})
        if top:
            self.actions.append({"type": "fly", "lat": top[0]["lat"], "lon": top[0]["lon"], "range": 90000})
        return {"scope": scope, "hotspots": [{"where": (h.get("admin") or {}).get("district") or h["place"]["label"],
                                              "country": (h.get("admin") or {}).get("country"), "confidence": h.get("confidence"),
                                              "detections": h["fires"], "strongest_mw": h["frp_max"], "cams_pm25": h.get("site_pm25"),
                                              "nearest_official_monitor_km": h["nearest_monitor_km"],
                                              "cities_downwind": [x["name"] for x in h["downwind"]["cities"][:3]]} for h in top],
                "official_monitor_sites": hs.get("monitor_sites")}

    async def trace_sources(self, city_id: str) -> dict:
        from ..routers import api
        c = await self._city(city_id)
        a = await api._attribution(c["id"])
        self.actions.append({"type": "mode", "mode": "trace", "city": c["id"]})
        return {"city": c["name"], "pm25_ugm3": a.get("pm25"),
                "sources": {s["label"]: round(s["share"] * 100) for s in a["sources"]},
                "upwind_fire_clusters": [{"near": x["place"]["label"], "detections": x["fires"], "share_pct": round(x["share"] * 100),
                                          "transport_h": x["transport_h"]} for x in a["clusters"][:4]],
                "method": "48 h back-trajectories through the live wind field matched to NASA FIRMS fires"}

    async def sensitive_sites(self, city_id: str) -> dict:
        from ..routers.api import fmt_windows
        c = await self._city(city_id)
        pr = await protect.for_city(c)
        self.actions.append({"type": "protect", "city": c["id"]})
        return {"city": c["name"], "radius_km": pr["radius_km"], "schools": pr["schools"], "health_facilities": pr["health"],
                "by_type": pr["counts"], "local_times": fmt_windows(pr["windows"]),
                "examples": [f"{x['name']} ({x['type']}, {x['km']} km)" for x in pr["top"][:8]], "source": "OpenStreetMap"}

    async def place_air(self, lat: float, lon: float) -> dict:
        p = await place.intel(lat, lon)
        g = p.get("google_aq") or {}
        self.actions.append({"type": "place", "lat": lat, "lon": lon})
        return {"place": p["place"], "google_air_quality": [{"index": i["name"], "value": i["aqi"], "category": i["category"]}
                                                           for i in g.get("indexes", [])],
                "forecast": p["forecast"]["now"], "weather": p["weather"],
                "fires_within_50km": p["fires"]["within_50km"], "citizen_sensors_10km": p["citizen_sensors"]["count"]}

    async def simulate_measures(self, city_id: str, measures: list[str], compliance: float = 0.7) -> dict:
        from ..routers.api import SimulateReq, simulate
        c = await self._city(city_id)
        ms = [m for m in measures if m in MEASURES] or ["cnd_ban", "road_dust", "fire_enforce"]
        r = await simulate(SimulateReq(city=c["id"], measures=ms, compliance=max(0.2, min(1.0, compliance))))
        self.actions.append({"type": "mode", "mode": "trace", "city": c["id"]})
        return {"city": c["name"], "pm25_before": r["pm25_before"], "pm25_after": r["pm25_after"], "reduction_pct": r["reduction_pct"],
                "index_before": r["naqi_before"], "index_after": r["naqi_after"], "health_3_days": r.get("health"),
                "by_measure": [{m["label"]: m["ugm3"]} for m in r["measures"]]}

    async def draft_order(self, city_id: str, audience: str | None = None, languages: list[str] | None = None) -> dict:
        from ..routers.api import DraftReq, draft
        c = await self._city(city_id)
        aud = audience if audience in ("authority", "schools", "hospitals", "public") else None
        doc = await draft(DraftReq(kind="city", city=c["id"], languages=(languages or None) and languages[:4],
                                   attach_imagery=False, audience=aud))
        self.actions.append({"type": "alert", "id": doc["id"]})
        d = doc["draft"]
        return {"alert_id": doc["id"], "title": d.get("title"), "to": doc["context"].get("authority"),
                "languages": doc["languages"], "first_actions": [a.get("action") for a in d.get("actions", [])[:3]],
                "status": "draft — awaiting an officer's approval"}


def _facts_answer(steps: list[dict]) -> str:
    if not steps:
        return "I could not reach the live data just now — please try again in a moment."
    return "Here is what I found:\n" + "\n".join(f"- {s['summary']}" for s in steps if s.get("ok"))


def _local(t: int | None, c: dict) -> str | None:
    if not t:
        return None
    tz = protect.tz_offset_h(c["lat"], c["lon"], c["country"])
    return time.strftime("%a %H:%M", time.gmtime(t + tz * 3600))


def _summary(name: str, res: dict) -> str:
    if "error" in res:
        return str(res["error"])
    if name == "find_place":
        return res.get("name") or res.get("address") or "found"
    if name == "city_air":
        return f"{res['city']}: {res['index_system']} {res['now']} now, peak {res['peak_72h']} ({res['peak_category']}) {res['peak_time_local'] or ''}"
    if name == "worst_air":
        return ", ".join(f"{x['name']} {x['index']}" for x in res["worst_now"][:3])
    if name == "hidden_hotspots":
        return f"{len(res['hotspots'])} unmonitored hotspots ({res['scope']})"
    if name == "trace_sources":
        top = max(res["sources"].items(), key=lambda kv: kv[1]) if res["sources"] else ("—", 0)
        return f"{res['city']}: largest source {top[0]} {top[1]}%"
    if name == "sensitive_sites":
        return f"{res['city']}: {res['schools']} schools, {res['health_facilities']} hospitals & clinics"
    if name == "place_air":
        return (res["place"].get("locality") or res["place"].get("nearest_city") or "place")
    if name == "simulate_measures":
        h = res.get("health_3_days") or {}
        return f"PM2.5 −{res['reduction_pct']}% · ~{h.get('deaths_avoided', 0)} deaths avoided (3 days, est.)"
    if name == "draft_order":
        return f"draft order: {res.get('title', '')}"[:120]
    return "done"


async def run(messages: list[dict], budget_s: float = 100) -> dict:
    """messages: [{"role": "user"|"assistant", "text": str}] — the last is the user's question."""
    from google.genai import types

    sess = Session()
    tools: dict[str, Callable[..., Awaitable[dict]]] = {d["name"]: getattr(sess, d["name"]) for d in DECLS}
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM, temperature=0.2,
        tools=[types.Tool(function_declarations=[types.FunctionDeclaration(**d) for d in DECLS])],
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    t_end = time.monotonic() + budget_s
    last_err: Exception | None = None
    # primary first, then the steadiest fallback; an overloaded model fails fast instead of eating the budget
    for model in dict.fromkeys([settings.gemini_model, "gemini-2.5-flash", *settings.gemini_backup_models.split(",")]):
        model = model.strip()
        if not model:
            continue
        sess.steps.clear(); sess.actions.clear()
        client = GeminiProvider(model)._get_client()
        if client is None:
            break
        contents: list[Any] = [types.Content(role="model" if m["role"] == "assistant" else "user", parts=[types.Part(text=m["text"][:2000])])
                               for m in messages[-8:]]
        nudged = False
        try:
            for turn in range(8):
                left = t_end - time.monotonic()
                if left < 4:
                    raise TimeoutError("copilot budget exhausted")
                first_call_cap = 14 if turn == 0 else 30
                resp = await asyncio.wait_for(client.aio.models.generate_content(model=model, contents=contents, config=config),
                                              timeout=min(first_call_cap, left))
                calls = resp.function_calls or []
                text = "".join(p.text for p in (resp.candidates[0].content.parts or []) if getattr(p, "text", None)) \
                    if resp.candidates and resp.candidates[0].content else ""
                if not calls and not text.strip() and not nudged:
                    # an empty or malformed turn: nudge once instead of giving up
                    nudged = True
                    contents.append(types.Content(role="user", parts=[types.Part(
                        text="Continue: call the tools you need (one at a time is fine), then answer the question.")]))
                    continue
                if not calls:
                    return {"answer": text.strip() or _facts_answer(sess.steps),
                            "steps": sess.steps, "actions": sess.actions, "model": model}
                contents.append(resp.candidates[0].content)
                parts = []
                for fc in calls:
                    t0 = time.perf_counter()
                    args = dict(fc.args or {})
                    try:
                        res = await asyncio.wait_for(tools[fc.name](**args), timeout=max(5, min(60, t_end - time.monotonic() - 3)))
                    except KeyError:
                        res = {"error": f"no tool named {fc.name}"}
                    except Exception as exc:  # tool errors go back to the model, which can recover
                        res = {"error": f"{type(exc).__name__}: {str(exc)[:160]}"}
                    sess.steps.append({"tool": fc.name, "args": args, "summary": _summary(fc.name, res),
                                       "ms": round((time.perf_counter() - t0) * 1000), "ok": "error" not in res})
                    parts.append(types.Part.from_function_response(name=fc.name, response={"result": res}))
                contents.append(types.Content(role="user", parts=parts))
            return {"answer": "I gathered the data shown in the steps but ran out of reasoning steps. Try a narrower question.",
                    "steps": sess.steps, "actions": sess.actions, "model": model}
        except Exception as exc:
            last_err = exc
            log.warning("copilot %s failed (%s: %s)", model, type(exc).__name__, str(exc)[:160])
            if sess.steps:  # keep what the agent already established rather than starting over
                return {"answer": _facts_answer(sess.steps), "steps": sess.steps, "actions": sess.actions,
                        "model": model, "partial": True}
            if time.monotonic() > t_end - 10:
                break
    raise RuntimeError(f"copilot unavailable ({type(last_err).__name__ if last_err else 'no model'})")


__all__ = ["run", "health_value"]
