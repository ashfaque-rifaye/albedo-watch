import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Alert, Attribution, BuildingSet, City, Commons, Corridor, FireFeed, Hotspot, Hotspots, LiveEvent, Meta, PlaceIntel, Pulse, Report, Sensors, WindVec } from '../lib/api'
import { api } from '../lib/api'
import { fmt, istTime } from '../lib/format'
import { Logo, Wordmark } from '../components/Logo'
import type { FlyTarget, GlobeLayers, Lens, Theme, Track } from './Globe'
import { Coach, EventFeed, Hud, Legend, TourCaption } from './hud'
import { AskDrawer, CitizenPanel, CommandPanel, CommonsPanel, DetectPanel, ForecastPanel, PlacePanel, PulsePanel, TracePanel } from './panels'
import './app.css'

const Globe = lazy(() => import('./Globe'))

export type Mode = 'pulse' | 'detect' | 'trace' | 'citizen' | 'forecast' | 'command' | 'commons' | 'place'
const MODES: { id: Exclude<Mode, 'place'>; label: string; verb: string; icon: string }[] = [
  { id: 'pulse', label: 'Pulse', verb: 'Air near you & worldwide', icon: '◉' },
  { id: 'detect', label: 'Detect', verb: 'Hidden hotspots', icon: '◎' },
  { id: 'trace', label: 'Trace', verb: 'Source attribution', icon: '↶' },
  { id: 'citizen', label: 'Citizen', verb: 'Report in any language', icon: '✦' },
  { id: 'forecast', label: 'Forecast', verb: '72 h corridors', icon: '◷' },
  { id: 'command', label: 'Command', verb: 'Alerts & action', icon: '▲' },
  { id: 'commons', label: 'Accuracy', verb: 'Forecasts that learn locally', icon: '⬡' },
]
export type DraftFor = { kind: 'city' | 'hotspot' | 'report' | 'place'; city?: string; report_id?: string; lat?: number; lon?: number; label?: string; suggested?: string[] }
export type Hub = { lat: number; lon: number; intel: PlaceIntel | null }
export type City3D = {
  lat: number; lon: number; label: string; mode: 'model' | 'photoreal'; b: BuildingSet | null; loading: boolean; err: string | null
  tint: string | null; haze: boolean; pm25: number | null; rh: number | null; ext: number | null; vis_km: number | null
}

/** Visibility & haze from measured PM2.5 and humidity: IMPROVE-style mass extinction (3 m²/g dry,
 *  hygroscopic growth f(RH)) + Rayleigh 10 Mm⁻¹; Koschmieder visibility = 3.912 / b_ext. */
export function hazeOf(i: PlaceIntel | null) {
  if (!i) return { pm25: null, rh: null, ext: null, vis_km: null, tint: null }
  const pol = i.google_aq.pollutants ?? {}
  const pmG = pol.pm25?.value ?? Object.values(pol).find((x) => /2\.5/.test(x.name ?? ''))?.value
  const pm = pmG ?? i.forecast.now.pm25 ?? null
  const rh = i.weather.rh ?? 60
  const tint = i.google_aq.indexes?.find((x) => x.code !== 'uaqi')?.color ?? i.forecast.now.category?.color ?? null
  if (pm == null) return { pm25: null, rh, ext: null, vis_km: null, tint }
  const f = Math.min(4, Math.pow(1 - Math.min(95, Math.max(0, rh)) / 100, -0.55))
  const b = 3 * f * pm + 10
  return { pm25: pm, rh, ext: b * 1e-6, vis_km: 3912 / b, tint }
}

