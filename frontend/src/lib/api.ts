// Typed client for the Albedo-Watch API.
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export type Cat = { label: string; color: string; level: number; health?: string }
export type Grap = { stage: number; name: string; trigger: string }
export type Spike = { peak: number; peak_time: number; category: string; peak_category: Cat; lead_hours: number; onset_time: number; grap: Grap }
export type City = {
  id: string; name: string; local_name: string; state: string; state_name: string; lat: number; lon: number
  country: string; country_name: string; india: boolean; index_system: 'NAQI' | 'US AQI'; region: string
  pop_m: number; stations: number; naqi: number | null; category: Cat; dominant: string | null
  pm25: number | null; pm25_cams: number | null; correction: string; peak72: number | null; peak72_time: number
  peak_category: Cat; spike: Spike | null; trend24: number | null; grap: Grap; ventilation_now: number | null
  stagnant_hours_48: number; wind: { speed: number; dir: number }
  authority: { primary: string; primary_short: string; state_board: string; municipal: string; framework: string }
  series?: Series
}
export type Series = {
  time: number[]; naqi: (number | null)[]; pm25: (number | null)[]; pm25_cams: (number | null)[]; pm10: (number | null)[]
  no2: (number | null)[]; so2: (number | null)[]; o3: (number | null)[]; dust: (number | null)[]; blh: (number | null)[]
  ws: (number | null)[]; wd: (number | null)[]; level: number[]; now_offset: number
}
export type Pulse = {
  generated_at: number
  stale?: boolean
  summary: { cities: number; countries: number; india_cities: number; states: number; pop_covered_m: number; pop_poor_now_m: number; spikes_72h: number; pop_spike_m: number
    worst: { id: string; name: string; naqi: number; category: string }[]; stagnant_cities: number; national_median: number | null }
  cities: City[]
  freshness: Record<string, number | null>
  model: CommonsSummary | null
}
export type Place = { city: string; state: string; country?: string; km: number; dir: string; label: string }
export type Cluster = { lat: number; lon: number; fires: number; frp: number; weight: number; share: number; transport_h: number; place: Place }
export type Attribution = {
  city: string; name: string; paths: [number, number, number][][]; fire_influence: number; clusters: Cluster[]
  fires_considered: number; sources: { key: string; label: string; share: number; ugm3: number }[]; pm25: number | null
  method: string; narrative?: { headline: string; explanation: string; drivers: string[]; what_would_help?: string; confidence: string }
  city_row: City
}
export type Hotspot = {
  lat: number; lon: number; evidence: number; coverage: number; score: number; priority: number; fires: number; frp: number
  frp_max: number; newest: number; nearest_monitor_km: number | null; nearest_sensor_km: number | null
  reports: number; place: Place; admin: Record<string, string>; why: string
  downwind: { cities: { id: string; name: string; pop_m: number; eta_h: number }[]; pop_at_risk_m: number }
  confidence?: 'high' | 'medium' | 'low'; satellites?: string[]; span_h?: number; site_pm25?: number | null
  impact?: 'low' | 'moderate' | 'high' | null; merged?: number; complex_fires?: number; image?: { url: string; date: string }
}
export type BuildingSet = { buildings: [number, number, number, number[]][]; count: number; mapped_height_share: number; radius_m: number; source: string }
export type Hotspots = { scope: string; hotspots: Hotspot[]; cells_scanned: number; fires: number; reports: number; sensors: number; stations: number
  official_source: string; official_coverage_known?: boolean; unmonitored_share: number; method: string; stale?: boolean
  monitor_sites?: number; candidates?: number }
