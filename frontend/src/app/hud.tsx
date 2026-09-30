import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { LiveEvent } from '../lib/api'
import { ago, fmt } from '../lib/format'
import type { Lens } from './Globe'
import { LEVEL_COLORS, telemetry } from './Globe'

/* ============================================================== HUD (God's-eye) */
// Lenses swap in real satellite products — each has a legend and a date. (They replace the
// earlier FLIR/NVG/CRT colour filters, which changed the look but carried no data.)
export const LENSES: { id: Lens; label: string; hint: string; legend?: { title: string; stops: string[]; ticks: string[]; src: string } }[] = [
  { id: 'true', label: 'TRUE', hint: 'True colour: the planet as a camera sees it' },
  { id: 'heat', label: 'HEAT', hint: 'Land-surface temperature from NASA MODIS (yesterday): hot cities, bare ground and fire scars',
    legend: { title: 'Land-surface temperature', stops: ['#3100ff', '#0094ff', '#49ff56', '#deff00', '#ff8000', '#ff0100'], ticks: ['−50', '−3', '21', '50', '≥77 °C'], src: 'NASA MODIS Terra · daily · 1 km' } },
  { id: 'haze', label: 'HAZE', hint: 'Aerosol optical depth from NASA MODIS: how much smoke, dust and haze the sunlight passes through',
    legend: { title: 'Aerosol optical depth (haze)', stops: ['#fffdcd', '#ffc94c', '#ff671c', '#d7090b', '#7d000e'], ticks: ['0 clear', '0.2', '0.4', '0.6', '≥1 thick'], src: 'NASA MODIS Aqua+Terra · daily · 2–3 days behind' } },
  { id: 'today', label: 'TODAY', hint: "Yesterday's NASA VIIRS true-colour pass: smoke plumes, dust and haze as the satellite saw them" },
  { id: 'night', label: 'NIGHT', hint: 'Night lights (NASA Black Marble): where people, roads and industry are',
    legend: { title: 'Night lights', stops: ['#000000', '#1c2238', '#8a6d2f', '#ffd98a', '#ffffff'], ticks: ['dark', '', '', '', 'brightest'], src: 'NASA VIIRS Black Marble composite' } },
]

function dms(v: number | null, pos: string, neg: string) {
  if (v == null) return '—'
  return `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`
}

function Telemetry() {
  const tel = useSyncExternalStore(telemetry.subscribe, telemetry.get)
  const [now, setNow] = useState(new Date())
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(iv) }, [])
  const alt = tel?.alt ?? 0
  const altTxt = alt > 100_000 ? `${fmt(alt / 1000, 0)} km` : `${fmt(alt, 0)} m`
  return (<>
    <div>TGT {dms(tel?.lat ?? null, 'N', 'S')} {dms(tel?.lon ?? null, 'E', 'W')}</div>
    <div>ALT {altTxt} · HDG {fmt(((tel?.heading ?? 0) + 360) % 360, 0).padStart(3, '0')}° · PITCH {fmt(tel?.pitch ?? 0, 0)}°</div>
    <div>UTC {now.toISOString().slice(11, 19)}Z · {tel?.photoreal ? 'GOOGLE 3D' : 'SATELLITE GLOBE'} · {tel?.fps ?? '—'} FPS</div>
  </>)
}

