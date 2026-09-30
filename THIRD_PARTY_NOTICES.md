# Third-party notices

Albedo-Watch's own code is released under the [MIT License](LICENSE). It is built on the open-source components, data and services below. Nothing here is vendored or copied into this repository. Libraries are installed from PyPI and npm, fonts are served by Google Fonts, and data is fetched at run time.

## Reused from the author's earlier project

| Component | Origin | What was reused |
|---|---|---|
| `backend/app/hardening.py` | ClimaTwin (same author, MIT) | Request IDs, security headers, in-memory rate limiting |
| `backend/app/llm/` | ClimaTwin (same author, MIT) | Provider interface and the prompt cache. The Gemini cascade, multimodal calls and TTS were rewritten for Albedo-Watch |

Everything else was written for this hackathon. The repository's history starts on 28 September 2026.

## Backend libraries (Python)

| Package | Version | Licence |
|---|---|---|
| FastAPI | 0.115.6 | MIT |
| Starlette | 0.41.3 | BSD-3-Clause |
| Uvicorn | 0.34.0 | BSD-3-Clause |
| Pydantic / pydantic-settings | 2.10.4 / 2.7.0 | MIT |
| python-multipart | 0.0.20 | Apache-2.0 |
| HTTPX | 0.28.1 | BSD-3-Clause |
| NumPy | 2.x | BSD-3-Clause (and bundled permissive licences) |
| Pillow | 11+ | MIT-CMU (HPND) |
| google-genai | 1.30+ | Apache-2.0 |
| google-cloud-firestore | 2.19.0 | Apache-2.0 |
| pywebpush | 2.x | MPL-2.0 (used unmodified) |

## Frontend libraries (npm)

| Package | Version | Licence |
|---|---|---|
| CesiumJS (`cesium`, `@cesium/engine`, `@cesium/widgets`) | 1.145 | Apache-2.0 |
| React, React DOM | 19 | MIT |
| Vite, @vitejs/plugin-react | 8 / 6 | MIT |
| TypeScript | 6 | Apache-2.0 |
| oxlint, Vitest (dev) | – | MIT |

## Fonts

Inter, Inter Tight, JetBrains Mono and Noto Sans are served by Google Fonts under the SIL Open Font License 1.1.

## Data and imagery (fetched at run time, credited in the app)

| Source | Use | Terms |
|---|---|---|
| Copernicus Atmosphere Monitoring Service (CAMS), via [Open-Meteo](https://open-meteo.com) | Air-quality forecast, winds, boundary layer | CC BY 4.0. Contains modified Copernicus Atmosphere Monitoring Service information |
| NASA FIRMS (VIIRS S-NPP, NOAA-20) | Active fires | NASA open data; acknowledgement: "NASA FIRMS" |
| NASA GIBS / Worldview | Daily true colour, aerosol, land-surface temperature, Black Marble | NASA open data (no restrictions; attribution requested) |
| [OpenAQ](https://openaq.org) | Reference-monitor sites and hourly PM2.5 (ground truth for the federated models) | OpenAQ terms; underlying data licences vary by provider and are credited to OpenAQ |
| [Sensor.Community](https://sensor.community) | Citizen PM sensors | Open Database License (ODbL) |
| OpenStreetMap: Nominatim and Overpass | Place names and jurisdiction; buildings, schools, hospitals | © OpenStreetMap contributors, ODbL. The Nominatim usage policy is followed (identifying User-Agent, at most 1 request/s, cached) |
| [GDELT Project](https://www.gdeltproject.org) | News photos for live reports | Free and open; credited to the source article |
| Esri World Imagery and Boundaries & Places | Imagery in the **Open data** map mode only | Esri terms of use; attribution "Esri, Maxar, Earthstar Geographics" shown on the map |

## Google services

Gemini API (Google AI Studio), Veo in Google Flow, Google Maps Platform (Map Tiles API, Air Quality API, Street View Static API metadata, Maps Embed API), Google Cloud (Cloud Run, Cloud Build, Artifact Registry, Firestore, Secret Manager, Cloud Scheduler, Cloud Logging) and Google Fonts are used under their own terms. The README section **Compliance with the hackathon rules and Google's terms** explains how each one is used.
