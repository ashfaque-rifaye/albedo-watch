import { useEffect, useMemo, useRef, useState } from 'react'
import type { Alert, City, Hotspot, Report, SimResult } from '../lib/api'
import { api } from '../lib/api'
import { LANG_NAMES, ago, fmt, istTime, mdLite, naqiColor, naqiLabel } from '../lib/format'
import { ForecastChart, HBars, RoundsChart, SourceBar } from './charts'
import type { Ctx } from './MissionControl'

/* ================================================================ shared */
function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-v display" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="stat-l">{label}</div>
    </div>
  )
}

function NaqiBadge({ v, big }: { v: number | null; big?: boolean }) {
  return (
    <span className={`naqi-badge ${big ? 'big' : ''}`} style={{ ['--c' as string]: naqiColor(v) }}>
      <b className="mono">{v ?? '—'}</b><span>{naqiLabel(v)}</span>
    </span>
  )
}

function Loading({ lines = 3, label }: { lines?: number; label?: string }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {label && <div className="muted" style={{ fontSize: 12 }}>{label}</div>}
      {Array.from({ length: lines }).map((_, i) => <div key={i} className="skeleton" style={{ height: 18, width: `${90 - i * 12}%` }} />)}
    </div>
  )
}

function AiTag({ model, ms }: { model?: string | null; ms?: number }) {
  if (!model) return null
  return <span className="ai-tag">✦ {model}{ms ? ` · ${(ms / 1000).toFixed(1)} s` : ''}</span>
}

function useSteps(active: boolean, steps: string[], every = 1600) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!active) { setI(0); return }
    const iv = setInterval(() => setI((x) => Math.min(steps.length - 1, x + 1)), every)
    return () => clearInterval(iv)
  }, [active, steps.length, every])
  return i
}

function StepList({ steps, at }: { steps: string[]; at: number }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''}>{s}</li>)}
    </ol>
  )
}