export function Hud({ lens, setLens, feeds, trackLabel, onStopTrack }: {
  lens: Lens; setLens: (s: Lens) => void
  feeds: { name: string; ageS: number | null }[]; trackLabel: string | null; onStopTrack: () => void
}) {
  const L = LENSES.find((x) => x.id === lens)
  return (
    <>
      <div className="hud-frame" aria-hidden><i className="tl" /><i className="tr" /><i className="bl" /><i className="br" /></div>
      <div className="hud-cross" aria-hidden><i /><i /></div>
      <div className="hud-tel mono">
        <div className="hud-rec"><span className="rec-dot" /> ALBEDO-WATCH // LIVE</div>
        <Telemetry />
        <div className="hud-feeds">{feeds.map((f) => <span key={f.name} className={f.ageS != null ? 'ok' : 'wait'}>{f.name} {f.ageS != null ? `✓ ${f.ageS < 90 ? 'now' : `${Math.round(f.ageS / 60)}m`}` : '…'}</span>)}</div>
        <div className="hud-lenses" role="group" aria-label="Satellite lens">
          <span className="hud-k">LENS</span>
          {LENSES.map((s) => <button key={s.id} className={lens === s.id ? 'on' : ''} title={s.hint} onClick={() => setLens(s.id)}>{s.label}</button>)}
        </div>
        {L?.legend && (
          <div className="lens-legend">
            <div className="lens-t">{L.legend.title}</div>
            <div className="lens-bar" style={{ background: `linear-gradient(90deg, ${L.legend.stops.join(',')})` }} />
            <div className="lens-ticks">{L.legend.ticks.map((t, i) => <span key={i}>{t}</span>)}</div>
            <div className="lens-src">{L.legend.src}</div>
          </div>
        )}
        {trackLabel && <div className="hud-track">TRACKING {trackLabel.toUpperCase()} <button onClick={onStopTrack}>release</button></div>}
      </div>
    </>
  )
}

