import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Alert, Attribution, City, Commons, Corridor, FireFeed, Hotspot, Hotspots, Meta, Pulse, Report, Sensors, WindVec } from '../lib/api'
import { api } from '../lib/api'
import { fmt, istTime } from '../lib/format'
import { Logo, Wordmark } from '../components/Logo'
import type { FlyTarget, GlobeLayers, Theme } from './Globe'
import { LEVEL_COLORS } from './Globe'
import { AskDrawer, CitizenPanel, CommandPanel, CommonsPanel, DetectPanel, ForecastPanel, PlacePanel, PulsePanel, TracePanel } from './panels'
import './app.css'

const Globe = lazy(() => import('./Globe'))

export type Mode = 'pulse' | 'detect' | 'trace' | 'citizen' | 'forecast' | 'command' | 'commons' | 'place'
const MODES: { id: Exclude<Mode, 'place'>; label: string; verb: string; icon: string }[] = [
  { id: 'pulse', label: 'Pulse', verb: 'The planet’s air, live', icon: '◉' },
  { id: 'detect', label: 'Detect', verb: 'Hidden hotspots', icon: '◎' },
  { id: 'trace', label: 'Trace', verb: 'Source attribution', icon: '↶' },
  { id: 'citizen', label: 'Citizen', verb: 'Report in any language', icon: '✦' },
  { id: 'forecast', label: 'Forecast', verb: '72 h corridors', icon: '◷' },
  { id: 'command', label: 'Command', verb: 'Alerts & action', icon: '▲' },
  { id: 'commons', label: 'Commons', verb: 'Federated models', icon: '⬡' },
]
export type DraftFor = { kind: 'city' | 'hotspot' | 'report' | 'place'; city?: string; report_id?: string; lat?: number; lon?: number; label?: string; suggested?: string[] }

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
  pick: { lat: number; lon: number } | null
  setPick: (p: { lat: number; lon: number } | null) => void
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
  openPlace: (lat: number, lon: number, range?: number) => void
  layers: GlobeLayers
  setLayers: (l: GlobeLayers) => void
}

const RANGE = { world: 1.8e7, region: 3.2e6, city: 9e4, street: 2800 }

