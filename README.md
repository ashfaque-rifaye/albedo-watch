<div align="center">

# Albedo-Watch

### India's citizen-powered air-intelligence network

*Detect the hidden fire. Trace the smoke. Warn the city — before it breathes.*

**Live:** https://albedo-watch-621000818329.asia-south1.run.app · **Mission Control:** [/app](https://albedo-watch-621000818329.asia-south1.run.app/app)

Build with AI: Code for Communities (2nd ed.) · **Track 02 — Clean Air & Climate Resilience**

</div>

---

## In three lines

Albedo-Watch fuses **citizen photos and voice notes in any Indian language**, **NASA satellite fires**, and **global atmospheric forecasts** to find pollution hotspots no monitor sees, trace smoke back to its source, and forecast spikes 72 hours ahead for 53 cities in 26 states.
**Gemini 3.7 Flash** verifies citizen evidence, explains sources and drafts GRAP-aligned orders with multilingual voice advisories for the right authority — humans approve every dispatch.
States improve each other's forecasts through a **federated Model Commons** that shares only model weights, never raw data — cutting forecast error **31%**, and **29% even for a state that contributes no data**.

## Why this exists

India measures its air at a few hundred continuous stations, concentrated in big cities. The smoke that chokes those cities is born in fields, kilns and bylanes nobody measures — and global forecasts, at ~40 km resolution, miss local reality (this week they over-read Delhi's PM2.5 by roughly 3×). Existing tools are dashboards of the past. Albedo-Watch is a closed loop from evidence to action.

## The loop

| Step | What happens | How |
|---|---|---|
| **Detect** | Hidden hotspots: evidence of pollution where no official monitor exists, ranked by people downwind | NASA FIRMS VIIRS FRP + verified citizen reports on a 0.5° lattice × (1 − station coverage) × downwind population; Google Geocoding keeps it inside India and names the district |
| **Citizen Sense** | Anyone reports smoke by photo or voice in their own language | **Gemini 3.7 Flash multimodal** classifies the source (11 types), grades severity, rejects drawings/screenshots/AI images, transcribes & translates voice, replies in the citizen's language; independently cross-checked against satellite fires, nearby reports and modelled PM2.5; routed to the responsible authority by jurisdiction |
| **Trace** | "Where is this city's air coming from right now?" | 7-member ensemble **back-trajectories**, 48 h through the live wind field, coupled to fires in space & time; transparent apportionment (biomass, dust from CAMS speciation, sector priors tilted by NO₂/SO₂); Gemini narrates |
| **Forecast** | Hourly **Indian NAQI** (CPCB breakpoints) for 53 cities & 6 economic corridors, 72 h ahead, with GRAP stage, lead time and daytime ventilation-index stagnation | CAMS composition forecasts bias-corrected by the federated model |
| **Act** | One click from spike to a GRAP-aligned action order + public advisories in the state's languages + SMS + voice | Gemini drafts, **Gemini TTS** voices it for IVR/radio; officer approves → dispatch → acknowledge → resolve on an auditable ledger (Firestore). Response simulator shows what each GRAP measure is worth *today* in *this* city |
| **Learn** | States share models, not data | **FedAvg** across 21 state nodes + per-state personalisation + optional differential-privacy noise; leave-one-state-out shows benefit for states with zero data |

## Results (live, reproducible — see `/api/commons`)

| Forecast of PM2.5 (held-out 18 h, 21 states) | Mean abs. error µg/m³ |
|---|---|
| Global model (CAMS) | 13.8 |
| Each state training alone | 14.3 — *worse than doing nothing* |
| **Federated** | **9.4 (−31%)** |
| **Federated + personalised** | **8.8 (−36%)** |
| **State with zero data, served by the federation** | **9.7 (−29%)** |

Raw observations kept local: ~105 KB. Weights shared: ~79 KB total across 30 rounds.

## Google AI & Cloud — doing real work

- **Gemini 3.7 Flash** (AI Studio): multimodal evidence analysis (image + audio), authenticity checks, source narratives, alert drafting in native scripts, "Ask Albedo" Q&A in any Indian language. Model cascade 3.7 → 3.5 → 2.5 Flash with internal failover, so demos never go dark.
- **Gemini 3.8 Flash TTS**: voice advisories and citizen replies.
- **Google Maps Platform**: Air Quality API history (station-fused ground truth for federated training), Geocoding (jurisdiction routing, country filter).
- **Cloud Run** (asia-south1, scales to zero) · **Firestore** (reports + action ledger) · **Secret Manager** (all keys).
- Open public data: **NASA FIRMS** VIIRS S-NPP + NOAA-20, **CAMS** global composition forecasts and NWP winds/boundary layer via Open-Meteo.

## Built for India — and beyond

- 53 cities, 26 states & UTs, 18 languages, every State Pollution Control Board, CAQM for NCR — a **registry**: adding a city or a country is a data change, not a code change.
- **Open Air Event Protocol (OAEP)** — a JSON Schema + GeoJSON feed (`/api/interop/*`) so any state, city or BRICS partner can publish and consume events. Model weights published under CC-BY-4.0 as a Digital Public Good.
- Same pipeline applies to Amazon fire smoke → São Paulo, the Highveld coal belt, North China Plain haze, and ASEAN peat-fire haze.

## Architecture

```
React 19 + Vite ─ MapLibre GL + deck.gl (wind particles, fire glow, trips, arcs)
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