export type FireSummary = { count: number; large: number; median_frp: number | null; definition: string }
export type FireFeed = FireSummary & { mode: 'aggregate' | 'detections'; bins?: [number, number, number, number, number][]; fires?: [number, number, number, number][] }
export type Sensors = { citizen: [number, number, number, number][]; stations: [number, number, number, number][]; sources: Record<string, string> }
export type Overview = { summary: Pulse['summary'] | null; fires: FireSummary | null; unmonitored_share: number | null; sensors: number | null; stations: number | null; commons: CommonsSummary | null }
export type PlaceIntel = {
  lat: number; lon: number; fetched_at: number
  place: { address?: string; locality?: string; district?: string; state?: string; country: string; nearest_city: string; nearest_city_id: string; nearest_city_km: number }
  google_aq: { time?: string; indexes?: { code: string; name: string; aqi: number; category: string; dominant: string; color: string | null }[]
    pollutants?: Record<string, { name: string; value: number; units: string }>; health?: string }
  forecast: { now: { index?: number; system?: string; category?: Cat; pm25?: number; pm25_cams?: number; dominant?: string; peak72?: number; peak_time?: number; peak_category?: Cat; stage?: Grap }
    series: { time: number[]; index: (number | null)[]; level: number[]; pm25: (number | null)[]; now_offset: number } | null; source: string }
  weather: { temp_c?: number; rh?: number; wind_kmh?: number; wind_from?: number; wind_from_compass?: string; mixing_height_m?: number }
  fires: { within_50km: number; nearest: { lat: number; lon: number; km: number; frp: number; hours_ago: number; dir: string }[]; source: string }
  citizen_sensors: { count: number; median_pm25: number | null; nearest: { km: number; pm25: number; age_min: number }[]; source: string }
  stations: { count: number; nearest: { km: number; pm25: number; age_min: number }[]; source: string | null }
  imagery: { satellite: { date: string; label: string; url: string }[]; streetview: { available: boolean; date?: string; lat?: number; lon?: number; pano?: string; official?: boolean } }
  languages: string[]; authority: string
}
export type Fire = { lat: number; lon: number; frp: number; age_h: number }
export type WindVec = { lat: number; lon: number; u: number; v: number }
export type Corridor = {
  id: string; name: string; kind: string; blurb: string; path: [number, number][]; peak72: number; peak_category: Cat
  worst_city: string; worst_time: number; pop_m: number; spikes: number
  strip: { id: string; name: string; lat: number; lon: number; cells: { h: number; naqi: number | null; color: string }[] }[]
}
export type Report = {
  id: string; created_at: number; lat: number; lon: number; text: string; lang: string; thumb: string | null; has_voice: boolean
  analysis: { is_pollution_event: boolean; source_type: string; source_label: string; severity: number; confidence: number
    visual_evidence?: string[]; summary_en: string; language_detected: string; transcript?: string; translation_en?: string
    looks_authentic: boolean; authenticity_notes?: string; health_risk?: string; reply_to_citizen: string; tags?: string[] }
  verification: { score: number; status: string; signals: { ai_confidence: number; satellite: number; peer_reports: number; authentic: boolean; context_consistent: boolean }
    nearby_fires: { km: number; frp: number; hours_ago: number }[] }
  jurisdiction: { city: string; state: string; state_code: string; country_code?: string; district?: string; locality?: string; address?: string; route_to: string }
  downwind: { paths?: [number, number, number][][]; cities: { id: string; name: string; pop_m: number; eta_h: number }[]; pop_at_risk_m?: number }
  ai: { model: string; ms: number; modalities: string[] }
}
export type Evidence = { kind: 'satellite' | 'streetview'; url: string; date?: string; label?: string; source: string
  ai?: { visible_smoke: boolean; visible_haze: boolean; cloud_cover: string; observation: string } | null }