/* ============================================================== Onboarding */
type CoachStep = { sel: string | null; title: string; text: React.ReactNode }
export const COACH_STEPS: CoachStep[] = [
  { sel: null, title: 'Earth\'s air, live', text: <>Every mark on this globe is live data: air quality for 230 cities, NASA fire detections, 9,000+ citizen sensors and today's winds. <b>Drag</b> to spin, <b>scroll or pinch</b> to zoom, and <b>click anywhere</b> to see the air at that exact spot.</> },
  { sel: '.mc-modes', title: 'Eight tools', text: <><b>Pulse</b>: air now, worldwide and near you · <b>Detect</b>: pollution no official monitor is watching · <b>Trace</b>: where a city's smoke comes from, and what cutting it is worth · <b>Citizen</b>: report with a photo or voice note · <b>Forecast</b>: the next 72 h · <b>Protect</b>: schools and hospitals in the smoke · <b>Command</b>: draft official orders in local languages · <b>Accuracy</b>: how the forecasts learn from local sensors.</> },
  { sel: '.country-select', title: 'Your country', text: 'Filter every list, alert and live event to one country, or keep the whole world.' },
  { sel: '.view-btns', title: 'Your hub & shortcuts', text: <><b>⌖</b> finds your location and makes it your home hub, with your personal air plan and alerts · <b>◷</b> replays the 72-hour forecast · <b>▶</b> takes a guided flight · <b>◉</b> turns live picture reports on or off · <b>?</b> shows this tour again.</> },
  { sel: '.hud-lenses', title: 'Satellite lenses', text: 'Swap in real NASA layers: HEAT (land-surface temperature), HAZE (aerosol from space), TODAY (the latest satellite pass) and NIGHT (city lights). TRUE returns to normal colour.' },
  { sel: '.mc-legend', title: 'Legend & layers', text: 'What every symbol means, plus switches for each data layer and the imagery style.' },
  { sel: '.ask-btn', title: 'Albedo Copilot', text: 'A Gemini agent that works the app for you, in any language: "Which schools in Delhi should keep children indoors tomorrow? Draft a notice in Hindi." It queries the live data, moves the map and prepares the order for an officer to approve.' },
]

export function Coach({ onDone }: { onDone: () => void }) {
  const steps = COACH_STEPS.filter((s) => !s.sel || document.querySelector(s.sel))
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const st = steps[Math.min(i, steps.length - 1)]
  useLayoutEffect(() => {
    const el = st.sel ? document.querySelector(st.sel) : null
    setRect(el ? el.getBoundingClientRect() : null)
  }, [st])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(); if (e.key === 'ArrowRight' || e.key === 'Enter') next() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  const next = () => (i + 1 >= steps.length ? onDone() : setI(i + 1))
  const W = Math.min(380, window.innerWidth - 32)
  let pos: React.CSSProperties = { left: (window.innerWidth - W) / 2, top: window.innerHeight * 0.3, width: W }
  if (rect) {
    const below = rect.bottom + 14 + 220 < window.innerHeight
    pos = { width: W, left: Math.max(16, Math.min(window.innerWidth - W - 16, rect.left + rect.width / 2 - W / 2)),
      top: below ? rect.bottom + 14 : Math.max(16, rect.top - 14 - (card.current?.offsetHeight ?? 200)) }
  }
  return (
    <div className="coach" role="dialog" aria-label="Quick tour">
      {rect ? <div className="coach-spot" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} /> : <div className="coach-dim" />}
      <div className="coach-card glass fade-up" style={pos} ref={card} key={i}>
        <div className="mono coach-k">QUICK TOUR · {i + 1}/{steps.length}</div>
        <div className="display coach-t">{st.title}</div>
        <p>{st.text}</p>
        <div className="coach-row">
          <button className="btn btn-ghost btn-sm" onClick={onDone}>Skip</button>
          <div className="coach-dots">{steps.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
          <button className="btn btn-primary btn-sm" onClick={next}>{i + 1 >= steps.length ? 'Start exploring' : 'Next →'}</button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================== Legend */
export function Legend({ onClose, compact }: { onClose?: () => void; compact?: boolean }) {
  return (
    <div className={`legend-body ${compact ? 'compact' : ''}`}>
      {onClose && <div className="sec-h"><h3>What you are looking at</h3><button className="x" onClick={onClose} aria-label="Close">×</button></div>}
      <div className="lg-row"><span className="lg-ic"><svg width="22" height="22"><circle cx="11" cy="11" r="6" fill="#f2c230" stroke="#05070b" strokeWidth="1.5" /></svg></span>
        <div><b>City air quality</b><span>colour = category · the tag shows the index: NAQI in India, US AQI elsewhere</span>
          <div className="lg-scale">{LEVEL_COLORS.map((c, i) => <i key={c} style={{ background: c }} title={['Good', 'Satisfactory / Moderate', 'Moderate / Sensitive', 'Poor / Unhealthy', 'Very poor', 'Severe / Hazardous'][i]} />)}</div>
          <div className="lg-scale-lab"><span>Good</span><span>Moderate</span><span>Unhealthy</span><span>Severe</span></div></div></div>
      <div className="lg-row"><span className="lg-ic"><svg width="22" height="22"><circle cx="11" cy="11" r="8" fill="none" stroke="#f08a24" strokeWidth="1.6" /><circle cx="11" cy="11" r="4" fill="#f08a24" /></svg></span>
        <div><b>Pulsing ring</b><span>city forecast to reach unhealthy air within 72 h</span></div></div>
      <div className="lg-row"><span className="lg-ic"><svg width="22" height="22"><circle cx="6" cy="14" r="2" fill="#ffd27a" /><circle cx="12" cy="8" r="3" fill="#ffa04a" /><circle cx="17" cy="15" r="4" fill="#ff4a26" /></svg></span>
        <div><b>NASA heat detection</b><span>satellite-seen fire or hot spot, last 24 h · size and colour = intensity (yellow &lt; 5 MW, orange 5–20, red &gt; 20)</span></div></div>
      <div className="lg-row"><span className="lg-ic"><svg width="22" height="22"><circle cx="11" cy="11" r="9" fill="#14061a" stroke="#f096ff" strokeWidth="2" /><text x="11" y="15" fontSize="11" textAnchor="middle" fill="#fff" fontWeight="700">1</text></svg></span>
        <div><b>Hidden hotspot (ranked)</b><span>pollution evidence where no official monitor is nearby</span></div></div>
      <div className="lg-row"><span className="lg-ic"><svg width="22" height="22"><circle cx="11" cy="11" r="7" fill="#f1e6c8" stroke="#05070b" strokeWidth="2" /><text x="11" y="15" fontSize="9" textAnchor="middle" fill="#05070b">✦</text></svg></span>
        <div><b>Citizen report</b><span>solid = verified by Gemini + satellites; faded = pending</span></div></div>
      <div className="lg-row"><span className="lg-ic"><svg width="22" height="22"><circle cx="7" cy="11" r="2.5" fill="#9ccc3a" /><circle cx="15" cy="11" r="3.5" fill="#f2c230" stroke="#fff" strokeWidth="1.3" /></svg></span>
        <div><b>Ground sensors</b><span>small = open citizen sensor (low-cost) · white ring = official station · colour = PM2.5</span></div></div>
      <div className="lg-row"><span className="lg-ic"><svg width="22" height="22"><path d="M3 15 Q9 7 19 9" stroke="#8ce8ff" strokeWidth="1.6" fill="none" /></svg></span>
        <div><b>Wind flow</b><span>today's 10 m winds carrying smoke</span></div></div>
      <div className="lg-row"><span className="lg-ic"><svg width="22" height="22"><path d="M3 17 Q10 3 19 11" stroke="#ffb35c" strokeWidth="2.5" fill="none" opacity=".8" /></svg></span>
        <div><b>Smoke paths</b><span>amber = air arriving at a city (Trace) · cream = where a reported plume goes next</span></div></div>
      <div className="lg-row"><span className="lg-ic"><svg width="22" height="22"><circle cx="11" cy="11" r="6" fill="#6fe3ff" stroke="#04121a" strokeWidth="2" /></svg></span>
        <div><b>Your hub</b><span>the locality you chose or located</span></div></div>
    </div>
  )
}

/* ============================================================== Live event feed */
const ICON: Record<LiveEvent['kind'], string> = { spike: '▲', fire: '●', report: '✦', alert: '■', feed: '↻' }

export function EventFeed({ events, onPick, mobile }: { events: LiveEvent[]; onPick: (e: LiveEvent) => void; mobile?: boolean }) {
  const [i, setI] = useState(0)
  const track = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!mobile || events.length < 2) return
    const iv = setInterval(() => setI((x) => (x + 1) % events.length), 5000)
    return () => clearInterval(iv)
  }, [mobile, events.length])
  if (!events.length) return null
  if (mobile) {
    const e = events[i % events.length]
    return (
      <button className={`feed-one glass k-${e.kind} s${e.severity}`} onClick={() => onPick(e)} key={e.id}>
        <span className="feed-ic">{ICON[e.kind]}</span><span className="feed-t">{e.title}</span><span className="feed-live">LIVE</span>
      </button>
    )
  }
  const list = [...events, ...events]
  return (
    <div className="feed glass" aria-label="Live events">
      <span className="feed-label mono"><span className="live-dot" /> LIVE</span>
      <div className="feed-view">
        <div className="feed-track" ref={track} style={{ animationDuration: `${Math.max(40, events.length * 6)}s` }}>
          {list.map((e, k) => (
            <button key={`${e.id}-${k}`} className={`feed-item k-${e.kind} s${e.severity}`} onClick={() => onPick(e)} title={e.sub}>
              <span className="feed-ic">{ICON[e.kind]}</span>
              <span className="feed-t">{e.title}</span>
              <span className="feed-s">{e.sub}{e.kind !== 'spike' && e.kind !== 'feed' ? ` · ${ago(e.t)}` : ''}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ============================================================== Tour caption */
export function TourCaption({ step, total, title, text, onStop }: { step: number; total: number; title: string; text: string; onStop: () => void }) {
  return (
    <div className="tour-cap fade-up" key={step}>
      <div className="mono tour-k">GUIDED FLIGHT · {step + 1}/{total}</div>
      <div className="display tour-t">{title}</div>
      <p>{text}</p>
      <button className="btn btn-ghost btn-sm" onClick={onStop}>End tour</button>
    </div>
  )
}