export default function MissionControl() {
  const q = new URLSearchParams(location.search)
  const initial = (q.get('mode') as Mode) || 'pulse'
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
  const [frames, setFrames] = useState<{ h: number; t: number; naqi: Record<string, number | null>; level: Record<string, number> }[]>([])
  const [frameIdx, setFrameIdx] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [selectedReport, setSelectedReport] = useState<string | null>(null)
  const [attribution, setAttribution] = useState<Attribution | null>(null)
  const [plume, setPlume] = useState<[number, number, number][][] | null>(null)
  const [pick, setPick] = useState<{ lat: number; lon: number } | null>(null)
  const [pickMode, setPickMode] = useState(false)
  const [place, setPlace] = useState<{ lat: number; lon: number } | null>(() => {
    const la = parseFloat(q.get('lat') ?? ''), lo = parseFloat(q.get('lon') ?? '')
    return Number.isFinite(la) && Number.isFinite(lo) ? { lat: la, lon: lo } : null
  })
  const [fly, setFly] = useState<FlyTarget | null>(null)
  const [theme, setTheme] = useState<Theme>('satellite')
  const [layers, setLayers] = useState<GlobeLayers>({ wind: true, fires: true, cities: true, hotspots: true, reports: true, sensors: true,
    corridors: false, aq: false, photoreal: false, sunlight: true })
  const [layersOpen, setLayersOpen] = useState(false)
  const [fireHelp, setFireHelp] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftFor, setDraftFor] = useState<DraftFor | null>(null)
  const viewReq = useRef(0)

  const setMode = useCallback((m: Mode) => {
    setModeRaw(m)
    const u = new URL(location.href); u.searchParams.set('mode', m)
    if (m !== 'place') { u.searchParams.delete('lat'); u.searchParams.delete('lon') }
    history.replaceState(null, '', u)
  }, [])

  const reloadPulse = useCallback(async () => {
    try {
      const p = await api.pulse(); setPulse(p); setError(null)
      if (p.stale) setTimeout(() => { api.pulse().then((x) => { if (!x.stale) setPulse(x) }).catch(() => {}) }, 20000)
    } catch (e) { setError(`Live data unavailable — ${(e as Error).message}`) }
  }, [])
  const refreshReports = useCallback(async () => { try { setReports((await api.reports()).reports) } catch { /* keep last */ } }, [])
  const refreshAlerts = useCallback(async () => { try { setAlerts((await api.alerts()).alerts) } catch { /* keep last */ } }, [])

  useEffect(() => {
    reloadPulse()
    api.meta().then((m) => { setMeta(m); import('./Globe').then((g) => g.setGoogleKey(m.maps_browser_key)) }).catch(() => {})
    api.wind(0, 'global').then((w) => setWind(w.vectors)).catch(() => {})
    api.fires().then(setFireFeed).catch(() => {})
    api.sensors().then(setSensors).catch(() => {})
    api.timeline().then((t) => setFrames(t.frames)).catch(() => {})
    api.corridors().then((c) => setCorridors(c.corridors)).catch(() => {})
    api.commons().then((c) => ('summary' in c ? setCommons(c) : null)).catch(() => {})
    refreshReports(); refreshAlerts()
    const iv = setInterval(() => { reloadPulse(); refreshReports(); api.sensors().then(setSensors).catch(() => {}) }, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [reloadPulse, refreshReports, refreshAlerts])

  useEffect(() => {
    setHotspots(null)
    api.hotspots(hotScope).then((h) => {
      setHotspots(h)
      if (h.stale) setTimeout(() => api.hotspots(hotScope).then((x) => !x.stale && setHotspots(x)).catch(() => {}), 20000)
    }).catch(() => {})
  }, [hotScope])

  useEffect(() => { if (mode === 'forecast') setLayers((l) => ({ ...l, corridors: true })) }, [mode])
  useEffect(() => {
    if (mode !== 'trace') setAttribution(null)
    if (mode !== 'citizen' && mode !== 'detect' && mode !== 'place') setPlume(null)
    if (mode !== 'citizen') setPickMode(false)
  }, [mode])

  useEffect(() => {
    if (!playing || !frames.length) return
    const iv = setInterval(() => setFrameIdx((i) => { const n = (i ?? frames.findIndex((f) => f.h === 0)) + 1; return n >= frames.length ? 0 : n }), 650)
    return () => clearInterval(iv)
  }, [playing, frames])

  // open the deep-linked place once on load
  useEffect(() => { if (place && mode === 'place') setFly({ lon: place.lon, lat: place.lat, range: RANGE.street, pitch: -40, key: Date.now() }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cities = pulse?.cities ?? []
  const flyTo = useCallback((lon: number, lat: number, range: number, pitch = -45, heading = 0) => setFly({ lon, lat, range, pitch, heading, key: Date.now() }), [])
  const selectCity = useCallback((id: string | null, doFly = true) => {
    setSelectedCity(id)
    const c = cities.find((x) => x.id === id)
    if (c && doFly) setFly({ lon: c.lon, lat: c.lat, range: RANGE.city * 3, pitch: -40, key: Date.now() })
  }, [cities])

  const openPlace = useCallback((lat: number, lon: number, range = RANGE.street) => {
    setPlace({ lat, lon }); setPick({ lat, lon }); setModeRaw('place')
    const u = new URL(location.href); u.searchParams.set('mode', 'place'); u.searchParams.set('lat', lat.toFixed(5)); u.searchParams.set('lon', lon.toFixed(5))
    history.replaceState(null, '', u)
    setFly({ lon, lat, range, pitch: -40, key: Date.now() })
  }, [])

  const onHotspot = useCallback((h: Hotspot) => {
    setMode('detect')
    setFly({ lon: h.lon, lat: h.lat, range: 45000, pitch: -45, key: Date.now() })
    window.dispatchEvent(new CustomEvent('albedo:hotspot', { detail: h }))
  }, [setMode])

  // fetch individual fire detections for the area in view once zoomed in
  const onView = useCallback((bbox: [number, number, number, number] | null, height: number) => {
    if (!bbox || height > 3.5e6) { setFireDets(null); return }
    const id = ++viewReq.current
    api.fires(bbox).then((f) => { if (id === viewReq.current) setFireDets(f) }).catch(() => {})
  }, [])

  const ctx: Ctx = {
    meta, pulse, cities, hotspots, hotScope, setHotScope, reports, alerts, corridors, commons, fireInfo: fireFeed,
    selectedCity, selectCity, setMode, attribution, setAttribution, setPlume, pick, setPick, pickMode, setPickMode, flyTo,
    refreshReports, refreshAlerts, setCommons, reloadPulse, selectedReport, setSelectedReport, onHotspot, draftFor, setDraftFor,
    place, openPlace, layers, setLayers,
  }

  const frame = frameIdx != null ? frames[frameIdx] : null
  const nowIdx = frames.findIndex((f) => f.h === 0)
  const activeMode = mode === 'place' ? { label: 'Place', verb: 'Live at this spot', icon: '⌖' } : MODES.find((m) => m.id === mode)!
  const network = mode === 'commons' && commons ? commons.nodes.map((n) => ({ lat: n.lat, lon: n.lon, name: n.name })) : null
  const frameStats = useMemo(() => {
    if (!frame || !pulse) return null
    let poor = 0, pop = 0
    for (const c of pulse.cities) { const l = frame.level[c.id]; if (l != null && l >= 3) { poor++; pop += c.pop_m } }
    return { poor, pop }
  }, [frame, pulse])

  return (
    <div className="mc">
      <Suspense fallback={<div className="map-loading"><Logo size={120} /></div>}>
        <Globe
          cities={cities} frameLevel={frame?.level ?? null} wind={wind}
          fireBins={fireFeed?.bins ?? []} fireDets={fireDets?.fires ?? null}
          citizen={sensors?.citizen ?? []} stations={sensors?.stations ?? []}
          hotspots={hotspots?.hotspots ?? []} reports={reports} corridors={corridors}
          trajectories={attribution?.paths ?? null} clusters={attribution?.clusters ?? []} plume={plume}
          network={network} selectedCity={selectedCity} selectedReport={selectedReport}
          pick={pick} layers={layers} theme={theme} flyTo={fly}
          onCity={(id) => { selectCity(id, true); if (mode !== 'trace' && mode !== 'command') setMode('pulse') }}
          onHotspot={onHotspot}
          onReport={(id) => { setSelectedReport(id); setMode('citizen') }}
          onPlace={(lat, lon) => { if (pickMode) { setPick({ lat, lon }); setPickMode(false) } else openPlace(lat, lon) }}
          onView={onView}
        />
      </Suspense>
      <div className="vignette" />

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
          <button className="chip chip-btn" onClick={() => setFireHelp(!fireHelp)} title="What is a heat detection?">
            <span className="live-dot" /> Live · {fmt(fireFeed?.count)} heat detections · {cities.length} cities <span className="q">?</span>
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setAskOpen(true)}>✦ Ask Albedo</button>
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

      <aside className={`mc-panel glass ${mode}`} key={mode}>
        <div className="mc-panel-head">
          <div className="eyebrow">{activeMode.icon} {activeMode.label}</div>
          <div className="mc-panel-title display">{activeMode.verb}</div>
        </div>
        <div className="mc-panel-body scroll-y">
          {error && <div className="err">{error} <button className="btn btn-ghost btn-sm" onClick={reloadPulse}>Retry</button></div>}
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

      <div className="mc-legend glass">
        <div className="seg theme-seg" role="group" aria-label="Imagery">
          {([['satellite', 'Satellite'], ['today', 'NASA today'], ['night', 'Night']] as const).map(([k, l]) => (
            <button key={k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{l}</button>
          ))}
        </div>
        <div className="eyebrow" style={{ margin: '10px 0 6px' }}>Air quality · NAQI (India) / US AQI</div>
        <div className="legend-scale">{LEVEL_COLORS.map((c) => <div key={c} style={{ background: c }} />)}</div>
        <div className="legend-lab"><span>Good</span><span>Moderate</span><span>Poor</span><span>Severe</span></div>
        <button className="linkish layers-toggle" onClick={() => setLayersOpen(!layersOpen)}>{layersOpen ? '▾' : '▸'} Layers</button>
        {layersOpen && (
          <div className="layer-toggles">
            {([['wind', 'Wind flow', '#8ce8ff'], ['fires', 'Satellite heat detections', '#ff8a3d'], ['sensors', 'Ground sensors', '#9ccc3a'],
              ['hotspots', 'Hidden hotspots', '#f096ff'], ['reports', 'Citizen reports', '#f1e6c8'], ['corridors', 'Corridors (India)', '#f2c230'],
              ['aq', 'Google live air-quality map', '#6fb6ff'], ['photoreal', 'Photorealistic 3D cities', '#ffffff'], ['sunlight', 'Real sunlight', '#ffe9a8']] as const).map(([k, label, c]) => (
              <label key={k} className="layer-toggle">
                <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                <span className="dot" style={{ background: c, opacity: layers[k] ? 1 : 0.25 }} />{label}
              </label>
            ))}
          </div>
        )}
      </div>

      {frames.length > 0 && (
        <div className="mc-time glass">
          <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play forecast'}>{playing ? '❚❚' : '▶'}</button>
          <div className="time-body">
            <div className="time-row">
              <span className="eyebrow">{frame ? (frame.h === 0 ? 'Now' : frame.h < 0 ? `${-frame.h} h ago` : `Forecast +${frame.h} h`) : 'Now'}</span>
              <span className="mono muted" style={{ fontSize: 12 }}>{frame ? istTime(frame.t) : pulse ? istTime(pulse.generated_at) : ''} IST</span>
              {frameStats && <span className="chip" style={{ marginLeft: 'auto' }}>{frameStats.poor} cities unhealthy+ · {fmt(frameStats.pop, 1)} M people</span>}
              {frame && <button className="btn btn-ghost btn-sm" onClick={() => { setFrameIdx(null); setPlaying(false) }}>Back to now</button>}
            </div>
            <input type="range" min={0} max={frames.length - 1} value={frameIdx ?? nowIdx} onChange={(e) => { setPlaying(false); setFrameIdx(+e.target.value) }} className="time-range" aria-label="Forecast time" />
            <div className="time-ticks mono"><span>−24 h</span><span>now</span><span>+24 h</span><span>+48 h</span><span>+72 h</span></div>
          </div>
        </div>
      )}

      <div className="view-btns">
        <button className="glass" title="Whole Earth" onClick={() => setFly({ lon: 79, lat: 18, range: RANGE.world, pitch: -90, key: Date.now() })}>◍</button>
        <button className="glass" title="India" onClick={() => setFly({ lon: 80, lat: 17, range: 5.2e6, pitch: -75, key: Date.now() })}>IN</button>
      </div>
      {pickMode && <div className="pick-hint glass">Tap the globe where you saw pollution</div>}
      {askOpen && <AskDrawer ctx={ctx} onClose={() => setAskOpen(false)} />}
    </div>
  )
}