export type Alert = {
  id: string; created_at: number; status: string; languages: string[]; evidence?: Evidence[]
  context?: { authority?: string }
  target: { kind: string; id: string; lat: number; lon: number; name: string }
  draft: { title: string; severity: string; situation: string; evidence?: string[]
    actions: { action: string; owner: string; within_hours: number; why?: string }[]
    advisories: { lang: string; text: string }[]; sms: string; review_note?: string; fallback?: boolean }
  timeline: { status: string; at: number; by: string; note?: string; channels?: string[] }[]
  ai: { model: string; ms: number }
}
export type CommonsSummary = {
  mae_global?: number; federations?: Record<string, number>; federated_improvement_pct?: number
  india?: { mae_cams: number; mae_local: number; mae_federated: number; mae_personalised: number; mae_zero_data: number; nodes: number } | null
  nodes: number; samples: number; rounds: number; mae_cams: number; mae_local: number; mae_federated: number
  mae_personalised: number; mae_zero_data: number; raw_bytes_kept_local: number; bytes_shared: number
  train_ms: number; dp_sigma: number; improvement_pct: number; zero_data_improvement_pct: number
}
export type CommonsNode = {
  federation?: string; india?: boolean
  state: string; name: string; authority: string; cities: string[]; samples: number; lat: number; lon: number
  mae_cams: number; mae_local: number; mae_federated: number; mae_personalised: number; mae_zero_data: number
  bias_cams: number; mean_truth: number
}
export type Commons = { summary: CommonsSummary; rounds: { round: number; mae: number }[]; nodes: CommonsNode[]; card: Record<string, unknown> }
export type SimResult = {
  pm25_before: number; pm25_after: number; reduction: number; reduction_pct: number; naqi_before: number; naqi_after: number
  category_before: Cat; category_after: Cat; measures: { id: string; label: string; owner: string; lead_h: number; ugm3: number; exposure_only: boolean }[]
  compliance: number; people_benefiting_m: number; risk_reduction_pct: number; caveat: string; health?: HealthValue
}
export type Measure = { id: string; label: string; grap: number; owner: string; lead_h: number; cost: string; cuts: Record<string, number> }
export type Meta = {
  vapid_public_key?: string | null
  product: string; model: string; store: string; languages: Record<string, string>; maps_browser_key?: string | null
  states: Record<string, { name: string; languages: string[]; authority: string }>
  country_languages?: Record<string, string[]>
  countries: Record<string, { name: string; status: string; note?: string; cities?: number }>
  freshness: Record<string, number | null>; measures: Measure[]; sources: { name: string; use: string }[]
}

export type LiveEvent = { id: string; kind: 'spike' | 'fire' | 'report' | 'alert' | 'feed'; t: number; severity: number; title: string; sub: string
  lat?: number; lon?: number; city?: string; report?: string; alert?: string; country?: string | null }
export type ProtectSite = { name: string; group: 'school' | 'health'; type: string; lat: number; lon: number; km: number; eta_h?: number }
export type ProtectData = { city?: string; name?: string; radius_km: number; index_system: string; now: number; peak72: number
  schools: number; health: number; total: number; counts: Record<string, number>; top: ProtectSite[]; points: [number, number, number][]
  windows_text?: { outdoor_ok: string[]; stay_indoors: string[] }; source: string }
export type CopilotStep = { tool: string; args: Record<string, unknown>; summary: string; ms: number; ok: boolean }
export type CopilotAction = { type: 'fly' | 'city' | 'mode' | 'place' | 'protect' | 'alert' | 'detect'; lat?: number; lon?: number; range?: number
  id?: string; mode?: string; city?: string; scope?: 'india' | 'world' }
export type CopilotReply = { answer: string; steps: CopilotStep[]; actions: CopilotAction[]; model?: string | null; fallback?: boolean; partial?: boolean }
export type HealthValue = { days: number; delta_pm25: number; deaths_avoided: number; admissions_avoided: number; value: number; currency: string; unit: string; method: string }
export type LiveItem = { id: string; kind: 'citizen' | 'news' | 'satellite'; t: number; title: string; image: string; source: string
  lat: number; lon: number; place: string; url?: string; report?: string; country?: string | null }
export type DraftBody = { kind: 'city' | 'hotspot' | 'report' | 'place'; city?: string; report_id?: string; lat?: number; lon?: number
  languages?: string[]; attach_imagery?: boolean; label?: string; suggested?: string[]; audience?: 'authority' | 'schools' | 'hospitals' | 'public' }

