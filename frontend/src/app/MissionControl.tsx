import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { Alert, Attribution, City, Commons, Corridor, Fire, Hotspot, Hotspots, Meta, Pulse, Report, WindVec } from '../lib/api'
import { api } from '../lib/api'
import { NAQI_BANDS, fmt, istTime } from '../lib/format'
import { Logo } from '../components/Logo'
import type { Layers } from './MapView'
import { AskDrawer, CitizenPanel, CommandPanel, CommonsPanel, DetectPanel, ForecastPanel, PulsePanel, TracePanel } from './panels'
import './app.css'

const MapView = lazy(() => import('./MapView'))

export type Mode = 'pulse' | 'detect' | 'trace' | 'citizen' | 'forecast' | 'command' | 'commons'
const MODES: { id: Mode; label: string; verb: string; icon: string }[] = [
  { id: 'pulse', label: 'Pulse', verb: 'National air, live', icon: '◉' },
  { id: 'detect', label: 'Detect', verb: 'Hidden hotspots', icon: '◎' },
  { id: 'trace', label: 'Trace', verb: 'Source attribution', icon: '↶' },
  { id: 'citizen', label: 'Citizen', verb: 'Report in any language', icon: '✦' },
  { id: 'forecast', label: 'Forecast', verb: '72 h corridors', icon: '◷' },
  { id: 'command', label: 'Command', verb: 'Alerts & action', icon: '▲' },
  { id: 'commons', label: 'Commons', verb: 'Federated models', icon: '⬡' },
]

export type Ctx = {
  meta: Meta | null
  pulse: Pulse | null
  cities: City[]
  hotspots: Hotspots | null
  reports: Report[]
  alerts: Alert[]
  corridors: Corridor[]
  commons: Commons | null
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
  flyTo: (lon: number, lat: number, zoom: number, pitch?: number) => void
  refreshReports: () => Promise<void>
  refreshAlerts: () => Promise<void>
  setCommons: (c: Commons) => void
  reloadPulse: () => Promise<void>
  selectedReport: string | null
  setSelectedReport: (id: string | null) => void
  onHotspot: (h: Hotspot) => void
  draftFor: { kind: 'city' | 'hotspot' | 'report'; city?: string; report_id?: string; lat?: number; lon?: number } | null
  setDraftFor: (d: Ctx['draftFor']) => void
}