function CityPicker({ ctx, value, onChange }: { ctx: Ctx; value: string | null; onChange: (id: string) => void }) {
  const byState = useMemo(() => {
    const m = new Map<string, City[]>()
    for (const c of [...ctx.cities].sort((a, b) => a.name.localeCompare(b.name))) m.set(c.state_name, [...(m.get(c.state_name) ?? []), c])
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [ctx.cities])
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>Choose a city…</option>
      {byState.map(([st, cs]) => <optgroup key={st} label={st}>{cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
    </select>
  )
}

/* ================================================================ PULSE */
export function PulsePanel({ ctx }: { ctx: Ctx }) {
  const p = ctx.pulse
  const city = ctx.cities.find((c) => c.id === ctx.selectedCity)
  if (!p) return <Loading lines={6} label="Pulling CAMS forecasts, winds and satellite fires for 53 cities…" />
  if (city) return <CityCard ctx={ctx} city={city} />
  const s = p.summary
  const spikes = p.cities.filter((c) => c.spike).sort((a, b) => b.spike!.peak - a.spike!.peak)
  return (
    <div className="stack">
      <div className="stats-2">
        <Stat value={`${fmt(s.pop_spike_m, 0)}M`} label="people in cities with a forecast spike (72 h)" tone="#f08a24" />
        <Stat value={`${s.spikes_72h}`} label={`of ${s.cities} cities heading to Poor or worse`} />
        <Stat value={`${s.states}`} label="states & UTs, one network" />
        <Stat value={`${s.national_median ?? '—'}`} label="national median NAQI now" tone={naqiColor(s.national_median)} />
      </div>
      {p.model && (
        <div className="callout">
          <span className="eyebrow" style={{ color: 'var(--albedo)' }}>⬡ Model Commons active</span>
          <div>Every forecast here is bias-corrected by a model 21 states trained <b>without sharing raw data</b> — error down <b>{p.model.improvement_pct}%</b> vs the global model.</div>
        </div>
      )}
      <section>
        <div className="sec-h"><h3>Spike warnings</h3><span className="muted">sorted by peak</span></div>
        <div className="list">
          {spikes.slice(0, 12).map((c) => (
            <button key={c.id} className="row" onClick={() => ctx.selectCity(c.id)}>
              <span className="dot" style={{ background: naqiColor(c.spike!.peak) }} />
              <div className="row-main">
                <div className="row-t">{c.name} <span className="muted">· {c.state_name}</span></div>
                <div className="row-s">{c.spike!.category} in ~{c.spike!.lead_hours} h · {c.spike!.grap.name}</div>
              </div>
              <span className="mono row-v" style={{ color: naqiColor(c.spike!.peak) }}>{c.spike!.peak}</span>
            </button>
          ))}
          {!spikes.length && <div className="muted">No spikes forecast in the next 72 h.</div>}
        </div>
      </section>
      <section>
        <div className="sec-h"><h3>Worst air right now</h3></div>
        <div className="list">
          {[...p.cities].filter((c) => c.naqi != null).sort((a, b) => b.naqi! - a.naqi!).slice(0, 6).map((c) => (
            <button key={c.id} className="row" onClick={() => ctx.selectCity(c.id)}>
              <span className="dot" style={{ background: naqiColor(c.naqi) }} />
              <div className="row-main"><div className="row-t">{c.name}</div><div className="row-s">{c.dominant ?? 'PM'} · {c.stations} official monitor{c.stations === 1 ? '' : 's'} (approx.)</div></div>
              <span className="mono row-v" style={{ color: naqiColor(c.naqi) }}>{c.naqi}</span>
            </button>
          ))}
        </div>
      </section>
      <p className="fine">NAQI computed from CPCB breakpoints on bias-corrected CAMS PM2.5/PM10 + NO₂/SO₂. O₃/CO shown separately (uncorrected). Forecasts are model estimates, not official CPCB bulletins.</p>
    </div>
  )
}

function CityCard({ ctx, city }: { ctx: Ctx; city: City }) {
  const [detail, setDetail] = useState<City | null>(null)
  useEffect(() => { setDetail(null); api.city(city.id).then(setDetail).catch(() => {}) }, [city.id])
  return (
    <div className="stack">
      <button className="back" onClick={() => ctx.selectCity(null, false)}>← All India</button>
      <div className="city-hero">
        <div>
          <div className="display" style={{ fontSize: 34 }}>{city.name}</div>
          <div className="muted">{city.local_name !== city.name ? `${city.local_name} · ` : ''}{city.state_name} · {fmt(city.pop_m, 1)} M people</div>
        </div>
        <NaqiBadge v={city.naqi} big />
      </div>
      {city.spike ? (
        <div className="callout warn">
          <b>{city.spike.category} expected in ~{city.spike.lead_hours} h</b> — peak NAQI {city.spike.peak} around {istTime(city.spike.peak_time)}. Triggers <b>{city.spike.grap.name}</b>.
        </div>
      ) : <div className="callout">No category jump forecast in the next 72 h. Peak NAQI {city.peak72 ?? '—'}.</div>}
      <section>
        <div className="sec-h"><h3>NAQI · past 24 h → next 72 h</h3></div>
        {detail?.series ? <ForecastChart s={detail.series} /> : <div className="skeleton" style={{ height: 170 }} />}
      </section>
      <div className="kv-grid">
        <div><span>PM2.5 (corrected)</span><b className="mono">{fmt(city.pm25, 0)} µg/m³</b></div>
        <div><span>Global model said</span><b className="mono">{fmt(city.pm25_cams, 0)} µg/m³</b></div>
        <div><span>Wind</span><b className="mono">{fmt(city.wind.speed, 0)} km/h from {fmt(city.wind.dir, 0)}°</b></div>
        <div><span>Daytime stagnation (48 h)</span><b className="mono">{city.stagnant_hours_48} h</b></div>
        <div><span>Correction</span><b>{city.correction === 'personalised' ? 'State-personalised' : city.correction === 'federated-global' ? 'Federated (no local data)' : 'Raw'}</b></div>
        <div><span>Responsible authority</span><b>{city.authority.primary_short}</b></div>
      </div>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => ctx.setMode('trace')}>↶ Trace the sources</button>
        <button className="btn btn-ghost" onClick={() => { ctx.setDraftFor({ kind: 'city', city: city.id }); ctx.setMode('command') }}>▲ Draft alert</button>
      </div>
      {city.category.health && <p className="fine">Health: {city.category.health}</p>}
    </div>
  )
}

/* ================================================================ DETECT */
export function DetectPanel({ ctx }: { ctx: Ctx }) {
  const hs = ctx.hotspots
  const [sel, setSel] = useState<Hotspot | null>(null)
  useEffect(() => {
    const on = (e: Event) => setSel((e as CustomEvent<Hotspot>).detail)
    window.addEventListener('albedo:hotspot', on)
    return () => window.removeEventListener('albedo:hotspot', on)
  }, [])
  if (!hs) return <Loading lines={6} label="Scanning 0.5° cells for fires & reports with no monitor nearby…" />
  return (
    <div className="stack">
      <div className="stats-2">
        <Stat value={`${Math.round(hs.unmonitored_share * 100)}%`} label="of evidence cells have no official monitor nearby" tone="#f096ff" />
        <Stat value={fmt(hs.fires)} label="VIIRS fire detections scanned (48 h)" tone="#ff6a2b" />
      </div>
      <p className="lede">Official monitors cluster in big cities. Albedo-Watch finds pollution <i>between</i> them — where satellites and citizens see it, and no one measures it.</p>
      {sel && (
        <div className="card focus">
          <div className="sec-h"><h3>{sel.admin.district || sel.place.label}</h3><button className="x" onClick={() => setSel(null)}>×</button></div>
          <div className="muted" style={{ fontSize: 13 }}>{[sel.admin.locality, sel.admin.state].filter(Boolean).join(', ')} · {sel.place.label}</div>
          <p>{sel.why}</p>
          <div className="kv-grid">
            <div><span>Evidence</span><b className="mono">{Math.round(sel.evidence * 100)}%</b></div>
            <div><span>Monitoring coverage</span><b className="mono">{Math.round(sel.coverage * 100)}%</b></div>
            <div><span>Downwind people (12 h)</span><b className="mono">{fmt(sel.downwind.pop_at_risk_m, 2)} M</b></div>
            <div><span>Priority</span><b className="mono">{sel.priority.toFixed(2)}</b></div>
          </div>
          <button className="btn btn-primary" onClick={() => { ctx.setDraftFor({ kind: 'hotspot', lat: sel.lat, lon: sel.lon }); ctx.setMode('command') }}>▲ Dispatch enforcement order</button>
        </div>
      )}
      <section>
        <div className="sec-h"><h3>Hidden hotspots</h3><span className="muted">priority = evidence × blind-ness × people downwind</span></div>
        <div className="list">
          {hs.hotspots.map((h, i) => (
            <button key={i} className="row" onClick={() => ctx.onHotspot(h)}>
              <span className="rank mono">{i + 1}</span>
              <div className="row-main">
                <div className="row-t">{h.admin.district || h.place.label}{h.admin.state ? <span className="muted"> · {h.admin.state}</span> : null}</div>
                <div className="row-s">{h.fires ? `${h.fires} fires` : ''}{h.fires && h.reports ? ' + ' : ''}{h.reports ? `${h.reports} reports` : ''} · coverage {Math.round(h.coverage * 100)}%{h.downwind.cities[0] ? ` · → ${h.downwind.cities[0].name}` : ''}</div>
              </div>
              <span className="mono row-v" style={{ color: '#f096ff' }}>{h.priority.toFixed(2)}</span>
            </button>
          ))}
        </div>
      </section>
      <p className="fine">{hs.method}. Station counts are approximate public CPCB listings.</p>
    </div>
  )
}

/* ================================================================ TRACE */
export function TracePanel({ ctx }: { ctx: Ctx }) {
  const cid = ctx.selectedCity ?? ctx.pulse?.summary.worst[0]?.id ?? 'delhi'
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const a = ctx.attribution
  const steps = ['Releasing 7 air parcels around the city', 'Running them 48 h backwards through the wind field', 'Matching paths to NASA VIIRS fires', 'Apportioning PM2.5 by source', 'Gemini writes the explanation']
  const at = useSteps(loading, steps, 1100)

  useEffect(() => {
    if (!ctx.selectedCity && cid) ctx.selectCity(cid, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!cid) return
    let live = true
    setLoading(true); setErr(null); ctx.setAttribution(null)
    const c = ctx.cities.find((x) => x.id === cid)
    if (c) ctx.flyTo(c.lon - 1.5, c.lat + 0.6, 5.2, 40)
    api.attribution(cid).then((r) => { if (live) ctx.setAttribution(r) }).catch((e) => live && setErr(e.message)).finally(() => live && setLoading(false))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid])

  return (
    <div className="stack">
      <CityPicker ctx={ctx} value={cid} onChange={(id) => ctx.selectCity(id, false)} />
      {loading && <StepList steps={steps} at={at} />}
      {err && <div className="err">{err}</div>}
      {a && (
        <>
          {a.narrative && (
            <div className="card">
              <div className="display" style={{ fontSize: 22, lineHeight: 1.15 }}>{a.narrative.headline}</div>
              <p style={{ margin: '10px 0 0' }}>{a.narrative.explanation}</p>
              <div style={{ marginTop: 10 }}><AiTag model="Gemini" /> <span className="chip">confidence: {a.narrative.confidence}</span></div>
            </div>
          )}
          <section>
            <div className="sec-h"><h3>Where {a.name}'s PM2.5 comes from</h3><span className="mono muted">{fmt(a.pm25, 0)} µg/m³</span></div>
            <SourceBar sources={a.sources} />
          </section>
          <section>
            <div className="sec-h"><h3>Upwind fire clusters</h3><span className="muted">fire influence {a.fire_influence}</span></div>
            {a.clusters.length ? (
              <div className="list">
                {a.clusters.slice(0, 6).map((c, i) => (
                  <button key={i} className="row" onClick={() => ctx.flyTo(c.lon, c.lat, 7.5, 50)}>
                    <span className="dot" style={{ background: '#ff6a2b', boxShadow: '0 0 10px #ff6a2b' }} />
                    <div className="row-main"><div className="row-t">{c.place.label}</div><div className="row-s">{c.fires} fires · {c.frp.toFixed(0)} MW · smoke ~{c.transport_h} h in transit</div></div>
                    <span className="mono row-v">{Math.round(c.share * 100)}%</span>
                  </button>
                ))}
              </div>
            ) : <div className="muted">No fire smoke on the incoming air paths — local sources dominate.</div>}
          </section>
          <Simulator ctx={ctx} city={a.city} />
          <p className="fine">{a.method}. Indicative receptor-model proxy, not a chemical-transport model.</p>
        </>
      )}
    </div>
  )
}

function Simulator({ ctx, city }: { ctx: Ctx; city: string }) {
  const measures = ctx.meta?.measures ?? []
  const [sel, setSel] = useState<string[]>(['cnd_ban', 'road_dust', 'fire_enforce'])
  const [comp, setComp] = useState(0.7)
  const [res, setRes] = useState<SimResult | null>(null)
  useEffect(() => {
    const t = setTimeout(() => api.simulate(city, sel, comp).then(setRes).catch(() => {}), 250)
    return () => clearTimeout(t)
  }, [city, sel, comp])
  return (
    <section className="card">
      <div className="sec-h"><h3>Act: response simulator</h3><span className="muted">GRAP measures</span></div>
      {res && (
        <div className="sim-head">
          <NaqiBadge v={res.naqi_before} />
          <span className="arrow">→</span>
          <NaqiBadge v={res.naqi_after} />
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div className="display" style={{ fontSize: 28, color: 'var(--good)' }}>−{res.reduction_pct}%</div>
            <div className="muted" style={{ fontSize: 12 }}>PM2.5 −{res.reduction} µg/m³</div>
          </div>
        </div>
      )}
      <div className="measures">
        {measures.map((m) => (
          <label key={m.id} className={`measure ${sel.includes(m.id) ? 'on' : ''}`}>
            <input type="checkbox" checked={sel.includes(m.id)} onChange={(e) => setSel(e.target.checked ? [...sel, m.id] : sel.filter((x) => x !== m.id))} />
            <span className="measure-t">{m.label}</span>
            <span className="measure-s">{m.owner} · GRAP {m.grap}{res?.measures.find((r) => r.id === m.id) ? ` · −${res.measures.find((r) => r.id === m.id)!.ugm3} µg` : ''}</span>
          </label>
        ))}
      </div>
      <label className="slider">Enforcement compliance <b className="mono">{Math.round(comp * 100)}%</b>
        <input type="range" min={0.2} max={1} step={0.05} value={comp} onChange={(e) => setComp(+e.target.value)} />
      </label>
      {res && <p className="fine">{res.caveat}</p>}
    </section>
  )
}

/* ================================================================ CITIZEN */
const LANG_CHOICES = ['hi', 'en', 'pa', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'or', 'ur', 'as']

export function CitizenPanel({ ctx }: { ctx: Ctx }) {
  const [photos, setPhotos] = useState<File[]>([])
  const [voice, setVoice] = useState<Blob | null>(null)
  const [recording, setRecording] = useState(false)
  const [text, setText] = useState('')
  const [lang, setLang] = useState('hi')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<Report | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const steps = ['Uploading evidence', 'Gemini reads the photo & listens to the voice note', 'Cross-checking NASA satellite fires nearby', 'Checking other reports & modelled PM2.5', 'Resolving jurisdiction (Google Maps)', 'Tracing where the smoke goes next']
  const at = useSteps(busy, steps, 1900)
  const selected = ctx.reports.find((r) => r.id === ctx.selectedReport)
  const shown = result ?? selected ?? null

  useEffect(() => { if (shown?.downwind?.paths) ctx.setPlume(shown.downwind.paths) }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selected) ctx.flyTo(selected.lon, selected.lat, 8, 50)
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleRecord() {
    if (recording) { rec.current?.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks: Blob[] = []
      mr.ondataavailable = (e) => chunks.push(e.data)
      mr.onstop = () => { setVoice(new Blob(chunks, { type: mr.mimeType.split(';')[0] || 'audio/webm' })); setRecording(false); stream.getTracks().forEach((t) => t.stop()) }
      mr.start(); rec.current = mr; setRecording(true)
    } catch { setErr('Microphone permission denied.') }
  }

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (p) => { ctx.setPick({ lat: p.coords.latitude, lon: p.coords.longitude }); ctx.flyTo(p.coords.longitude, p.coords.latitude, 9, 45) },
      () => ctx.setPickMode(true), { timeout: 8000 })
  }

  async function submit() {
    if (!ctx.pick) { setErr('Set the location first — use GPS or tap the map.'); return }
    setBusy(true); setErr(null); setResult(null)
    const fd = new FormData()
    fd.append('lat', String(ctx.pick.lat)); fd.append('lon', String(ctx.pick.lon)); fd.append('text', text); fd.append('lang', lang)
    photos.forEach((p) => fd.append('photos', p, p.name))
    if (voice) fd.append('voice', voice, 'voice.webm')
    try {
      const r = await api.createReport(fd)
      setResult(r); ctx.setSelectedReport(r.id); await ctx.refreshReports()
      setPhotos([]); setVoice(null); setText('')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (shown && !busy) return <ReportResult ctx={ctx} r={shown} onNew={() => { setResult(null); ctx.setSelectedReport(null); ctx.setPlume(null) }} />

  return (
    <div className="stack">
      <p className="lede">Anyone can be a sensor. Snap a photo, speak in your own language — Gemini works out what's burning, satellites verify it, and it reaches the official who can stop it.</p>
      <div className="capture">
        <label className="cap-tile">
          <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, 3))} />
          <span className="cap-ic">◐</span><b>{photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : 'Photo'}</b><span className="muted">camera or gallery</span>
        </label>
        <button className={`cap-tile ${recording ? 'rec' : ''}`} onClick={toggleRecord}>
          <span className="cap-ic">{recording ? '■' : '●'}</span><b>{recording ? 'Recording…' : voice ? 'Voice note ✓' : 'Voice'}</b><span className="muted">any Indian language</span>
        </button>
      </div>
      {photos.length > 0 && <div className="thumbs">{photos.map((p) => <img key={p.name} src={URL.createObjectURL(p)} alt="" />)}</div>}
      <textarea className="input" rows={3} placeholder="Optional: describe what you see — in any language" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="btn-row">
        <select className="select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Your language">
          {LANG_CHOICES.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={locate}>⌖ Use my location</button>
        <button className={`btn btn-ghost btn-sm ${ctx.pickMode ? 'on' : ''}`} onClick={() => ctx.setPickMode(!ctx.pickMode)}>Tap on map</button>
      </div>
      {ctx.pick && <div className="muted mono" style={{ fontSize: 12 }}>📍 {ctx.pick.lat.toFixed(4)}, {ctx.pick.lon.toFixed(4)}</div>}
      <button className="btn btn-primary" disabled={busy} onClick={submit} style={{ justifyContent: 'center' }}>{busy ? 'Analysing…' : 'Send report'}</button>
      {busy && <StepList steps={steps} at={at} />}
      {err && <div className="err">{err}</div>}
      <section>
        <div className="sec-h"><h3>Recent reports</h3><span className="muted">{ctx.reports.length}</span></div>
        <div className="list">
          {ctx.reports.slice(0, 12).map((r) => (
            <button key={r.id} className="row" onClick={() => ctx.setSelectedReport(r.id)}>
              {r.thumb ? <img className="row-img" src={r.thumb} alt="" /> : <span className="row-img ph">✦</span>}
              <div className="row-main">
                <div className="row-t">{r.analysis.source_label}</div>
                <div className="row-s">{r.jurisdiction.locality || r.jurisdiction.city} · {ago(r.created_at)}</div>
              </div>
              <span className={`status s-${r.verification.status}`}>{r.verification.status}</span>
            </button>
          ))}
          {!ctx.reports.length && <div className="muted">No reports yet — be the first.</div>}
        </div>
      </section>
    </div>
  )
}

