<div align="center">

# Albedo-Watch

### India's citizen-powered air-intelligence network

*Detect the hidden fire. Trace the smoke. Warn the city — before it breathes.*

**Live:** https://albedo-watch-621000818329.asia-south1.run.app · **Mission Control:** [/app](https://albedo-watch-621000818329.asia-south1.run.app/app)

Build with AI: Code for Communities (2nd ed.) · **Track 02 — Clean Air & Climate Resilience**

</div>

---

## In three lines

Albedo-Watch is a citizen-powered air-intelligence network on a live, photorealistic 3D Earth: anyone can report smoke by photo or voice note in their own language, and **Gemini 3.7 Flash** verifies it against NASA satellite heat detections and routes it to the responsible authority.
It traces each city's pollution back to its sources, forecasts unhealthy air 72 hours ahead for **233 cities in 104 countries** (India in state-level depth with CPCB NAQI and GRAP), and drafts action orders with advisories in **English plus the local languages**, backed by today's NASA satellite image — a human approves every dispatch.
States and countries improve each other's forecasts through **regional federated learning** that shares only model weights, never raw data.

## What you can do in it

| | |
|---|---|
| **Pulse** | The planet's air, live: 233 cities, NAQI in India / US AQI elsewhere, 72 h spike warnings with lead times, region filters, a time machine from −24 h to +72 h |
| **Click anywhere** | A God's-eye drill-down for any coordinate on Earth: Google's live measured air quality in that country's official index, a forecast at that exact spot, NASA heat detections within 50 km, nearby citizen sensors, today's and yesterday's NASA satellite image, Street View, and **Google Photorealistic 3D** of the city |
| **Detect** | Hidden hotspots: satellite heat + citizen reports where no official monitor is nearby, ranked by people downwind, in plain units (detections, MW, km to nearest monitor) |
| **Trace** | 48 h ensemble back-trajectories through the live wind field → which fires the air crossed → an explainable source breakdown + response simulator |
| **Citizen** | Photo / voice note / WhatsApp voice file in any language → Gemini classification, authenticity check, satellite corroboration, jurisdiction routing, reply in the citizen's language with voice |
| **Command** | GRAP-aligned (India) or WHO-referenced (elsewhere) action orders; pick languages (English + local, up to 4); NASA image evidence read by Gemini; SMS + TTS voice; approve → dispatch → acknowledge → resolve ledger |
| **Commons** | Regional federated learning across 48 nodes (Indian states + countries) with per-node personalisation and optional differential privacy |

## Honest numbers (live — recomputed every few hours)

- **NASA heat detections**: ~47,000 per 24 h worldwide after merging the two VIIRS satellites' duplicate sightings (~93,000 raw). Median intensity ~5 MW: most are small crop or vegetation fires, some are gas flares. The UI says so.
- **Federated learning** (snapshot 28 Sep 2026, PM2.5 MAE on held-out hours): global CAMS 15.6 µg/m³ · one planet-wide model 11.8 · regional federations 10.5 · each node alone 8.7 · **federated + personalised 8.1 (−48%)** · a node with zero data, served by its federation 12.5 (−20%). Lesson we built in: bias is regional, so federations are regional.

## Google AI & Cloud — doing real work

- **Gemini 3.7 Flash** (AI Studio): multimodal evidence analysis (image + audio), authenticity checks, source narratives, alert drafting in native scripts, "Ask Albedo" Q&A in any Indian language. Model cascade 3.7 → 3.5 → 2.5 Flash with internal failover, so demos never go dark.
- **Gemini 3.8 Flash TTS**: voice advisories and citizen replies.
- **Google Maps Platform**: Air Quality API history (station-fused ground truth for federated training), Geocoding (jurisdiction routing, country filter).
- **Cloud Run** (asia-south1, scales to zero) · **Firestore** (reports + action ledger) · **Secret Manager** (all keys).
- **Google Map Tiles API** (Photorealistic 3D Tiles) and the **Air Quality heatmap** layer on a CesiumJS globe; **Street View Static** for street-level context (live, never stored).
- Open public data: **NASA FIRMS** VIIRS S-NPP + NOAA-20 (global), **NASA GIBS** daily VIIRS imagery, **CAMS** global composition forecasts and NWP winds via Open-Meteo, **Sensor.Community** open citizen PM sensors, **Esri World Imagery**, and **OpenAQ** official stations when a key is configured.