export type Ctx = {
  meta: Meta | null
  pulse: Pulse | null
  cities: City[]
  hotspots: Hotspots | null
  hotScope: 'world' | 'india'
  setHotScope: (s: 'world' | 'india') => void
  reports: Report[]
  alerts: Alert[]
  corridors: Corridor[]
  commons: Commons | null
  fireInfo: FireFeed | null
  selectedCity: string | null
  selectCity: (id: string | null, fly?: boolean) => void
  setMode: (m: Mode) => void
  attribution: Attribution | null
  setAttribution: (a: Attribution | null) => void
  setPlume: (p: [number, number, number][][] | null) => void
  pick: { lat: number; lon: number; h?: number } | null
  setPick: (p: { lat: number; lon: number; h?: number } | null) => void
  pickMode: boolean
  setPickMode: (b: boolean) => void
  flyTo: (lon: number, lat: number, range: number, pitch?: number, heading?: number) => void
  refreshReports: () => Promise<void>
  refreshAlerts: () => Promise<void>
  setCommons: (c: Commons) => void
  reloadPulse: () => Promise<void>
  selectedReport: string | null
  setSelectedReport: (id: string | null) => void
  onHotspot: (h: Hotspot) => void
  draftFor: DraftFor | null
  setDraftFor: (d: DraftFor | null) => void
  place: { lat: number; lon: number } | null
  openPlace: (lat: number, lon: number, range?: number, h?: number) => void
  city3d: City3D | null
  enter3D: (lat: number, lon: number, o?: { intel?: PlaceIntel | null; label?: string; mode?: 'model' | 'photoreal' }) => void
  exit3D: () => void
  setCity3d: (f: (c: City3D | null) => City3D | null) => void
  layers: GlobeLayers
  setLayers: (l: GlobeLayers) => void
  country: string | null
  setCountry: (c: string | null) => void
  countries: { code: string; name: string; region: string; n: number }[]
  hub: Hub | null
  locating: boolean
  locateMe: () => void
  clearHub: () => void
  track: (lon: number, lat: number, label: string) => void
}

const RANGE = { world: 1.8e7, city: 9e4, street: 2800 }
const isMobile = () => window.matchMedia('(max-width: 820px)').matches
function loadHub(): { lat: number; lon: number } | null { try { const s = localStorage.getItem('aw-hub'); return s ? JSON.parse(s) : null } catch { return null } }