function ReportResult({ ctx, r, onNew }: { ctx: Ctx; r: Report; onNew: () => void }) {
  const a = r.analysis, v = r.verification
  const [audio, setAudio] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const sig = v.signals
  return (
    <div className="stack">
      <button className="back" onClick={onNew}>← New report</button>
      <div className="report-hero">
        {r.thumb && <img src={r.thumb} alt="Citizen photo" />}
        <div className="report-hero-txt">
          <span className={`status s-${v.status}`}>{v.status} · {Math.round(v.score * 100)}</span>
          <div className="display" style={{ fontSize: 26, marginTop: 6 }}>{a.source_label}</div>
          <div className="sev">{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= a.severity ? 'on' : ''} />)} <span className="muted">severity {a.severity}/5</span></div>
        </div>
      </div>
      <p style={{ margin: 0 }}>{a.summary_en}</p>
      {a.transcript && <div className="quote"><div className="eyebrow">Voice note · {LANG_NAMES[a.language_detected] ?? a.language_detected}</div>“{a.transcript}”{a.translation_en && <div className="muted" style={{ marginTop: 6 }}>{a.translation_en}</div>}</div>}
      <section className="card">
        <div className="sec-h"><h3>Independent verification</h3></div>
        <div className="verify">
          <div><span>Gemini confidence</span><meter min={0} max={1} value={sig.ai_confidence} /><b className="mono">{Math.round(sig.ai_confidence * 100)}%</b></div>
          <div><span>Satellite corroboration</span><meter min={0} max={1} value={sig.satellite} /><b className="mono">{Math.round(sig.satellite * 100)}%</b></div>
          <div><span>Nearby matching reports</span><meter min={0} max={2} value={sig.peer_reports} /><b className="mono">{sig.peer_reports}</b></div>
          <div><span>Authentic real photo</span><span>{sig.authentic ? '✓' : '✕'}</span><span /></div>
        </div>
        {v.nearby_fires[0] && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Nearest VIIRS fire: {v.nearby_fires[0].km} km, {v.nearby_fires[0].hours_ago} h ago, {v.nearby_fires[0].frp} MW</div>}
        {a.authenticity_notes && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{a.authenticity_notes}</div>}
      </section>
      <section className="card">
        <div className="sec-h"><h3>Routed to</h3></div>
        <div className="display" style={{ fontSize: 18 }}>{r.jurisdiction.route_to}</div>
        <div className="muted" style={{ fontSize: 13 }}>{[r.jurisdiction.locality, r.jurisdiction.district, r.jurisdiction.state].filter(Boolean).join(' · ')}</div>
        {r.downwind.cities.length > 0 && <div style={{ marginTop: 8 }}>Smoke heads toward <b>{r.downwind.cities.map((c) => `${c.name} (~${c.eta_h} h)`).join(', ')}</b></div>}
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => { ctx.setDraftFor({ kind: 'report', report_id: r.id }); ctx.setMode('command') }}>▲ Escalate as action order</button>
      </section>
      <section className="reply">
        <div className="eyebrow">Reply to citizen · {LANG_NAMES[a.language_detected] ?? a.language_detected}</div>
        <div className="bubble">{a.reply_to_citizen}</div>
        <button className="btn btn-ghost btn-sm" disabled={speaking} onClick={async () => {
          try { setSpeaking(true); const u = audio ?? await api.tts(a.reply_to_citizen); setAudio(u); await new Audio(u).play() } catch { /* voice optional */ } finally { setSpeaking(false) }
        }}>{speaking ? '…' : '▶ Hear it (Gemini voice)'}</button>
      </section>
      <AiTag model={r.ai.model} ms={r.ai.ms} />
    </div>
  )
}