export default function MissionControl() {
  const initial = (new URLSearchParams(location.search).get('mode') as Mode) || 'pulse'
  const [mode, setModeRaw] = useState<Mode>(MODES.some((m) => m.id === initial) ? initial : 'pulse')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [pulse, setPulse] = useState<Pulse | null>(null)
  const [wind, setWind] = useState<WindVec[]>([])
  const [fires, setFires] = useState<Fire[]>([])
  const [fireCount, setFireCount] = useState(0)
  const [hotspots, setHotspots] = useState<Hotspots | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [corridors, setCorridors] = useState<Corridor[]>([])
  const [commons, setCommons] = useState<Commons | null>(null)
  const [frames, setFrames] = useState<{ h: number; t: number; naqi: Record<string, number | null> }[]>([])
  const [frameIdx, setFrameIdx] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [selectedReport, setSelectedReport] = useState<string | null>(null)
  const [attribution, setAttribution] = useState<Attribution | null>(null)
  const [plume, setPlume] = useState<[number, number, number][][] | null>(null)
  const [pick, setPick] = useState<{ lat: number; lon: number } | null>(null)
  const [pickMode, setPickMode] = useState(false)
  const [fly, setFly] = useState<{ lon: number; lat: number; zoom: number; pitch?: number } | null>(null)
  const [layers, setLayers] = useState<Layers>({ wind: true, fires: true, cities: true, hotspots: true, reports: true, corridors: false })
  const [askOpen, setAskOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftFor, setDraftFor] = useState<Ctx['draftFor']>(null)

  const setMode = useCallback((m: Mode) => {
    setModeRaw(m)
    const u = new URL(location.href); u.searchParams.set('mode', m); history.replaceState(null, '', u)
  }, [])

  const reloadPulse = useCallback(async () => {
    try { setPulse(await api.pulse()); setError(null) } catch (e) { setError(`Live data unavailable — ${(e as Error).message}`) }
  }, [])
  const refreshReports = useCallback(async () => { try { setReports((await api.reports()).reports) } catch { /* keep last */ } }, [])
  const refreshAlerts = useCallback(async () => { try { setAlerts((await api.alerts()).alerts) } catch { /* keep last */ } }, [])

  useEffect(() => {
    reloadPulse()
    api.meta().then(setMeta).catch(() => {})
    api.wind().then((w) => setWind(w.vectors)).catch(() => {})
    api.fires().then((f) => { setFires(f.fires); setFireCount(f.count) }).catch(() => {})
    api.timeline().then((t) => setFrames(t.frames)).catch(() => {})
    api.corridors().then((c) => setCorridors(c.corridors)).catch(() => {})
    api.hotspots().then(setHotspots).catch(() => {})
    api.commons().then((c) => ('summary' in c ? setCommons(c) : null)).catch(() => {})
    refreshReports(); refreshAlerts()
    const iv = setInterval(() => { reloadPulse(); refreshReports() }, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [reloadPulse, refreshReports, refreshAlerts])

  useEffect(() => { if (mode === 'forecast') setLayers((l) => ({ ...l, corridors: true })) }, [mode])
  useEffect(() => { if (mode !== 'trace') setAttribution(null); if (mode !== 'citizen' && mode !== 'detect') setPlume(null); if (mode !== 'citizen') { setPickMode(false) } }, [mode])

  useEffect(() => {
    if (!playing || !frames.length) return
    const iv = setInterval(() => setFrameIdx((i) => { const n = (i ?? frames.findIndex((f) => f.h === 0)) + 1; return n >= frames.length ? 0 : n }), 650)
    return () => clearInterval(iv)
  }, [playing, frames])

  const cities = pulse?.cities ?? []
  const flyTo = useCallback((lon: number, lat: number, zoom: number, pitch?: number) => setFly({ lon, lat, zoom, pitch }), [])
  const selectCity = useCallback((id: string | null, doFly = true) => {
    setSelectedCity(id)
    const c = cities.find((x) => x.id === id)
    if (c && doFly) setFly({ lon: c.lon, lat: c.lat - 0.6, zoom: 6, pitch: 45 })
  }, [cities])

  const onHotspot = useCallback((h: Hotspot) => {
    setMode('detect')
    setFly({ lon: h.lon, lat: h.lat, zoom: 7.2, pitch: 50 })
    window.dispatchEvent(new CustomEvent('albedo:hotspot', { detail: h }))
  }, [setMode])

  const ctx: Ctx = {
    meta, pulse, cities, hotspots, reports, alerts, corridors, commons, selectedCity, selectCity, setMode,
    attribution, setAttribution, setPlume, pick, setPick, pickMode, setPickMode, flyTo, refreshReports, refreshAlerts,
    setCommons, reloadPulse, selectedReport, setSelectedReport, onHotspot, draftFor, setDraftFor,
  }

  const frame = frameIdx != null ? frames[frameIdx] : null
  const nowIdx = frames.findIndex((f) => f.h === 0)
  const activeMode = MODES.find((m) => m.id === mode)!
  const network = mode === 'commons' && commons ? commons.nodes.map((n) => ({ lat: n.lat, lon: n.lon, name: n.name })) : null

  const frameStats = useMemo(() => {
    if (!frame || !pulse) return null
    let poor = 0, pop = 0
    for (const c of pulse.cities) { const v = frame.naqi[c.id]; if (v != null && v > 200) { poor++; pop += c.pop_m } }
    return { poor, pop }
  }, [frame, pulse])

  return (
    <div className="mc">
      <Suspense fallback={<div className="map-loading"><div className="orb" /></div>}>
        <MapView
          cities={cities} frameNaqi={frame?.naqi ?? null} wind={wind} fires={fires}
          hotspots={hotspots?.hotspots ?? []} reports={reports} corridors={corridors}
          trajectories={attribution?.paths ?? null} clusters={attribution?.clusters ?? []} plume={plume}
          network={network}
          selectedCity={selectedCity} selectedReport={selectedReport} pickMode={pickMode} pick={pick}
          layers={layers} flyTo={fly}
          onCity={(id) => { selectCity(id, false); if (mode !== 'trace' && mode !== 'command') setMode('pulse') }}
          onHotspot={onHotspot}
          onReport={(id) => { setSelectedReport(id); setMode('citizen') }}
          onPick={(lat, lon) => { setPick({ lat, lon }); setPickMode(false) }}
        />
      </Suspense>
      <div className="vignette" />

      {/* top bar */}
      <header className="mc-top">
        <a href="/" className="mc-brand" aria-label="Albedo-Watch home"><Logo size={26} /><span>Albedo<span className="muted">-</span>Watch</span></a>
        <nav className="mc-modes glass" aria-label="Modes">
          {MODES.map((m) => (
            <button key={m.id} className={`mc-mode ${m.id === mode ? 'on' : ''}`} onClick={() => setMode(m.id)} title={m.verb}>
              <span className="mc-mode-ic">{m.icon}</span>{m.label}
            </button>
          ))}
        </nav>
        <div className="mc-status">
          <span className="chip"><span className="live-dot" /> Live · {fmt(fireCount)} fires · {cities.length} cities</span>
          <button className="btn btn-primary btn-sm" onClick={() => setAskOpen(true)}>✦ Ask Albedo</button>
        </div>
      </header>

      {/* panel */}
      <aside className="mc-panel glass fade-up" key={mode}>
        <div className="mc-panel-head">
          <div className="eyebrow">{activeMode.icon} {activeMode.label}</div>
          <div className="mc-panel-title display">{activeMode.verb}</div>
        </div>
        <div className="mc-panel-body scroll-y">
          {error && <div className="err">{error} <button className="btn btn-ghost btn-sm" onClick={reloadPulse}>Retry</button></div>}
          {mode === 'pulse' && <PulsePanel ctx={ctx} />}
          {mode === 'detect' && <DetectPanel ctx={ctx} />}
          {mode === 'trace' && <TracePanel ctx={ctx} />}
          {mode === 'citizen' && <CitizenPanel ctx={ctx} />}
          {mode === 'forecast' && <ForecastPanel ctx={ctx} />}
          {mode === 'command' && <CommandPanel ctx={ctx} />}
          {mode === 'commons' && <CommonsPanel ctx={ctx} />}
        </div>
      </aside>

      {/* layers + legend */}
      <div className="mc-legend glass">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Indian NAQI</div>
        <div className="legend-scale">{NAQI_BANDS.map((b) => <div key={b.label} title={b.label} style={{ background: b.color }} />)}</div>
        <div className="legend-lab mono"><span>0</span><span>100</span><span>200</span><span>300</span><span>400</span><span>500</span></div>
        <div className="layer-toggles">
          {([['wind', 'Wind', '#6fe3ff'], ['fires', 'Satellite fires', '#ff6a2b'], ['hotspots', 'Blind spots', '#f096ff'], ['reports', 'Citizen reports', '#f1e6c8'], ['corridors', 'Corridors', '#f2c230']] as const).map(([k, label, c]) => (
            <label key={k} className="layer-toggle">
              <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
              <span className="dot" style={{ background: c, opacity: layers[k] ? 1 : 0.3 }} />{label}
            </label>
          ))}
        </div>
      </div>

      {/* time machine */}
      {frames.length > 0 && (
        <div className="mc-time glass">
          <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play forecast'}>{playing ? '❚❚' : '▶'}</button>
          <div className="time-body">
            <div className="time-row">
              <span className="eyebrow">{frame ? (frame.h === 0 ? 'Now' : frame.h < 0 ? `${-frame.h} h ago` : `Forecast +${frame.h} h`) : 'Now'}</span>
              <span className="mono muted" style={{ fontSize: 12 }}>{frame ? istTime(frame.t) : pulse ? istTime(pulse.generated_at) : ''} IST</span>
              {frameStats && <span className="chip" style={{ marginLeft: 'auto' }}>{frameStats.poor} cities Poor+ · {fmt(frameStats.pop, 1)} M people</span>}
              {frame && <button className="btn btn-ghost btn-sm" onClick={() => { setFrameIdx(null); setPlaying(false) }}>Back to now</button>}
            </div>
            <input type="range" min={0} max={frames.length - 1} value={frameIdx ?? nowIdx} onChange={(e) => { setPlaying(false); setFrameIdx(+e.target.value) }} className="time-range"
              style={{ ['--now' as string]: `${(nowIdx / (frames.length - 1)) * 100}%` }} aria-label="Forecast time" />
            <div className="time-ticks mono"><span>−24 h</span><span>now</span><span>+24 h</span><span>+48 h</span><span>+72 h</span></div>
          </div>
        </div>
      )}

      {pickMode && <div className="pick-hint glass">Tap the map where you saw pollution</div>}
      {askOpen && <AskDrawer ctx={ctx} onClose={() => setAskOpen(false)} />}
    </div>
  )
}