export default function MissionControl() {
  const q = new URLSearchParams(location.search)
  const initial = (q.get('mode') as Mode) || 'pulse'
  const mobile = useMemo(isMobile, [])
  const [mode, setModeRaw] = useState<Mode>([...MODES.map((m) => m.id), 'place'].includes(initial as never) ? initial : 'pulse')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [pulse, setPulse] = useState<Pulse | null>(null)
  const [wind, setWind] = useState<WindVec[]>([])
  const [fireFeed, setFireFeed] = useState<FireFeed | null>(null)
  const [fireDets, setFireDets] = useState<FireFeed | null>(null)
  const [sensors, setSensors] = useState<Sensors | null>(null)
  const [hotScope, setHotScope] = useState<'world' | 'india'>('world')
  const [hotspots, setHotspots] = useState<Hotspots | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [corridors, setCorridors] = useState<Corridor[]>([])
  const [commons, setCommons] = useState<Commons | null>(null)
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [frames, setFrames] = useState<{ h: number; t: number; naqi: Record<string, number | null>; level: Record<string, number> }[]>([])
  const [frameIdx, setFrameIdx] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [replay, setReplay] = useState(false)
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [selectedReport, setSelectedReport] = useState<string | null>(null)
  const [attribution, setAttribution] = useState<Attribution | null>(null)
  const [plume, setPlume] = useState<[number, number, number][][] | null>(null)
  const [pick, setPick] = useState<{ lat: number; lon: number; h?: number } | null>(null)
  const [pickMode, setPickMode] = useState(false)
  const [place, setPlace] = useState<{ lat: number; lon: number } | null>(() => {
    const la = parseFloat(q.get('lat') ?? ''), lo = parseFloat(q.get('lon') ?? '')
    return Number.isFinite(la) && Number.isFinite(lo) ? { lat: la, lon: lo } : null
  })
  const [fly, setFly] = useState<FlyTarget | null>(null)
  const [theme, setTheme] = useState<Theme>('satellite')
  const [lens, setLens] = useState<Lens>('true')
  const [hud, setHud] = useState(!mobile)
  const [trackT, setTrackT] = useState<Track>(null)
  const [city3d, setCity3dRaw] = useState<City3D | null>(null)
  const [coach, setCoach] = useState(() => { try { return !localStorage.getItem('aw-onboarded') } catch { return false } })
  const [tapped, setTapped] = useState(() => { try { return !!localStorage.getItem('aw-tapped') } catch { return true } })
  const [layers, setLayers] = useState<GlobeLayers>({ wind: true, fires: true, cities: true, hotspots: true, reports: true, sensors: true,
    corridors: false, aq: false, photoreal: false, sunlight: true })
  const [layersOpen, setLayersOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [fireHelp, setFireHelp] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftFor, setDraftFor] = useState<DraftFor | null>(null)
  const [country, setCountryRaw] = useState<string | null>(() => { try { return localStorage.getItem('aw-country') } catch { return null } })
  const [hub, setHub] = useState<Hub | null>(() => { const h = loadHub(); return h ? { ...h, intel: null } : null })
  const [locating, setLocating] = useState(false)
  const [sheet, setSheet] = useState<'peek' | 'half' | 'full' | 'open' | 'min'>(mobile ? 'peek' : 'open')
  const [tour, setTour] = useState<{ step: number; steps: { title: string; text: string; go: () => void }[] } | null>(null)
  const viewReq = useRef(0)
  const tourTimer = useRef<number | null>(null)

  const setMode = useCallback((m: Mode) => {
    setModeRaw(m)
    if (mobile) setSheet((s) => (s === 'peek' ? 'half' : s))
    const u = new URL(location.href); u.searchParams.set('mode', m)
    if (m !== 'place') { u.searchParams.delete('lat'); u.searchParams.delete('lon') }
    history.replaceState(null, '', u)
  }, [mobile])

  const reloadPulse = useCallback(async () => {
    try {
      const p = await api.pulse(); setPulse(p); setError(null)
      if (p.stale) setTimeout(() => { api.pulse().then((x) => { if (!x.stale) setPulse(x) }).catch(() => {}) }, 20000)
    } catch (e) { setError(`Live data unavailable — ${(e as Error).message}`) }
  }, [])
  const refreshReports = useCallback(async () => { try { setReports((await api.reports()).reports) } catch { /* keep last */ } }, [])
  const refreshAlerts = useCallback(async () => { try { setAlerts((await api.alerts()).alerts) } catch { /* keep last */ } }, [])
  const refreshEvents = useCallback(async () => { try { setEvents((await api.events()).events) } catch { /* keep last */ } }, [])

  useEffect(() => {
    reloadPulse()
    api.meta().then((m) => { setMeta(m); import('./Globe').then((g) => g.setGoogleKey(m.maps_browser_key)) }).catch(() => {})
    api.wind(0, 'global').then((w) => setWind(w.vectors)).catch(() => {})
    api.fires().then(setFireFeed).catch(() => {})
    api.sensors().then(setSensors).catch(() => {})
    api.timeline().then((t) => setFrames(t.frames)).catch(() => {})
    api.corridors().then((c) => setCorridors(c.corridors)).catch(() => {})
    api.commons().then((c) => ('summary' in c ? setCommons(c) : null)).catch(() => {})
    refreshReports(); refreshAlerts(); refreshEvents()
    const iv = setInterval(() => { reloadPulse(); refreshReports(); refreshEvents(); api.sensors().then(setSensors).catch(() => {}) }, 3 * 60 * 1000)
    return () => clearInterval(iv)
  }, [reloadPulse, refreshReports, refreshAlerts, refreshEvents])

  useEffect(() => {
    setHotspots(null)
    api.hotspots(hotScope).then((h) => {
      setHotspots(h)
      if (h.stale) setTimeout(() => api.hotspots(hotScope).then((x) => !x.stale && setHotspots(x)).catch(() => {}), 20000)
    }).catch(() => {})
  }, [hotScope])

  // saved hub: refresh its live readings
  useEffect(() => { if (hub && !hub.intel) api.place(hub.lat, hub.lon).then((i) => setHub({ lat: hub.lat, lon: hub.lon, intel: i })).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (mode === 'forecast') setLayers((l) => ({ ...l, corridors: true })) }, [mode])
  useEffect(() => {
    if (mode !== 'place') setCity3dRaw(null)
    if (mode !== 'trace') setAttribution(null)
    if (mode !== 'citizen' && mode !== 'detect' && mode !== 'place') setPlume(null)
    if (mode !== 'citizen') setPickMode(false)
  }, [mode])

  useEffect(() => {
    if (!playing || !frames.length) return
    const iv = setInterval(() => setFrameIdx((i) => { const n = (i ?? frames.findIndex((f) => f.h === 0)) + 1; return n >= frames.length ? 0 : n }), 700)
    return () => clearInterval(iv)
  }, [playing, frames])

  useEffect(() => { if (place && mode === 'place') setFly({ lon: place.lon, lat: place.lat, range: RANGE.street, pitch: -40, key: Date.now() }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cities = pulse?.cities ?? []
  const countries = useMemo(() => {
    const m = new Map<string, { code: string; name: string; region: string; n: number }>()
    for (const c of cities) { const e = m.get(c.country); if (e) e.n++; else m.set(c.country, { code: c.country, name: c.country_name, region: c.india ? 'India' : c.region, n: 1 }) }
    return [...m.values()].sort((a, b) => (a.code === 'IN' ? -1 : b.code === 'IN' ? 1 : a.name.localeCompare(b.name)))
  }, [cities])
  const flyTo = useCallback((lon: number, lat: number, range: number, pitch = -45, heading = 0) => setFly({ lon, lat, range, pitch, heading, key: Date.now() }), [])

  const setCountry = useCallback((c: string | null) => {
    setCountryRaw(c)
    try { if (c) localStorage.setItem('aw-country', c); else localStorage.removeItem('aw-country') } catch { /* private mode */ }
    if (!c) { setFly({ lon: 79, lat: 18, range: RANGE.world, pitch: -90, key: Date.now() }); return }
    const cs = cities.filter((x) => x.country === c)
    if (!cs.length) return
    const lats = cs.map((x) => x.lat), lons = cs.map((x) => x.lon)
    const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons))
    setFly({ lon: (Math.min(...lons) + Math.max(...lons)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      range: Math.max(9e5, span * 1.9e5 + 6e5), pitch: -70, key: Date.now() })
  }, [cities])

  const selectCity = useCallback((id: string | null, doFly = true) => {
    setSelectedCity(id)
    const c = cities.find((x) => x.id === id)
    if (c && doFly) { setTrackT({ lon: c.lon, lat: c.lat, label: c.name }); setFly({ lon: c.lon, lat: c.lat, range: 2.6e5, pitch: -40, key: Date.now() }) }
    if (mobile && id) setSheet('half')
  }, [cities, mobile])

  const openPlace = useCallback((lat: number, lon: number, range = RANGE.street, h?: number) => {
    setPlace({ lat, lon }); setPick({ lat, lon, h }); setModeRaw('place'); setCity3dRaw(null)
    if (!tapped) { setTapped(true); try { localStorage.setItem('aw-tapped', '1') } catch { /* private mode */ } }
    if (mobile) setSheet('half')
    const u = new URL(location.href); u.searchParams.set('mode', 'place'); u.searchParams.set('lat', lat.toFixed(5)); u.searchParams.set('lon', lon.toFixed(5))
    history.replaceState(null, '', u)
    setTrackT({ lon, lat, h, label: `${lat.toFixed(3)}, ${lon.toFixed(3)}` })
    setFly({ lon, lat, h, range, pitch: -40, key: Date.now() })
  }, [mobile, tapped])

  // ---- 3D city: OSM building model (default in India, where Google's mesh is flat) or Google photoreal,
  // with haze computed from the air measured at that spot.
  const setCity3d = useCallback((f: (c: City3D | null) => City3D | null) => setCity3dRaw(f), [])
  const exit3D = useCallback(() => setCity3dRaw(null), [])
  const enter3D = useCallback((lat: number, lon: number, o: { intel?: PlaceIntel | null; label?: string; mode?: 'model' | 'photoreal' } = {}) => {
    const india = lat > 6 && lat < 37.5 && lon > 68 && lon < 97.5
    const m = o.mode ?? (india ? 'model' : 'photoreal')
    const z = hazeOf(o.intel ?? null)
    const same = (c: City3D | null) => !!c && c.lat === lat && c.lon === lon
    setCity3dRaw({ lat, lon, label: o.label ?? '', mode: m, b: null, loading: m === 'model', err: null, haze: true, ...z })
    setTrackT({ lon, lat, label: o.label || 'city' })
    if (mobile) setSheet('peek')  // on a phone, give the 3D view the whole screen
    setFly({ lon, lat, range: m === 'model' ? 1150 : 950, pitch: -27, heading: 25, duration: 3, key: Date.now() })
    if (!o.intel) api.place(lat, lon).then((i) => setCity3dRaw((c) => (same(c) ? { ...c!, ...hazeOf(i) } : c))).catch(() => {})
    if (m === 'model') api.buildings(lat, lon, 750)
      .then((b) => setCity3dRaw((c) => (same(c) ? { ...c!, b, loading: false } : c)))
      .catch((e) => setCity3dRaw((c) => (same(c) ? { ...c!, loading: false, err: (e as Error).message } : c)))
  }, [mobile])

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) { setError('Location is not available in this browser.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude
      try { localStorage.setItem('aw-hub', JSON.stringify({ lat, lon })) } catch { /* private mode */ }
      setHub({ lat, lon, intel: null }); setModeRaw('pulse'); setSelectedCity(null)
      setFly({ lon, lat, range: 22000, pitch: -45, key: Date.now() })
      try {
        const i = await api.place(lat, lon); setHub({ lat, lon, intel: i })
        if (i.place.country) { setCountryRaw(i.place.country); try { localStorage.setItem('aw-country', i.place.country) } catch { /* */ } }
      } catch { /* keep hub without intel */ }
      setLocating(false)
    }, () => { setLocating(false); setError('Location permission denied — choose your country instead.') }, { timeout: 10000, enableHighAccuracy: false })
  }, [])
  const clearHub = useCallback(() => { setHub(null); try { localStorage.removeItem('aw-hub') } catch { /* */ } }, [])
  const track = useCallback((lon: number, lat: number, label: string) => { setTrackT({ lon, lat, label }); setFly({ lon, lat, range: 3500, pitch: -35, key: Date.now() }) }, [])

  const onHotspot = useCallback((h: Hotspot) => {
    setMode('detect')
    setTrackT({ lon: h.lon, lat: h.lat, label: h.admin?.district || h.place.label })
    setFly({ lon: h.lon, lat: h.lat, range: 45000, pitch: -45, key: Date.now() })
    window.dispatchEvent(new CustomEvent('albedo:hotspot', { detail: h }))
  }, [setMode])

  const onView = useCallback((bbox: [number, number, number, number] | null, height: number) => {
    if (!bbox || height > 3.5e6) { setFireDets(null); return }
    const id = ++viewReq.current
    api.fires(bbox).then((f) => { if (id === viewReq.current) setFireDets(f) }).catch(() => {})
  }, [])

  const onEvent = useCallback((e: LiveEvent) => {
    if (e.kind === 'spike' && e.city) { setMode('pulse'); selectCity(e.city) }
    else if (e.kind === 'report' && e.report) { setSelectedReport(e.report); setMode('citizen') }
    else if (e.kind === 'alert') setMode('command')
    else if (e.lat != null && e.lon != null) openPlace(e.lat, e.lon, e.kind === 'fire' ? 30000 : RANGE.street)
  }, [setMode, selectCity, openPlace])

  // ---- cinematic tour, built from live data ----
  const stopTour = useCallback(() => { if (tourTimer.current) clearTimeout(tourTimer.current); tourTimer.current = null; setTour(null) }, [])
  const startTour = useCallback(() => {
    const s = pulse?.summary
    const hs = hotspots?.hotspots?.[0]
    const worst = [...cities].filter((c) => c.spike).sort((a, b) => b.spike!.peak - a.spike!.peak)[0]
    const steps = [
      { title: 'One planet, live', text: `${fmt(s?.cities)} cities across ${s?.countries ?? '…'} countries. Embers are today's ${fmt(fireFeed?.count)} NASA heat detections; streaks are real winds.`,
        go: () => setFly({ lon: 20, lat: 10, range: 2.2e7, pitch: -90, duration: 3, key: Date.now() }) },
      ...(worst ? [{ title: `${worst.name}: unhealthy air ahead`, text: `Forecast ${worst.index_system} ${worst.spike!.peak} (${worst.spike!.peak_category.label}) in ~${worst.spike!.lead_hours} h — ${worst.spike!.grap.name}.`,
        go: () => setFly({ lon: worst.lon, lat: worst.lat, range: 1.6e6, pitch: -55, duration: 4, key: Date.now() }) }] : []),
      { title: 'India, state by state', text: `53 cities on CPCB's NAQI with GRAP stages; forecasts corrected by a federation of Indian states that never share raw data.`,
        go: () => setFly({ lon: 79, lat: 22, range: 4.2e6, pitch: -70, duration: 4, key: Date.now() }) },
      ...(hs ? [{ title: `Hidden hotspot · ${hs.admin?.district || hs.place.label}`, text: hs.why,
        go: () => { setTrackT({ lon: hs.lon, lat: hs.lat, label: hs.admin?.district || 'hotspot' }); setFly({ lon: hs.lon, lat: hs.lat, range: 30000, pitch: -40, duration: 5, key: Date.now() }) } }] : []),
      { title: 'Connaught Place, New Delhi, in 3D', text: 'Buildings from OpenStreetMap; the haze is computed from the PM2.5 measured here right now. Click anywhere on Earth, then "3D city", for the same view.',
        go: () => { openPlace(28.6315, 77.2167, 2800); setTimeout(() => enter3D(28.6315, 77.2167, { label: 'Connaught Place' }), 400) } },
    ]
    setMode('pulse'); setSheet(mobile ? 'peek' : 'min')
    let i = 0
    const run = () => {
      if (i >= steps.length) { setTour(null); return }
      setTour({ step: i, steps }); steps[i].go(); i++
      tourTimer.current = window.setTimeout(run, 9000)
    }
    run()
  }, [pulse, hotspots, cities, fireFeed, setMode, mobile, openPlace, enter3D])

  const feeds = [
    { name: 'FIRMS', ageS: meta?.freshness?.fires ?? (fireFeed ? 0 : null) },
    { name: 'CAMS', ageS: meta?.freshness?.city_series ?? (pulse ? 0 : null) },
    { name: 'SENSORS', ageS: sensors ? 0 : null },
    { name: 'WIND', ageS: wind.length ? 0 : null },
  ]

  const ctx: Ctx = {
    meta, pulse, cities, hotspots, hotScope, setHotScope, reports, alerts, corridors, commons, fireInfo: fireFeed,
    selectedCity, selectCity, setMode, attribution, setAttribution, setPlume, pick, setPick, pickMode, setPickMode, flyTo,
    refreshReports, refreshAlerts, setCommons, reloadPulse, selectedReport, setSelectedReport, onHotspot, draftFor, setDraftFor,
    place, openPlace, layers, setLayers, country, setCountry, countries, hub, locating, locateMe, clearHub, track,
    city3d, enter3D, exit3D, setCity3d,
  }

  const frame = replay && frameIdx != null ? frames[frameIdx] : null
  const nowIdx = frames.findIndex((f) => f.h === 0)
  const activeMode = mode === 'place' ? { label: 'Place', verb: 'Live at this spot', icon: '⌖' } : MODES.find((m) => m.id === mode)!
  const network = mode === 'commons' && commons ? commons.nodes.map((n) => ({ lat: n.lat, lon: n.lon, name: n.name, fed: n.federation })) : null
  const shownEvents = country ? events.filter((e) => !e.country || e.country === country) : events
  const cycleSheet = () => setSheet((s) => (mobile ? (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek') : s === 'open' ? 'min' : 'open'))

  return (
    <div className={`mc ${hud ? 'hud-on' : ''} sheet-${sheet}`}>
      <Suspense fallback={<div className="map-loading"><Logo size={120} /></div>}>
        <Globe
          cities={cities} frameLevel={frame?.level ?? null} wind={wind}
          fireBins={fireFeed?.bins ?? []} fireDets={fireDets?.fires ?? null}
          citizen={sensors?.citizen ?? []} stations={sensors?.stations ?? []}
          hotspots={hotspots?.hotspots ?? []} reports={reports} corridors={corridors}
          trajectories={attribution?.paths ?? null} clusters={attribution?.clusters ?? []} plume={plume}
          network={network} selectedCity={selectedCity} selectedReport={selectedReport}
          pick={pick} hub={hub ? { lat: hub.lat, lon: hub.lon } : null} theme={theme}
          layers={city3d?.mode === 'photoreal' ? { ...layers, photoreal: true } : layers}
          buildings={city3d?.mode === 'model' ? city3d.b : null} buildingTint={city3d?.tint ?? null}
          haze={city3d?.haze ? city3d.ext : null}
          lens={lens} hud={hud} autoPhotoreal={!mobile} track={trackT} flyTo={fly}
          onCity={(id) => { selectCity(id, true); if (mode !== 'trace' && mode !== 'command') setMode('pulse') }}
          onHotspot={onHotspot}
          onReport={(id) => { setSelectedReport(id); setMode('citizen') }}
          onPlace={(lat, lon, h) => { if (pickMode) { setPick({ lat, lon, h }); setPickMode(false) } else openPlace(lat, lon, RANGE.street, h) }}
          onView={onView}
          onUserMove={() => { if (tour) stopTour() }}
        />
      </Suspense>
      <div className="vignette" />
      {hud && <Hud lens={lens} setLens={setLens} feeds={feeds} trackLabel={trackT?.label ?? null} onStopTrack={() => setTrackT(null)} />}

      <header className="mc-top">
        <a href="/" className="mc-brand" aria-label="Albedo-Watch home"><Logo size={34} /><Wordmark size={19} /></a>
        <nav className="mc-modes glass" aria-label="Modes">
          {MODES.map((m) => (
            <button key={m.id} className={`mc-mode ${m.id === mode ? 'on' : ''}`} onClick={() => setMode(m.id)} title={m.verb}>
              <span className="mc-mode-ic">{m.icon}</span>{m.label}
            </button>
          ))}
        </nav>
        <div className="mc-status">
          <select className="select country-select" value={country ?? ''} onChange={(e) => setCountry(e.target.value || null)} aria-label="Country">
            <option value="">🌐 Whole world</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.n})</option>)}
          </select>
          <button className="chip chip-btn hide-m" onClick={() => setFireHelp(!fireHelp)} title="What is a heat detection?">
            <span className="live-dot" /> {fmt(fireFeed?.count)} heat detections <span className="q">?</span>
          </button>
          <button className="btn btn-primary btn-sm ask-btn" onClick={() => setAskOpen(true)}>✦ Ask</button>
        </div>
      </header>
      {fireHelp && fireFeed && (
        <div className="popover glass fade-up" role="dialog">
          <div className="eyebrow">What you are seeing</div>
          <p>{fireFeed.definition}</p>
          <div className="kv-grid">
            <div><span>Detections, last 24 h</span><b className="mono">{fmt(fireFeed.count)}</b></div>
            <div><span>Intense (≥ 20 MW)</span><b className="mono">{fmt(fireFeed.large)}</b></div>
            <div><span>Median intensity</span><b className="mono">{fireFeed.median_frp} MW</b></div>
            <div><span>Source</span><b>NASA FIRMS (VIIRS)</b></div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setFireHelp(false)}>Got it</button>
        </div>
      )}

      <aside className={`mc-panel glass ${mode} s-${sheet}`} key={mode}>
        <button className="mc-panel-head" onClick={cycleSheet} aria-label="Expand or collapse panel">
          {mobile && <span className="grab" />}
          <div className="mc-panel-head-row">
            <div>
              <div className="eyebrow">{activeMode.icon} {activeMode.label}{country ? ` · ${countries.find((c) => c.code === country)?.name ?? country}` : ''}</div>
              <div className="mc-panel-title display">{activeMode.verb}</div>
            </div>
            <span className="chev">{mobile ? (sheet === 'full' ? '▾' : '▴') : sheet === 'open' ? '–' : '+'}</span>
          </div>
        </button>
        <div className="mc-panel-body scroll-y">
          {error && <div className="err">{error} <button className="btn btn-ghost btn-sm" onClick={() => { setError(null); reloadPulse() }}>OK</button></div>}
          {pulse?.stale && mode === 'pulse' && <div className="note">Showing the last saved snapshot while live data refreshes…</div>}
          {mode === 'pulse' && <PulsePanel ctx={ctx} />}
          {mode === 'detect' && <DetectPanel ctx={ctx} />}
          {mode === 'trace' && <TracePanel ctx={ctx} />}
          {mode === 'citizen' && <CitizenPanel ctx={ctx} />}
          {mode === 'forecast' && <ForecastPanel ctx={ctx} />}
          {mode === 'command' && <CommandPanel ctx={ctx} />}
          {mode === 'commons' && <CommonsPanel ctx={ctx} />}
          {mode === 'place' && <PlacePanel ctx={ctx} />}
        </div>
      </aside>

      <div className={`mc-legend glass ${layersOpen || legendOpen ? 'open' : ''}`}>
        <div className="seg theme-seg" role="group" aria-label="Imagery">
          {([['satellite', 'Satellite'], ['today', 'NASA today'], ['night', 'Night']] as const).map(([k, l]) => (
            <button key={k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{l}</button>
          ))}
        </div>
        <div className="legend-tabs">
          <button className={legendOpen ? 'on' : ''} onClick={() => { setLegendOpen(!legendOpen); setLayersOpen(false) }}>◧ Legend</button>
          <button className={layersOpen ? 'on' : ''} onClick={() => { setLayersOpen(!layersOpen); setLegendOpen(false) }}>☰ Layers</button>
          <button className={hud ? 'on' : ''} onClick={() => setHud(!hud)} title="God's-eye HUD: telemetry, detection boxes and satellite lenses">⌖ HUD</button>
        </div>
        {legendOpen && <Legend compact />}
        {layersOpen && (
          <div className="layer-toggles">
            {([['wind', 'Wind flow', '#8ce8ff'], ['fires', 'NASA heat detections', '#ff8a3d'], ['sensors', 'Ground sensors', '#9ccc3a'],
              ['hotspots', 'Hidden hotspots', '#f096ff'], ['reports', 'Citizen reports', '#f1e6c8'], ['corridors', 'Corridors (India)', '#f2c230'],
              ['aq', 'Google live air-quality map', '#6fb6ff'], ['photoreal', 'Photorealistic 3D (always)', '#ffffff'], ['sunlight', 'Real sunlight', '#ffe9a8']] as const).map(([k, label, c]) => (
              <label key={k} className="layer-toggle">
                <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                <span className="dot" style={{ background: c, opacity: layers[k] ? 1 : 0.25 }} />{label}
              </label>
            ))}
            <div className="fine" style={{ marginTop: 4 }}>3D cities switch on automatically below ~40 km.</div>
          </div>
        )}
      </div>

      {replay && frames.length > 0 ? (
        <div className="mc-time glass">
          <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play forecast'}>{playing ? '❚❚' : '▶'}</button>
          <div className="time-body">
            <div className="time-row">
              <span className="eyebrow">Forecast replay · {frame ? (frame.h === 0 ? 'now' : frame.h < 0 ? `${-frame.h} h ago` : `+${frame.h} h`) : 'now'}</span>
              <span className="mono muted" style={{ fontSize: 12 }}>{frame ? istTime(frame.t) : ''} IST · city colours show the forecast at this hour</span>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setReplay(false); setPlaying(false); setFrameIdx(null) }}>Close</button>
            </div>
            <input type="range" min={0} max={frames.length - 1} value={frameIdx ?? nowIdx} onChange={(e) => { setPlaying(false); setFrameIdx(+e.target.value) }} className="time-range" aria-label="Forecast time" />
            <div className="time-ticks mono"><span>−24 h</span><span>now</span><span>+24 h</span><span>+48 h</span><span>+72 h</span></div>
          </div>
        </div>
      ) : !tour && <EventFeed events={shownEvents} onPick={onEvent} mobile={mobile} />}

      <div className="view-btns">
        <button className="glass" title="Whole Earth" onClick={() => setFly({ lon: 79, lat: 18, range: RANGE.world, pitch: -90, key: Date.now() })}>◍</button>
        <button className={`glass ${locating ? 'busy' : ''}`} title="My location" onClick={locateMe}>⌖</button>
        <button className="glass" title="Forecast replay" onClick={() => { setReplay(true); setFrameIdx(nowIdx); setPlaying(true) }}>◷</button>
        <button className="glass" title="Guided flight" onClick={() => (tour ? stopTour() : startTour())}>{tour ? '■' : '▶'}</button>
        <button className="glass show-m" title="Legend" onClick={() => setLegendOpen(true)}>i</button>
        <button className="glass" title="Quick tour of the controls" onClick={() => setCoach(true)}>?</button>
      </div>
      {coach && pulse && <Coach onDone={() => { setCoach(false); try { localStorage.setItem('aw-onboarded', '1') } catch { /* private mode */ } }} />}
      {!coach && !tapped && !tour && mode === 'pulse' && pulse && (
        <div className="tap-hint glass"><span className="tap-dot" />{mobile ? 'Tap' : 'Click'} anywhere on Earth to see the air there right now</div>
      )}
      {tour && <TourCaption step={tour.step} total={tour.steps.length} title={tour.steps[tour.step].title} text={tour.steps[tour.step].text} onStop={stopTour} />}
      {mobile && legendOpen && <div className="legend-sheet glass fade-up"><Legend onClose={() => setLegendOpen(false)} /></div>}
      {pickMode && <div className="pick-hint glass">Tap the globe where you saw pollution</div>}
      {askOpen && <AskDrawer ctx={ctx} onClose={() => setAskOpen(false)} />}
    </div>
  )
}
