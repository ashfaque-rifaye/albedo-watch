import { useEffect, useRef, useState } from 'react'
import type { LiveEvent } from '../lib/api'
import { ago, fmt } from '../lib/format'
import type { Sensor, Telemetry } from './Globe'
import { LEVEL_COLORS } from './Globe'

/* ============================================================== HUD (God's-eye) */
const SENSORS: { id: Sensor; label: string; hint: string }[] = [
  { id: 'eo', label: 'EO', hint: 'Electro-optical: true colour' },
  { id: 'flir', label: 'FLIR', hint: 'Thermal palette: fires and hot surfaces glow white' },
  { id: 'nvg', label: 'NVG', hint: 'Night-vision green phosphor' },
  { id: 'crt', label: 'CRT', hint: 'Scan-line monitor look' },
]

function dms(v: number | null, pos: string, neg: string) {
  if (v == null) return '—'
  return `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`
}

export function Hud({ tel, sensor, setSensor, feeds, trackLabel, onStopTrack }: {
  tel: Telemetry | null; sensor: Sensor; setSensor: (s: Sensor) => void
  feeds: { name: string; ageS: number | null }[]; trackLabel: string | null; onStopTrack: () => void
}) {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(iv) }, [])
  const alt = tel?.alt ?? 0
  const altTxt = alt > 100_000 ? `${fmt(alt / 1000, 0)} km` : `${fmt(alt, 0)} m`
  return (
    <>
      <div className="hud-frame" aria-hidden><i className="tl" /><i className="tr" /><i className="bl" /><i className="br" /></div>
      <div className="hud-cross" aria-hidden><i /><i /></div>
      <div className="hud-tel mono">
        <div className="hud-rec"><span className="rec-dot" /> ALBEDO-WATCH // LIVE</div>
        <div>TGT {dms(tel?.lat ?? null, 'N', 'S')} {dms(tel?.lon ?? null, 'E', 'W')}</div>
        <div>ALT {altTxt} · HDG {fmt(((tel?.heading ?? 0) + 360) % 360, 0).padStart(3, '0')}° · PITCH {fmt(tel?.pitch ?? 0, 0)}°</div>
        <div>UTC {now.toISOString().slice(11, 19)}Z · {tel?.photoreal ? '3D PHOTOREAL' : 'IMAGERY GLOBE'}</div>
        <div className="hud-feeds">{feeds.map((f) => <span key={f.name} className={f.ageS != null ? 'ok' : 'wait'}>{f.name} {f.ageS != null ? `✓ ${f.ageS < 90 ? 'now' : `${Math.round(f.ageS / 60)}m`}` : '…'}</span>)}</div>
        <div className="hud-sensors" role="group" aria-label="Sensor look">
          {SENSORS.map((s) => <button key={s.id} className={sensor === s.id ? 'on' : ''} title={s.hint} onClick={() => setSensor(s.id)}>{s.label}</button>)}
        </div>
        {trackLabel && <div className="hud-track">TRACKING {trackLabel.toUpperCase()} <button onClick={onStopTrack}>release</button></div>}
      </div>
    </>
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