/* ================================================================ FORECAST */
export function ForecastPanel({ ctx }: { ctx: Ctx }) {
  if (!ctx.corridors.length) return <Loading lines={6} label="Building corridor forecasts…" />
  return (
    <div className="stack">
      <p className="lede">Pollution doesn't respect city limits. Six economic corridors, 72 hours ahead, every 6 hours — so a spike in Ludhiana warns Delhi before it arrives.</p>
      {ctx.corridors.map((c) => (
        <div key={c.id} className="card corridor" onClick={() => {
          const lons = c.path.map((p) => p[0]), lats = c.path.map((p) => p[1])
          const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats))
          ctx.flyTo((Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2 - span * 0.1, Math.max(4, 7.5 - Math.log2(span + 1) * 1.3), 35)
        }}>
          <div className="sec-h">
            <div><h3>{c.name}</h3><div className="muted" style={{ fontSize: 12 }}>{c.kind} · {fmt(c.pop_m, 1)} M people · {c.strip.length} cities</div></div>
            <NaqiBadge v={c.peak72} />
          </div>
          <div className="strip">
            <div className="strip-head mono"><span />{c.strip[0]?.cells.map((x) => <span key={x.h}>{x.h === 0 ? 'now' : `+${x.h}`}</span>)}</div>
            {c.strip.map((s) => (
              <div key={s.id} className="strip-row">
                <span className="strip-name">{s.name}</span>
                {s.cells.map((x) => <span key={x.h} className="cell" style={{ background: x.color }} title={`${s.name} +${x.h} h: NAQI ${x.naqi ?? '—'}`} />)}
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{c.blurb} Worst: <b style={{ color: 'var(--ink)' }}>{c.worst_city}</b> around {istTime(c.worst_time)}.</div>
        </div>
      ))}
    </div>
  )
}

/* ================================================================ COMMAND */
const FLOW = ['draft', 'approved', 'dispatched', 'acknowledged', 'resolved']

export function CommandPanel({ ctx }: { ctx: Ctx }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<Alert | null>(null)
  const steps = ['Assembling forecast, sources & jurisdiction', 'Gemini drafts the GRAP-aligned order', 'Writing advisories in local languages', 'Human review required before dispatch']
  const at = useSteps(busy, steps, 2600)

  async function draft(body: NonNullable<Ctx['draftFor']>) {
    setBusy(true); setErr(null); setOpen(null)
    try { const a = await api.draftAlert(body); setOpen(a); await ctx.refreshAlerts() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => {
    if (ctx.draftFor) { const d = ctx.draftFor; ctx.setDraftFor(null); draft(d) }
  }, [ctx.draftFor]) // eslint-disable-line react-hooks/exhaustive-deps

  const spikes = ctx.cities.filter((c) => c.spike).sort((a, b) => b.spike!.peak - a.spike!.peak).slice(0, 6)
  if (open) return <AlertView ctx={ctx} a={open} onBack={() => setOpen(null)} onUpdate={setOpen} />
  return (
    <div className="stack">
      <p className="lede">From forecast to action in one click. Gemini drafts the order and the public advisories; a human officer approves, dispatches and closes the loop — every step on a public ledger.</p>
      {busy && <StepList steps={steps} at={at} />}
      {err && <div className="err">{err}</div>}
      <section>
        <div className="sec-h"><h3>Needs action</h3><span className="muted">forecast spikes</span></div>
        <div className="list">
          {spikes.map((c) => (
            <div key={c.id} className="row">
              <span className="dot" style={{ background: naqiColor(c.spike!.peak) }} />
              <div className="row-main"><div className="row-t">{c.name}</div><div className="row-s">{c.spike!.grap.name} in ~{c.spike!.lead_hours} h · {c.authority.primary_short}</div></div>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => draft({ kind: 'city', city: c.id })}>Draft</button>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="sec-h"><h3>Action ledger</h3><span className="muted">{ctx.alerts.length}</span></div>
        <div className="list">
          {ctx.alerts.map((a) => (
            <button key={a.id} className="row" onClick={() => setOpen(a)}>
              <span className={`sev-dot sev-${a.draft.severity}`} />
              <div className="row-main"><div className="row-t">{a.draft.title}</div><div className="row-s">{a.target.name} · {ago(a.created_at)}</div></div>
              <span className={`status s-${a.status}`}>{a.status}</span>
            </button>
          ))}
          {!ctx.alerts.length && <div className="muted">No orders yet.</div>}
        </div>
      </section>
    </div>
  )
}

function AlertView({ ctx, a, onBack, onUpdate }: { ctx: Ctx; a: Alert; onBack: () => void; onUpdate: (a: Alert) => void }) {
  const d = a.draft
  const [lang, setLang] = useState(d.advisories[0]?.lang ?? 'en')
  const [speaking, setSpeaking] = useState(false)
  const adv = d.advisories.find((x) => x.lang === lang) ?? d.advisories[0]
  const idx = FLOW.indexOf(a.status)
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null
  const verb: Record<string, string> = { approved: 'Approve', dispatched: 'Dispatch', acknowledged: 'Mark acknowledged', resolved: 'Mark resolved' }
  return (
    <div className="stack">
      <button className="back" onClick={onBack}>← Ledger</button>
      <div>
        <span className={`sev-pill sev-${d.severity}`}>{d.severity}</span>
        <div className="display" style={{ fontSize: 24, lineHeight: 1.15, marginTop: 8 }}>{d.title}</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>To: {String((a as unknown as { context: { authority: string } }).context?.authority ?? '')}</div>
      </div>
      <div className="flow">{FLOW.map((s, i) => <div key={s} className={i <= idx ? 'on' : ''}><i />{s}</div>)}</div>
      <p style={{ margin: 0 }}>{d.situation}</p>
      <section className="card">
        <div className="sec-h"><h3>Ordered actions</h3></div>
        <div className="actions">
          {d.actions.map((x, i) => (
            <div key={i} className="action">
              <span className="mono num-b">{i + 1}</span>
              <div><div className="row-t">{x.action}</div><div className="row-s">{x.owner}{x.why ? ` — ${x.why}` : ''}</div></div>
              <span className="chip mono">≤ {x.within_hours} h</span>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="sec-h"><h3>Public advisory</h3>
          <div className="seg">{d.advisories.map((x) => <button key={x.lang} className={x.lang === lang ? 'on' : ''} onClick={() => setLang(x.lang)}>{LANG_NAMES[x.lang] ?? x.lang}</button>)}</div>
        </div>
        {adv && <div className="bubble" dangerouslySetInnerHTML={{ __html: mdLite(adv.text) }} />}
        <button className="btn btn-ghost btn-sm" disabled={speaking || !adv} onClick={async () => {
          try { setSpeaking(true); const u = await api.tts(adv!.text); await new Audio(u).play() } catch { /* optional */ } finally { setSpeaking(false) }
        }}>{speaking ? 'Synthesising…' : '▶ Play voice advisory (IVR / radio)'}</button>
      </section>
      <section className="phone">
        <div className="eyebrow">SMS · Cell broadcast preview</div>
        <div className="sms">{d.sms}</div>
      </section>
      {d.review_note && <div className="callout warn"><b>Officer check:</b> {d.review_note}</div>}
      {next && (
        <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={async () => { const u = await api.alertStatus(a.id, next); onUpdate(u); ctx.refreshAlerts() }}>
          {verb[next]} →
        </button>
      )}
      <section>
        <div className="sec-h"><h3>Ledger</h3></div>
        <ol className="ledger">
          {a.timeline.map((t, i) => <li key={i}><b>{t.status}</b> · {t.by} · <span className="muted">{istTime(t.at)}</span>{t.channels && <div className="muted" style={{ fontSize: 12 }}>{t.channels.join(' · ')}</div>}</li>)}
        </ol>
      </section>
      <AiTag model={a.ai.model} ms={a.ai.ms} />
    </div>
  )
}

/* ================================================================ COMMONS */
export function CommonsPanel({ ctx }: { ctx: Ctx }) {
  const c = ctx.commons
  const [dp, setDp] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => { ctx.flyTo(80.5, 20.5, 3.9, 30) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <Loading lines={6} label="Loading the federated Model Commons…" />
  const s = c.summary
  return (
    <div className="stack">
      <p className="lede">Global forecasts miss local reality. Each state trains on its own ground truth and shares <b>only model weights</b> — never raw data. The federation beats every state going alone.</p>
      <div className="stats-2">
        <Stat value={`−${s.improvement_pct}%`} label="forecast error vs global CAMS model" tone="var(--albedo)" />
        <Stat value={`−${s.zero_data_improvement_pct}%`} label="for a state that shares zero data (leave-one-out)" tone="var(--wind)" />
        <Stat value={`${s.nodes}`} label="state nodes" />
        <Stat value={`${fmt(s.raw_bytes_kept_local / 1024, 0)} KB`} label={`raw data kept local · ${fmt(s.bytes_shared / 1024, 0)} KB weights shared`} />
      </div>
      <section>
        <div className="sec-h"><h3>Mean abs. error, PM2.5 (µg/m³)</h3><span className="muted">held-out 18 h, lower is better</span></div>
        <HBars rows={[
          { label: 'Global model (CAMS)', value: s.mae_cams },
          { label: 'Each state alone', value: s.mae_local, note: 'too little data' },
          { label: 'Federated', value: s.mae_federated, accent: true },
          { label: 'Federated + personalised', value: s.mae_personalised, accent: true },
          { label: 'Zero-data state (served by federation)', value: s.mae_zero_data, accent: true },
        ]} unit="" />
      </section>
      <section>
        <div className="sec-h"><h3>Convergence</h3><span className="muted">{s.rounds} FedAvg rounds · {s.train_ms} ms</span></div>
        <RoundsChart rounds={c.rounds} baseline={s.mae_cams} />
      </section>
      <section className="card">
        <div className="sec-h"><h3>Retrain the federation</h3></div>
        <label className="slider">Differential-privacy noise σ <b className="mono">{dp.toFixed(2)}</b>
          <input type="range" min={0} max={0.1} step={0.01} value={dp} onChange={(e) => setDp(+e.target.value)} />
        </label>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => {
          setBusy(true); try { ctx.setCommons(await api.train(30, dp)); await ctx.reloadPulse() } finally { setBusy(false) }
        }}>{busy ? 'Training 21 nodes…' : '⬡ Run 30 rounds'}</button>
      </section>
      <section>
        <div className="sec-h"><h3>Nodes</h3><span className="muted">global model bias → corrected</span></div>
        <div className="nodes">
          <div className="node head mono"><span>State</span><span>bias</span><span>CAMS</span><span>Fed.</span></div>
          {[...c.nodes].sort((a, b) => b.mae_cams - a.mae_cams).map((n) => (
            <div key={n.state} className="node">
              <span>{n.name} <span className="muted">({n.authority})</span></span>
              <span className="mono" style={{ color: n.bias_cams > 0 ? '#f08a24' : '#6fe3ff' }}>{n.bias_cams > 0 ? '+' : ''}{n.bias_cams}</span>
              <span className="mono muted">{n.mae_cams}</span>
              <span className="mono" style={{ color: n.mae_personalised < n.mae_cams ? 'var(--good)' : 'var(--ink-2)' }}>{n.mae_personalised}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="sec-h"><h3>Open by design — a Digital Public Good</h3></div>
        <div className="links">
          <a href="/api/interop/schema" target="_blank" rel="noreferrer">Open Air Event Protocol (JSON Schema) ↗</a>
          <a href="/api/interop/events.geojson" target="_blank" rel="noreferrer">Live OAEP event feed (GeoJSON) ↗</a>
          <a href="/api/commons" target="_blank" rel="noreferrer">Model card + weights (CC-BY-4.0) ↗</a>
        </div>
        {ctx.meta && (
          <div className="bricks">
            {Object.entries(ctx.meta.countries).map(([k, v]) => <span key={k} className={`chip ${v.status === 'live' ? 'live' : ''}`} title={v.note}>{v.name} · {v.status}</span>)}
          </div>
        )}
      </section>
    </div>
  )
}

/* ================================================================ ASK */
type SR = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void; stop: () => void }

export function AskDrawer({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [msgs, setMsgs] = useState<{ role: 'u' | 'a'; text: string; model?: string | null }[]>([])
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceLang, setVoiceLang] = useState('hi-IN')
  const srRef = useRef<SR | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs, busy])
  const SRClass = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition

  async function send(text: string) {
    if (!text.trim()) return
    setMsgs((m) => [...m, { role: 'u', text }]); setQ(''); setBusy(true)
    try { const r = await api.ask(text, ctx.selectedCity ?? undefined); setMsgs((m) => [...m, { role: 'a', text: r.answer, model: r.model }]) }
    catch { setMsgs((m) => [...m, { role: 'a', text: 'Sorry — I could not reach the assistant.' }]) } finally { setBusy(false) }
  }
  function listen() {
    if (!SRClass) return
    if (listening) { srRef.current?.stop(); return }
    const sr = new SRClass(); sr.lang = voiceLang; sr.interimResults = false
    sr.onresult = (e) => send(e.results[0][0].transcript)
    sr.onend = () => setListening(false)
    srRef.current = sr; sr.start(); setListening(true)
  }
  const samples = ['दिल्ली में कल हवा कैसी रहेगी?', 'Where is Punjab smoke going tonight?', 'சென்னையில் குழந்தைகள் வெளியே விளையாடலாமா?', 'Which cities need GRAP Stage II this week?']
  return (
    <div className="ask glass fade-up" role="dialog" aria-label="Ask Albedo">
      <div className="sec-h" style={{ padding: '14px 16px 0' }}>
        <div><div className="eyebrow">✦ Ask Albedo</div><div className="muted" style={{ fontSize: 12 }}>Any Indian language · type or speak</div></div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="ask-body scroll-y">
        {!msgs.length && <div className="samples">{samples.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div dangerouslySetInnerHTML={{ __html: mdLite(m.text) }} />
            {m.role === 'a' && (
              <div className="msg-foot">
                {m.model && <AiTag model={m.model} />}
                <button className="linkish" onClick={async () => { try { const u = await api.tts(m.text.slice(0, 850)); new Audio(u).play() } catch { /* optional */ } }}>▶ listen</button>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg a"><div className="typing"><i /><i /><i /></div></div>}
        <div ref={end} />
      </div>
      <form className="ask-in" onSubmit={(e) => { e.preventDefault(); send(q) }}>
        {SRClass && (
          <>
            <select className="select mini" value={voiceLang} onChange={(e) => setVoiceLang(e.target.value)} aria-label="Voice language">
              {[['hi-IN', 'हि'], ['en-IN', 'EN'], ['ta-IN', 'த'], ['bn-IN', 'বা'], ['te-IN', 'తె'], ['mr-IN', 'म'], ['pa-IN', 'ਪੰ'], ['gu-IN', 'ગુ'], ['kn-IN', 'ಕ'], ['ml-IN', 'മ']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" className={`mic ${listening ? 'on' : ''}`} onClick={listen} aria-label="Speak">●</button>
          </>
        )}
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about any city, any language…" />
        <button className="btn btn-primary btn-sm" disabled={busy}>Ask</button>
      </form>
    </div>
  )
}