async function req<T>(path: string, init?: RequestInit, timeoutMs = 60000): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(BASE + path, { ...init, signal: ctl.signal })
    if (!r.ok) {
      let msg = `${r.status}`
      try { msg = (await r.json()).detail ?? msg } catch { /* not json */ }
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    }
    return (await r.json()) as T
  } finally {
    clearTimeout(t)
  }
}

const post = <T,>(path: string, body: unknown, timeoutMs?: number) =>
  req<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs)

export const api = {
  meta: () => req<Meta>('/api/meta'),
  pulse: () => req<Pulse>('/api/pulse', undefined, 120000),
  city: (id: string) => req<City>(`/api/city/${id}`),
  timeline: () => req<{ frames: { h: number; t: number; naqi: Record<string, number | null>; level: Record<string, number> }[] }>('/api/timeline'),
  overview: () => req<Overview>('/api/overview', undefined, 30000),
  sensors: () => req<Sensors>('/api/sensors'),
  protectCity: (id: string) => req<ProtectData>(`/api/protect/city/${id}`, undefined, 60000),
  copilot: (messages: { role: 'user' | 'assistant'; text: string }[]) => post<CopilotReply>('/api/copilot', { messages }, 115000),
  pushSubscribe: (body: { subscription: { endpoint: string; keys: { p256dh: string; auth: string } }; lat: number; lon: number; profile: string; label: string }) =>
    post<{ id: string; ok: boolean }>('/api/push/subscribe', body, 20000),
  pushTest: (endpoint: string) => post<{ sent: boolean }>('/api/push/test', { endpoint }, 30000),
  live: () => req<{ items: LiveItem[] }>('/api/live', undefined, 40000),
  events: (country?: string | null) => req<{ events: LiveEvent[] }>(`/api/events${country ? `?country=${country}` : ''}`),
  place: (lat: number, lon: number) => req<PlaceIntel>(`/api/place?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, undefined, 60000),
  corridors: () => req<{ corridors: Corridor[] }>('/api/corridors'),
  wind: (h = 0, scope: 'global' | 'india' = 'global') => req<{ vectors: WindVec[]; step: number }>(`/api/wind?h=${h}&scope=${scope}`),
  fires: (bbox?: [number, number, number, number]) => req<FireFeed>(bbox ? `/api/fires?bbox=${bbox.map((v) => v.toFixed(2)).join(',')}` : '/api/fires'),
  attribution: (id: string) => req<Attribution>(`/api/attribution/${id}`, undefined, 90000),
  buildings: (lat: number, lon: number, r = 700) => req<BuildingSet>(`/api/buildings?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&r=${r}`, undefined, 45000),
  hotspots: (scope: 'world' | 'india' = 'world') => req<Hotspots>(`/api/hotspots?scope=${scope}`, undefined, 90000),
  simulate: (city: string, measures: string[], compliance: number) => post<SimResult>('/api/simulate', { city, measures, compliance }),
  reports: () => req<{ reports: Report[] }>('/api/reports'),
  createReport: (fd: FormData) => req<Report>('/api/reports', { method: 'POST', body: fd }, 120000),
  alerts: () => req<{ alerts: Alert[] }>('/api/alerts'),
  draftAlert: (body: DraftBody, timeoutMs = 95000) => post<Alert>('/api/alerts/draft', body, timeoutMs),
  alertStatus: (id: string, status: string, note = '') => post<Alert>(`/api/alerts/${id}/status`, { status, note, by: 'Duty Officer' }),
  ask: (question: string, city?: string) => post<{ answer: string; model: string | null }>('/api/ask', { question, city }, 90000),
  commons: () => req<Commons>('/api/commons', undefined, 90000),
  train: (rounds: number, dp_sigma: number) => post<Commons>('/api/commons/train', { rounds, dp_sigma }, 120000),
  tts: async (text: string): Promise<string> => {
    const r = await fetch(BASE + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    if (!r.ok) throw new Error('voice unavailable')
    return URL.createObjectURL(await r.blob())
  },
}