## Built for India — and beyond

- 53 cities, 26 states & UTs, 18 languages, every State Pollution Control Board, CAQM for NCR — a **registry**: adding a city or a country is a data change, not a code change.
- **Open Air Event Protocol (OAEP)** — a JSON Schema + GeoJSON feed (`/api/interop/*`) so any state, city or BRICS partner can publish and consume events. Model weights published under CC-BY-4.0 as a Digital Public Good.
- Same pipeline applies to Amazon fire smoke → São Paulo, the Highveld coal belt, North China Plain haze, and ASEAN peat-fire haze.

## Architecture

```
React 19 + Vite ─ CesiumJS 3D globe (Esri / NASA GIBS imagery, Google 3D Tiles, wind particles, trajectories, arcs)
        │  REST
FastAPI (Cloud Run) ──┬─ datahub: CAMS · NWP winds · FIRMS · Google AQ (TTL cache, single-flight, stale-on-error)
                      ├─ engines: NAQI · forecast · attribution · hotspots · response · federated (numpy)
                      ├─ agents : citizen (multimodal) · command (alerts, narrative, ask) — Gemini cascade + fallback
                      └─ store  : Firestore ↔ in-memory
```

## Run locally

```bash
python -m venv backend/.venv && backend/.venv/Scripts/pip install -r backend/requirements-dev.txt
cp backend/.env.example backend/.env         # add GEMINI_API_KEY and SERVER_API_KEY
backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --port 8010
cd frontend && npm install && npm run dev    # proxies /api to :8010
```

Tests (fully offline, no keys): `backend/.venv/Scripts/python -m pytest backend/tests` — 24 tests covering NAQI breakpoints, GRAP stages, trajectory physics, fire coupling, apportionment, federated convergence & DP, simulator monotonicity, and every API contract with AI disabled.

## Deploy

```bash
gcloud run deploy albedo-watch --source . --region asia-south1 --allow-unauthenticated \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest,SERVER_API_KEY=server-api-key:latest \
  --set-env-vars GCP_PROJECT=<project>
```

## Honesty & responsible AI

- Forecasts and attributions are **model estimates**, labelled as such — not official CPCB bulletins. Attribution is a receptor-model *proxy*, not a chemical-transport model.
- O₃/CO are excluded from the headline NAQI until they can be bias-corrected (CAMS ozone carries a strong coastal high bias in India).
- Station counts are approximate public CPCB listings. Google AQ history is used as a station-fused *proxy* for ground truth.
- Dispatch channels in the prototype are **simulated**; every AI-drafted order requires human approval.
- Citizen text/audio is treated as data (prompt-injection guarded); photos are stored only as small thumbnails; no personal identifiers are collected.

## Evolved from ClimaTwin

Albedo-Watch reuses ClimaTwin's hardened FastAPI middleware and multi-provider AI orchestrator. Everything else — the national data hub, NAQI/GRAP engine, trajectories, blind-spot finder, citizen multimodal agent, command workflow, federated learning, interop protocol and the entire UI — is new for this hackathon.

## Credits & licences

Code MIT. Data: Copernicus CAMS (via Open-Meteo, CC-BY 4.0), NASA FIRMS (open), Google Maps Platform (ToS), CARTO basemap (© OpenStreetMap contributors, © CARTO). Libraries: FastAPI, NumPy, Pillow, React, MapLibre GL, deck.gl.
