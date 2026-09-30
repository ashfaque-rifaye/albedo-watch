import { createPortal } from 'react-dom'
import { AirPlan } from './AirPlan'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Alert, Cat, City, CopilotStep, DraftBody, Hotspot, PlaceIntel, Report, SimResult } from '../lib/api'
import { api } from '../lib/api'
import { LANG_NAMES, ago, fmt, istTime, mdLite } from '../lib/format'
import { ForecastChart, HBars, RoundsChart, SourceBar } from './charts'
import { LEVEL_COLORS } from './Globe'
import type { Ctx, DraftFor } from './MissionControl'

/* ================================================================ shared */
function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-v display" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="stat-l">{label}</div>
    </div>
  )
}

export function IndexBadge({ v, cat, big, system }: { v: number | null | undefined; cat?: Cat; big?: boolean; system?: string }) {
  const color = cat?.color ?? (cat && cat.level >= 0 ? LEVEL_COLORS[cat.level] : '#6b7280')
  return (
    <span className={`naqi-badge ${big ? 'big' : ''}`} style={{ ['--c' as string]: color }}>
      <b className="mono">{v ?? '—'}</b><span>{cat?.label ?? 'No data'}{system && big ? <em> · {system}</em> : null}</span>
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

function useElapsed(active: boolean) {
  const [s, setS] = useState(0)
  useEffect(() => {
    if (!active) { setS(0); return }
    const t0 = Date.now()
    const iv = setInterval(() => setS(Math.round((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(iv)
  }, [active])
  return s
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

function StepList({ steps, at, elapsed }: { steps: string[]; at: number; elapsed?: number }) {
  return (
    <div className="steps-wrap">
      <ol className="steps">
        {steps.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''}>{s}</li>)}
      </ol>
      {elapsed != null && <div className="elapsed mono">{elapsed}s</div>}
    </div>
  )
}

function CityPicker({ ctx, value, onChange }: { ctx: Ctx; value: string | null; onChange: (id: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, City[]>()
    for (const c of [...ctx.cities].sort((a, b) => a.name.localeCompare(b.name))) {
      const g = c.india ? `India · ${c.state_name}` : c.country_name
      m.set(g, [...(m.get(g) ?? []), c])
    }
    return [...m.entries()].sort((a, b) => (a[0].startsWith('India') === b[0].startsWith('India') ? a[0].localeCompare(b[0]) : a[0].startsWith('India') ? -1 : 1))
  }, [ctx.cities])
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>Choose a city…</option>
      {groups.map(([g, cs]) => <optgroup key={g} label={g}>{cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
    </select>
  )
}

const REGIONS = ['World', 'India', 'South Asia', 'East Asia', 'South-East Asia', 'Middle East', 'Europe', 'Africa', 'North America', 'Latin America', 'Oceania', 'Central Asia']
function inRegion(c: City, r: string) {
  if (r === 'World') return true
  if (r === 'India') return c.india
  if (r === 'South Asia') return c.region === 'South Asia' && !c.india
  return c.region === r
}

/* ================================================================ PULSE */
function HubCard({ ctx }: { ctx: Ctx }) {
  const h = ctx.hub
  if (!h) {
    return (
      <div className="card hub-cta">
        <div className="display" style={{ fontSize: 22, lineHeight: 1.15 }}>What are you breathing right now?</div>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Use your location to set your hub: live measured air at your locality, a 24-hour forecast, and alerts for your area.</p>
        <div className="btn-row">
          <button className="btn btn-primary btn-sm" disabled={ctx.locating} onClick={ctx.locateMe}>{ctx.locating ? 'Locating…' : '⌖ Use my location'}</button>
          <select className="select" value={ctx.country ?? ''} onChange={(e) => ctx.setCountry(e.target.value || null)} aria-label="Choose country">
            <option value="">…or choose a country</option>
            {ctx.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
      </div>
    )
  }
  const i = h.intel
  if (!i) return <div className="card hub"><Loading lines={3} label="Reading the air at your hub…" /></div>
  const g = i.google_aq, local = g.indexes?.find((x) => x.code !== 'uaqi'), uaqi = g.indexes?.find((x) => x.code === 'uaqi')
  const f = i.forecast
  const strip = f.series ? f.series.level.slice(f.series.now_offset, f.series.now_offset + 25).filter((_, k) => k % 3 === 0) : []
  const name = i.place.locality || i.place.district || i.place.nearest_city
  return (
    <div className="card hub">
      <div className="sec-h"><div><div className="eyebrow" style={{ color: 'var(--wind)' }}>⌖ Your hub</div><h3 style={{ fontSize: 18 }}>{name}</h3>
        <div className="muted" style={{ fontSize: 12 }}>{[i.place.state, i.place.country].filter(Boolean).join(', ')}</div></div>
        <button className="linkish" onClick={ctx.clearHub}>change</button></div>
      <div className="live-row">
        {local ? <div className="big-idx" style={{ ['--c' as string]: local.color ?? '#9ccc3a' }}><b className="display">{local.aqi}</b><span>{local.name} · measured now</span><em>{local.category}</em></div>
          : f.now.index != null ? <div className="big-idx" style={{ ['--c' as string]: f.now.category?.color ?? '#9ccc3a' }}><b className="display">{f.now.index}</b><span>{f.now.system} · forecast model</span><em>{f.now.category?.label}</em></div> : null}
        {uaqi && <div className="big-idx small" style={{ ['--c' as string]: uaqi.color ?? '#9ccc3a' }}><b className="display">{uaqi.aqi}</b><span>Universal AQI</span><em>{uaqi.category}</em></div>}
      </div>
      {strip.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Next 24 h · every 3 h</div>
          <div className="hub-strip">{strip.map((l, k) => <i key={k} style={{ background: LEVEL_COLORS[Math.max(0, l)] }} title={`+${k * 3} h`} />)}</div>
          <div className="hub-strip-lab mono"><span>now</span><span>+12 h</span><span>+24 h</span></div>
        </div>
      )}
      <AirPlan intel={i} lat={h.lat} lon={h.lon} vapidKey={ctx.meta?.vapid_public_key} />
      <div className="kv-grid">
        <div><span>Heat detections ≤ 50 km</span><b className="mono">{i.fires.within_50km}</b></div>
        <div><span>Wind</span><b className="mono">{fmt(i.weather.wind_kmh, 0)} km/h from {i.weather.wind_from_compass ?? '—'}</b></div>
      </div>
      <div className="btn-row">
        <button className="btn btn-primary btn-sm" onClick={() => ctx.openPlace(h.lat, h.lon, 2500)}>◳ Live 3D view</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { ctx.setDraftFor({ kind: 'place', lat: h.lat, lon: h.lon, label: name, suggested: i.languages }); ctx.setMode('command') }}>▲ Alert my area</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { ctx.setPick({ lat: h.lat, lon: h.lon }); ctx.setMode('citizen') }}>✦ Report</button>
      </div>
    </div>
  )
}

export function PulsePanel({ ctx }: { ctx: Ctx }) {
  const p = ctx.pulse
  const [region, setRegion] = useState('World')
  const city = ctx.cities.find((c) => c.id === ctx.selectedCity)
  if (!p) return <Loading lines={6} label="Pulling forecasts, winds, satellites and sensors for 233 cities…" />
  if (city) return <CityCard ctx={ctx} city={city} />
  const s = p.summary
  const scopeName = ctx.country ? (ctx.countries.find((c) => c.code === ctx.country)?.name ?? ctx.country) : region
  const inR = p.cities.filter((c) => (ctx.country ? c.country === ctx.country : inRegion(c, region)))
  const spikes = inR.filter((c) => c.spike).sort((a, b) => b.spike!.peak_category.level - a.spike!.peak_category.level || b.spike!.peak - a.spike!.peak)
  const worst = inR.filter((c) => c.naqi != null).sort((a, b) => b.category.level - a.category.level || b.naqi! - a.naqi!)
  return (
    <div className="stack">
      <HubCard ctx={ctx} />
      {ctx.country ? (
        <div className="chips-row"><span className="chip on">{scopeName} · {inR.length} cities</span><button className="chip chip-btn" onClick={() => ctx.setCountry(null)}>× show whole world</button></div>
      ) : (
        <div className="chips-row">{REGIONS.map((r) => <button key={r} className={`chip chip-btn ${r === region ? 'on' : ''}`} onClick={() => setRegion(r)}>{r}</button>)}</div>
      )}
      <section>
        <div className="sec-h"><h3>Unhealthy air ahead · {scopeName}</h3><span className="muted">{spikes.length}</span></div>
        <div className="list">
          {spikes.slice(0, 10).map((c) => (
            <button key={c.id} className="row" onClick={() => ctx.selectCity(c.id)}>
              <span className="dot" style={{ background: c.spike!.peak_category.color }} />
              <div className="row-main">
                <div className="row-t">{c.name} <span className="muted">· {c.india ? c.state_name : c.country_name}</span></div>
                <div className="row-s">{c.spike!.peak_category.label} in ~{c.spike!.lead_hours} h · {c.spike!.grap.name}</div>
              </div>
              <span className="mono row-v" style={{ color: c.spike!.peak_category.color }}>{c.spike!.peak}</span>
            </button>
          ))}
          {!spikes.length && <div className="muted" style={{ fontSize: 13 }}>No city here is forecast to reach unhealthy air in the next 72 h.</div>}
        </div>
      </section>
      <section>
        <div className="sec-h"><h3>Worst air right now · {scopeName}</h3></div>
        <div className="list">
          {worst.slice(0, 8).map((c) => (
            <button key={c.id} className="row" onClick={() => ctx.selectCity(c.id)}>
              <span className="dot" style={{ background: c.category.color }} />
              <div className="row-main"><div className="row-t">{c.name} <span className="muted">· {c.india ? c.state_name : c.country_name}</span></div>
                <div className="row-s">{c.category.label} · {c.dominant ?? 'PM'} · {c.index_system}</div></div>
              <span className="mono row-v" style={{ color: c.category.color }}>{c.naqi}</span>
            </button>
          ))}
        </div>
      </section>
      <p className="fine">{s.cities} cities · {s.countries} countries · India: CPCB NAQI (median {s.national_median ?? '—'} now). Elsewhere US EPA AQI. Forecasts are bias-corrected model estimates. Click anywhere on the globe for live, measured readings.</p>
    </div>
  )
}

function CityCard({ ctx, city }: { ctx: Ctx; city: City }) {
  const [detail, setDetail] = useState<City | null>(null)
  useEffect(() => { setDetail(null); api.city(city.id).then(setDetail).catch(() => {}) }, [city.id])
  return (
    <div className="stack">
      <button className="back" onClick={() => ctx.selectCity(null, false)}>← All cities</button>
      <div className="city-hero">
        <div>
          <div className="display" style={{ fontSize: 34 }}>{city.name}</div>
          <div className="muted">{city.local_name !== city.name ? `${city.local_name} · ` : ''}{city.india ? `${city.state_name}, India` : city.country_name} · {fmt(city.pop_m, 1)} M people</div>
        </div>
        <IndexBadge v={city.naqi} cat={city.category} big system={city.index_system} />
      </div>
      {city.spike ? (
        <div className="callout warn"><b>{city.spike.peak_category.label} expected in ~{city.spike.lead_hours} h</b> — peak {city.index_system} {city.spike.peak} around {istTime(city.spike.peak_time)} IST. {city.spike.grap.name}.</div>
      ) : <div className="callout">No category jump forecast in the next 72 h. Peak {city.index_system} {city.peak72 ?? '—'}.</div>}
      <section>
        <div className="sec-h"><h3>{city.index_system} · past 24 h → next 72 h</h3></div>
        {detail?.series ? <ForecastChart system={city.index_system} d={{ time: detail.series.time, index: detail.series.naqi, level: detail.series.level, now_offset: detail.series.now_offset, pm25: detail.series.pm25, pm25_cams: detail.series.pm25_cams }} />
          : <div className="skeleton" style={{ height: 170 }} />}
      </section>
      <div className="kv-grid">
        <div><span>PM2.5 (corrected)</span><b className="mono">{fmt(city.pm25, 0)} µg/m³</b></div>
        <div><span>Global model said</span><b className="mono">{fmt(city.pm25_cams, 0)} µg/m³</b></div>
        <div><span>Wind</span><b className="mono">{fmt(city.wind.speed, 0)} km/h from {fmt(city.wind.dir, 0)}°</b></div>
        <div><span>Daytime stagnation (48 h)</span><b className="mono">{city.stagnant_hours_48} h</b></div>
        <div><span>Correction</span><b>{city.correction === 'personalised' ? 'Personalised (own truth)' : city.correction === 'federated-global' ? 'Borrowed from its federation' : 'Raw'}</b></div>
        <div><span>Authority</span><b>{city.authority.primary_short}</b></div>
      </div>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => ctx.openPlace(city.lat, city.lon, 9000)}>⌖ Live view</button>
        <button className="btn btn-ghost" onClick={() => ctx.setMode('trace')}>↶ Trace sources</button>
        <button className="btn btn-ghost" onClick={() => { ctx.setDraftFor({ kind: 'city', city: city.id, label: city.name }); ctx.setMode('command') }}>▲ Draft alert</button>
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
  const rank = sel && hs ? hs.hotspots.findIndex((h) => h.lat === sel.lat && h.lon === sel.lon) + 1 : 0
  return (
    <div className="stack">
      <div className="seg wide">
        {(['world', 'india'] as const).map((s) => <button key={s} className={ctx.hotScope === s ? 'on' : ''} onClick={() => { setSel(null); ctx.setHotScope(s) }}>{s === 'world' ? 'Whole world' : 'India'}</button>)}
      </div>
      {!hs ? <Loading lines={6} label="Scanning the planet for heat and reports where no monitor is watching…" /> : (<>
        <p className="lede">Official monitors cluster in big cities. These are places where NASA satellites or verified citizens see a pollution source, <b>no official monitor is nearby</b>, and the modelled air around it is actually dirty, ranked by how many people live downwind.</p>
        <details className="explain">
          <summary>How a place qualifies</summary>
          <ol>
            <li>At least 3 NASA VIIRS heat detections (or 40 MW of fire power) in 24 h, or a verified citizen report. Single specks are ignored.</li>
            <li>Nearby detections within 100 km count as one fire complex.</li>
            <li>No reference monitor close by ({hs.official_source}{hs.monitor_sites ? `, ${fmt(hs.monitor_sites)} sites worldwide` : ''}); citizen sensors count as partial coverage.</li>
            <li>The air around it must be dirty: fires where the CAMS model sees clean air (PM2.5 under 12 µg/m³) are dropped. Then weighted by detection confidence and by people in cities downwind within 12 h.</li>
          </ol>
        </details>
        <div className="stats-2">
          <Stat value={`${Math.round(hs.unmonitored_share * 100)}%`} label={hs.official_coverage_known ? 'of evidence sits more than 25 km from any official monitor' : 'of evidence in India sits more than 25 km from an official monitor (station locations elsewhere pending OpenAQ)'} tone="#f096ff" />
          <Stat value={fmt(hs.sensors)} label={`open citizen sensors counted as partial coverage${hs.stations ? ` · ${fmt(hs.stations)} official stations` : ''}`} tone="#9ccc3a" />
        </div>
        {sel && (
          <div className="card focus">
            <div className="sec-h"><h3><span className="rank-pill">#{rank}</span> {sel.admin?.district || sel.place.label}</h3><button className="x" onClick={() => setSel(null)} aria-label="Close">×</button></div>
            <div className="muted" style={{ fontSize: 13 }}>{[sel.admin?.locality, sel.admin?.state, sel.admin?.country].filter(Boolean).join(', ')} · {sel.place.label}</div>
            <div className="facts">
              <div><b className="mono">{sel.fires}</b><span>heat detections (24 h)</span></div>
              <div><b className="mono">{sel.frp_max.toFixed(0)} MW</b><span>largest fire</span></div>
              <div><b className="mono">{sel.nearest_monitor_km != null ? `${sel.nearest_monitor_km} km` : hs.official_coverage_known || (sel.lat > 6 && sel.lat < 37.5 && sel.lon > 68 && sel.lon < 97.5) ? '> 100 km' : 'unknown'}</b><span>to nearest official monitor</span></div>
              <div><b className="mono">{sel.downwind.pop_at_risk_m >= 0.01 ? `${fmt(sel.downwind.pop_at_risk_m, 2)} M` : 'none'}</b><span>{sel.downwind.pop_at_risk_m >= 0.01 ? 'people in cities downwind (12 h)' : 'no tracked city downwind in 12 h'}</span></div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {sel.confidence && <span className={`conf ${sel.confidence}`}>{sel.confidence.toUpperCase()} CONFIDENCE</span>}
              {sel.satellites?.length ? <span className="chip mono">{sel.satellites.join(' + ')}</span> : null}
              {sel.span_h ? <span className="chip mono">seen over {sel.span_h} h</span> : null}
              {sel.site_pm25 != null && <span className="chip mono">CAMS PM2.5 {fmt(sel.site_pm25, 0)} µg/m³</span>}
              {sel.merged ? <span className="chip mono">+{sel.merged} nearby cells</span> : null}
            </div>
            <p style={{ margin: 0, fontSize: 13.5 }}>{sel.why}</p>
            {sel.image && (
              <figure className="shot wide" style={{ margin: 0 }}>
                <img src={sel.image.url} alt={`NASA VIIRS satellite image around this hotspot, ${sel.image.date}`} loading="lazy" />
                <figcaption>NASA VIIRS true colour + heat detections (red) · {sel.image.date} · ~50 km across</figcaption>
              </figure>
            )}
            <div className="btn-row">
              <button className="btn btn-primary btn-sm" onClick={() => ctx.openPlace(sel.lat, sel.lon, 9000)}>⌖ Live view &amp; satellite image</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { ctx.setDraftFor({ kind: 'hotspot', lat: sel.lat, lon: sel.lon, label: sel.admin?.district || sel.place.label }); ctx.setMode('command') }}>▲ Enforcement order</button>
            </div>
          </div>
        )}
        <section>
          <div className="sec-h"><h3>Ranked hidden hotspots</h3><span className="muted">numbers match the map</span></div>
          <div className="list">
            {hs.hotspots.map((h, i) => (
              <button key={i} className={`row ${sel && sel.lat === h.lat && sel.lon === h.lon ? 'active' : ''}`} onClick={() => { setSel(h); ctx.onHotspot(h) }}>
                <span className="rank-pill">{i + 1}</span>
                <div className="row-main">
                  <div className="row-t">{h.confidence && <span className={`conf ${h.confidence}`} style={{ marginRight: 6 }}>{h.confidence[0].toUpperCase()}</span>}{h.admin?.district || h.place.label}<span className="muted"> · {h.admin?.locality && h.admin.locality !== h.admin.district ? `${h.admin.locality}, ` : ''}{h.admin?.state || h.admin?.country || h.place.label}</span></div>
                  <div className="row-s">{h.fires} detections · max {h.frp_max.toFixed(0)} MW{h.site_pm25 != null ? ` · PM2.5 ${fmt(h.site_pm25, 0)}` : ''} · monitor {h.nearest_monitor_km != null ? `${h.nearest_monitor_km} km` : hs.official_coverage_known || (h.lat > 6 && h.lat < 37.5 && h.lon > 68 && h.lon < 97.5) ? '>100 km' : 'unknown'}{h.downwind.cities[0] ? ` · → ${h.downwind.cities[0].name}` : ''}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
        <p className="fine">{hs.method}.</p>
      </>)}
    </div>
  )
}

/* ================================================================ TRACE */
export function TracePanel({ ctx }: { ctx: Ctx }) {
  const cid = ctx.selectedCity ?? ctx.pulse?.summary.worst[0]?.id ?? 'delhi'
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const a = ctx.attribution
  const steps = ['Releasing 7 air parcels around the city', 'Running them 48 h backwards through the wind field', 'Matching paths to NASA VIIRS detections', 'Apportioning PM2.5 by source', 'Gemini writes the explanation']
  const at = useSteps(loading, steps, 1100)
  const elapsed = useElapsed(loading)

  useEffect(() => { if (!ctx.selectedCity && cid) ctx.selectCity(cid, false) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cid) return
    let live = true
    setLoading(true); setErr(null); ctx.setAttribution(null)
    const c = ctx.cities.find((x) => x.id === cid)
    if (c) ctx.flyTo(c.lon, c.lat, 1.6e6, -55)
    api.attribution(cid).then((r) => { if (live) ctx.setAttribution(r) }).catch((e) => live && setErr(e.message)).finally(() => live && setLoading(false))
    return () => { live = false }
  }, [cid]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <CityPicker ctx={ctx} value={cid} onChange={(id) => ctx.selectCity(id, false)} />
      {loading && <StepList steps={steps} at={at} elapsed={elapsed} />}
      {err && <div className="err">{err}</div>}
      {a && (<>
        {a.narrative && (
          <div className="card">
            <div className="display" style={{ fontSize: 22, lineHeight: 1.15 }}>{a.narrative.headline}</div>
            <p style={{ margin: '10px 0 0' }}>{a.narrative.explanation}</p>
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}><AiTag model="Gemini" /> <span className="chip">confidence: {a.narrative.confidence}</span></div>
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
                <button key={i} className="row" onClick={() => ctx.openPlace(c.lat, c.lon, 30000)}>
                  <span className="dot" style={{ background: '#ff8a3d' }} />
                  <div className="row-main"><div className="row-t">{c.place.label}</div><div className="row-s">{c.fires} detections · {c.frp.toFixed(0)} MW total · ~{c.transport_h} h in transit</div></div>
                  <span className="mono row-v">{Math.round(c.share * 100)}%</span>
                </button>
              ))}
            </div>
          ) : <div className="muted" style={{ fontSize: 13 }}>No fire smoke on the incoming air paths — local sources dominate.</div>}
        </section>
        <Simulator ctx={ctx} city={a.city} />
        <p className="fine">{a.method}. Indicative receptor-model proxy, not a chemical-transport model.</p>
      </>)}
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
      <div className="sec-h"><h3>Act: response simulator</h3><span className="muted">graded measures</span></div>
      {res && (
        <div className="sim-head">
          <IndexBadge v={res.naqi_before} cat={res.category_before} /><span className="arrow">→</span><IndexBadge v={res.naqi_after} cat={res.category_after} />
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
            <span className="measure-s">{m.owner}{res?.measures.find((r) => r.id === m.id) ? ` · −${res.measures.find((r) => r.id === m.id)!.ugm3} µg` : ''}</span>
          </label>
        ))}
      </div>
      <label className="slider">Enforcement compliance <b className="mono">{Math.round(comp * 100)}%</b>
        <input type="range" min={0.2} max={1} step={0.05} value={comp} onChange={(e) => setComp(+e.target.value)} />
      </label>
      {res?.health && res.health.deaths_avoided > 0 && (
        <div className="health-val">
          <div className="eyebrow">Worth, over a 3-day episode (estimate)</div>
          <div className="hv-row">
            <div><b className="display">~{fmt(res.health.deaths_avoided, res.health.deaths_avoided < 10 ? 1 : 0)}</b><span>premature deaths avoided</span></div>
            <div><b className="display">~{fmt(res.health.admissions_avoided)}</b><span>respiratory hospital admissions avoided</span></div>
            <div><b className="display">{res.health.currency}{fmt(res.health.value, res.health.value < 10 ? 1 : 0)} {res.health.unit}</b><span>health value</span></div>
          </div>
          <p className="fine" style={{ margin: 0 }}>{res.health.method}</p>
        </div>
      )}
      {res && <p className="fine">{res.caveat}</p>}
    </section>
  )
}

/* ================================================================ PLACE (God's-eye) */
export function PlacePanel({ ctx }: { ctx: Ctx }) {
  const pl = ctx.place
  const [d, setD] = useState<PlaceIntel | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [svOk, setSvOk] = useState(true)
  const [big, setBig] = useState<string | null>(null)
  const [sv360, setSv360] = useState(false)
  const elapsed = useElapsed(!!pl && !d && !err)
  useEffect(() => {
    if (!pl) return
    setD(null); setErr(null); setSvOk(true)
    api.place(pl.lat, pl.lon).then(setD).catch((e) => setErr((e as Error).message))
  }, [pl?.lat, pl?.lon]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!pl) return <p className="lede">Click anywhere on the globe to see what is in the air there right now.</p>
  if (err) return <div className="err">{err}</div>
  if (!d) return <div className="stack"><div className="mono muted" style={{ fontSize: 12 }}>{pl.lat.toFixed(4)}, {pl.lon.toFixed(4)}</div><Loading lines={7} label={`Querying Google Air Quality, NASA, CAMS and ground sensors… ${elapsed}s`} /></div>
  const g = d.google_aq, local = g.indexes?.find((i) => i.code !== 'uaqi'), uaqi = g.indexes?.find((i) => i.code === 'uaqi')
  const f = d.forecast.now
  const name = d.place.locality || d.place.district || d.place.nearest_city
  const sv = d.imagery.streetview
  const c3 = ctx.city3d && Math.abs(ctx.city3d.lat - d.lat) < 1e-6 && Math.abs(ctx.city3d.lon - d.lon) < 1e-6 ? ctx.city3d : null
  const key = ctx.meta?.maps_browser_key
  const svUrl = sv.available && key ? `https://www.google.com/maps/embed/v1/streetview?key=${key}&${sv.pano ? `pano=${sv.pano}` : `location=${sv.lat},${sv.lon}&source=outdoor`}&heading=0&pitch=0&fov=90` : null
  return (
    <div className="stack">
      <div>
        <div className="display" style={{ fontSize: 30, lineHeight: 1.05 }}>{name}</div>
        <div className="muted" style={{ fontSize: 13 }}>{d.place.address || `${d.place.nearest_city_km} km from ${d.place.nearest_city}`}</div>
        <div className="mono muted" style={{ fontSize: 11, marginTop: 4 }}>{d.lat.toFixed(5)}, {d.lon.toFixed(5)} · updated {ago(d.fetched_at)}</div>
      </div>
      <div className="btn-row">
        <button className={`btn btn-sm ${c3 ? 'btn-primary' : 'btn-ghost'}`} onClick={() => (c3 ? ctx.exit3D() : ctx.enter3D(d.lat, d.lon, { intel: d, label: name }))}>◳ {c3 ? 'Exit 3D' : '3D city'}</button>
        {sv.available && key && <button className="btn btn-ghost btn-sm" onClick={() => setSv360(true)}>◉ Street View 360°</button>}
        <button className="btn btn-ghost btn-sm" onClick={() => ctx.track(d.lon, d.lat, name)}>⌖ Track</button>
        <button className="btn btn-ghost btn-sm" onClick={() => ctx.flyTo(d.lon, d.lat, 60000, -60)}>Zoom out</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { ctx.setPick({ lat: d.lat, lon: d.lon }); ctx.setMode('citizen') }}>✦ Report here</button>
      </div>
      {c3 && (
        <section className="card city3d">
          <div className="sec-h"><h3>3D city</h3><span className="muted">{c3.mode === 'model' ? 'OpenStreetMap building model' : 'Google Photorealistic 3D'}</span></div>
          <div className="seg wide">
            <button className={c3.mode === 'model' ? 'on' : ''} onClick={() => ctx.enter3D(d.lat, d.lon, { intel: d, label: name, mode: 'model' })}>Building model</button>
            <button className={c3.mode === 'photoreal' ? 'on' : ''} onClick={() => ctx.enter3D(d.lat, d.lon, { intel: d, label: name, mode: 'photoreal' })}>Google photoreal</button>
          </div>
          {c3.mode === 'model' && (c3.loading ? <div className="muted" style={{ fontSize: 13 }}>Loading building footprints from OpenStreetMap…</div>
            : c3.err ? <div className="err">{c3.err}</div>
            : c3.b && <div className="fine" style={{ margin: 0 }}>{fmt(c3.b.count)} buildings within {c3.b.radius_m} m · {Math.round(c3.b.mapped_height_share * 100)}% have mapped heights, the rest use typical heights for their type · {c3.b.source}</div>)}
          {c3.mode === 'photoreal' && <div className="fine" style={{ margin: 0 }}>Google's photogrammetry mesh. Across most of India it is still flat imagery; switch to the building model there.</div>}
          {c3.vis_km != null && c3.pm25 != null && (
            <div className="vis" style={{ marginTop: 10 }}>
              <b className="display">~{c3.vis_km >= 10 ? Math.round(c3.vis_km) : c3.vis_km.toFixed(1)} km</b>
              <span className="muted" style={{ fontSize: 13 }}>estimated visibility: the haze you see is computed from PM2.5 {fmt(c3.pm25, 0)} µg/m³ at {fmt(c3.rh, 0)}% humidity</span>
            </div>
          )}
          <label className="layer-toggle" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={c3.haze} onChange={(e) => ctx.setCity3d((c) => (c ? { ...c, haze: e.target.checked } : c))} /> Show the air (haze from measured particles)
          </label>
        </section>
      )}
      <section className="card live">
        <div className="sec-h"><h3>Right now · measured</h3><span className="muted">Google Air Quality</span></div>
        {local || uaqi ? (
          <div className="live-row">
            {local && <div className="big-idx" style={{ ['--c' as string]: local.color ?? '#9ccc3a' }}><b className="display">{local.aqi}</b><span>{local.name}</span><em>{local.category}</em></div>}
            {uaqi && <div className="big-idx small" style={{ ['--c' as string]: uaqi.color ?? '#9ccc3a' }}><b className="display">{uaqi.aqi}</b><span>Universal AQI</span><em>{uaqi.category}</em></div>}
          </div>
        ) : <div className="muted" style={{ fontSize: 13 }}>Google has no live air-quality coverage here.</div>}
        {g.pollutants && <div className="pol-row">{Object.entries(g.pollutants).slice(0, 6).map(([k, v]) => <span key={k} className="chip mono">{v.name ?? k} {fmt(v.value, 1)}</span>)}</div>}
        {g.health && <p className="fine" style={{ color: 'var(--ink-2)' }}>{g.health}</p>}
      </section>
      <div className="kv-grid">
        <div><span>Wind</span><b className="mono">{fmt(d.weather.wind_kmh, 0)} km/h from {d.weather.wind_from_compass ?? '—'}</b></div>
        <div><span>Temperature · humidity</span><b className="mono">{fmt(d.weather.temp_c, 0)}°C · {fmt(d.weather.rh, 0)}%</b></div>
        <div><span>Mixing height</span><b className="mono">{fmt(d.weather.mixing_height_m, 0)} m</b></div>
        <div><span>Heat detections ≤ 50 km</span><b className="mono">{d.fires.within_50km}</b></div>
        <div><span>Citizen sensors ≤ 10 km</span><b className="mono">{d.citizen_sensors.count}{d.citizen_sensors.median_pm25 != null ? ` · ${d.citizen_sensors.median_pm25} µg` : ''}</b></div>
        <div><span>Official stations ≤ 25 km</span><b className="mono">{d.stations.source ? d.stations.count : 'n/a'}</b></div>
      </div>
      {d.forecast.series && (
        <section>
          <div className="sec-h"><h3>Forecast at this exact spot</h3>{f.peak_category && <IndexBadge v={f.peak72} cat={f.peak_category} />}</div>
          <ForecastChart system={f.system} d={d.forecast.series} height={140} />
          <p className="fine">{d.forecast.source}. {f.stage && f.stage.stage > 0 ? `Peak would trigger ${f.stage.name}.` : ''}</p>
        </section>
      )}
      <section>
        <div className="sec-h"><h3>Satellite, today &amp; yesterday</h3><span className="muted">NASA VIIRS · red = heat</span></div>
        <div className="img-row">
          {d.imagery.satellite.map((s) => (
            <figure key={s.date} className="shot" onClick={() => setBig(s.url)}><img src={s.url} alt={`NASA VIIRS true colour ${s.date}`} loading="lazy" /><figcaption>{s.label} · {s.date}</figcaption></figure>
          ))}
        </div>
      </section>
      {sv.available && (svUrl ? (
        <section>
          <div className="sec-h"><h3>Street level · 360°</h3><button className="btn btn-ghost btn-sm" onClick={() => setSv360(true)}>⤢ Full screen</button></div>
          <iframe className="sv-frame" src={svUrl} title="Google Street View" loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          <p className="fine">Google Street View nearest to this point · captured {sv.date} (not live) · drag to look around.</p>
        </section>
      ) : svOk && (
        <section>
          <div className="sec-h"><h3>Street level</h3><span className="muted">Google Street View · {sv.date}</span></div>
          <figure className="shot wide" onClick={() => setBig(`/api/streetview?lat=${sv.lat}&lon=${sv.lon}`)}>
            <img src={`/api/streetview?lat=${sv.lat}&lon=${sv.lon}`} alt="Street View near this point" loading="lazy" onError={() => setSvOk(false)} />
            <figcaption>Nearest imagery · captured {sv.date} (not live)</figcaption>
          </figure>
        </section>
      ))}
      {d.fires.nearest.length > 0 && (
        <section>
          <div className="sec-h"><h3>Nearest heat detections</h3><span className="muted">NASA FIRMS, 24 h</span></div>
          <div className="list">
            {d.fires.nearest.slice(0, 5).map((x, i) => (
              <button key={i} className="row" onClick={() => ctx.flyTo(x.lon, x.lat, 3500, -45)}>
                <span className="dot" style={{ background: '#ff8a3d' }} />
                <div className="row-main"><div className="row-t">{x.km} km {x.dir}</div><div className="row-s">{x.frp.toFixed(1)} MW · {x.hours_ago} h ago</div></div>
              </button>
            ))}
          </div>
        </section>
      )}
      <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => {
        ctx.setDraftFor({ kind: 'place', lat: d.lat, lon: d.lon, label: name, suggested: d.languages }); ctx.setMode('command')
      }}>▲ Draft alert for this place</button>
      <p className="fine">Authority: {d.authority}. Every number above carries its source; nothing is estimated unless labelled forecast.</p>
      {big && <div className="lightbox" onClick={() => setBig(null)}><img src={big} alt="" /></div>}
      {sv360 && svUrl && createPortal(
        <div className="sv-modal" onClick={() => setSv360(false)}>
          <button className="x" aria-label="Close" onClick={() => setSv360(false)}>×</button>
          <iframe src={svUrl} title="Google Street View 360" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onClick={(e) => e.stopPropagation()} />
        </div>, document.body)}
    </div>
  )
}

/* ================================================================ CITIZEN */
const LANG_CHOICES = ['en', 'hi', 'pa', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'or', 'ur', 'as', 'zh', 'es', 'pt', 'fr', 'ar', 'id', 'sw', 'ru', 'de', 'ja', 'ko', 'vi', 'th', 'tr']

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
  const steps = ['Uploading evidence', 'Gemini reads the photo & listens to the voice note', 'Cross-checking NASA heat detections nearby', 'Checking other reports & forecast PM2.5', 'Resolving jurisdiction (Google Maps)', 'Tracing where the smoke goes next']
  const at = useSteps(busy, steps, 1900)
  const elapsed = useElapsed(busy)
  const selected = ctx.reports.find((r) => r.id === ctx.selectedReport)
  const shown = result ?? selected ?? null

  useEffect(() => { if (shown?.downwind?.paths) ctx.setPlume(shown.downwind.paths) }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selected) ctx.flyTo(selected.lon, selected.lat, 25000, -50) }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
      (p) => { ctx.setPick({ lat: p.coords.latitude, lon: p.coords.longitude }); ctx.flyTo(p.coords.longitude, p.coords.latitude, 20000, -50) },
      () => ctx.setPickMode(true), { timeout: 8000 })
  }
  async function submit() {
    if (!ctx.pick) { setErr('Set the location first — use GPS or tap the globe.'); return }
    setBusy(true); setErr(null); setResult(null)
    const fd = new FormData()
    fd.append('lat', String(ctx.pick.lat)); fd.append('lon', String(ctx.pick.lon)); fd.append('text', text); fd.append('lang', lang)
    photos.forEach((p) => fd.append('photos', p, p.name))
    if (voice) fd.append('voice', voice, voice instanceof File ? voice.name : 'voice.webm')
    try {
      const r = await api.createReport(fd)
      setResult(r); ctx.setSelectedReport(r.id); await ctx.refreshReports()
      setPhotos([]); setVoice(null); setText('')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (shown && !busy) return <ReportResult ctx={ctx} r={shown} onNew={() => { setResult(null); ctx.setSelectedReport(null); ctx.setPlume(null) }} />
  return (
    <div className="stack">
      <p className="lede">Anyone, anywhere, can be a sensor. Snap a photo or speak in your own language — Gemini works out what's burning, satellites check it, and it reaches the official who can stop it.</p>
      <div className="capture">
        <label className="cap-tile">
          <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, 3))} />
          <span className="cap-ic">◐</span><b>{photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : 'Photo'}</b><span className="muted">camera or gallery</span>
        </label>
        <button className={`cap-tile ${recording ? 'rec' : ''}`} onClick={toggleRecord}>
          <span className="cap-ic">{recording ? '■' : '●'}</span><b>{recording ? 'Recording…' : voice ? 'Voice note ✓' : 'Voice'}</b><span className="muted">any language</span>
        </button>
      </div>
      <label className="linkish" style={{ justifySelf: 'start', cursor: 'pointer' }}>
        <input type="file" accept="audio/*" hidden data-testid="voice-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) setVoice(f) }} />
        …or attach a voice note (e.g. forwarded from WhatsApp)
      </label>
      {photos.length > 0 && <div className="thumbs">{photos.map((p) => <img key={p.name} src={URL.createObjectURL(p)} alt="" />)}</div>}
      <textarea className="input" rows={3} placeholder="Optional: describe what you see — in any language" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="btn-row">
        <select className="select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Your language">
          {LANG_CHOICES.map((l) => <option key={l} value={l}>{LANG_NAMES[l] ?? l}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={locate}>⌖ My location</button>
        <button className={`btn btn-ghost btn-sm ${ctx.pickMode ? 'on' : ''}`} onClick={() => ctx.setPickMode(!ctx.pickMode)}>Tap globe</button>
      </div>
      {ctx.pick && <div className="muted mono" style={{ fontSize: 12 }}>📍 {ctx.pick.lat.toFixed(4)}, {ctx.pick.lon.toFixed(4)}</div>}
      <button className="btn btn-primary" disabled={busy} onClick={submit} style={{ justifyContent: 'center' }}>{busy ? 'Analysing…' : 'Send report'}</button>
      {busy && <StepList steps={steps} at={at} elapsed={elapsed} />}
      {err && <div className="err">{err}</div>}
      <section>
        <div className="sec-h"><h3>Recent reports</h3><span className="muted">{ctx.reports.length}</span></div>
        <div className="list">
          {ctx.reports.slice(0, 12).map((r) => (
            <button key={r.id} className="row" onClick={() => ctx.setSelectedReport(r.id)}>
              {r.thumb ? <img className="row-img" src={r.thumb} alt="" /> : <span className="row-img ph">✦</span>}
              <div className="row-main"><div className="row-t">{r.analysis.source_label}</div><div className="row-s">{r.jurisdiction.locality || r.jurisdiction.city} · {ago(r.created_at)}</div></div>
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
  const a = r.analysis, v = r.verification, sig = v.signals
  const [audio, setAudio] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
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
          <div><span>Real photo (not a drawing/AI)</span><span>{sig.authentic ? '✓ yes' : '✕ no'}</span><span /></div>
        </div>
        {v.nearby_fires[0] && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Nearest NASA heat detection: {v.nearby_fires[0].km} km, {v.nearby_fires[0].hours_ago} h ago, {v.nearby_fires[0].frp} MW</div>}
      </section>
      <section className="card">
        <div className="sec-h"><h3>Routed to</h3></div>
        <div className="display" style={{ fontSize: 18 }}>{r.jurisdiction.route_to}</div>
        <div className="muted" style={{ fontSize: 13 }}>{[r.jurisdiction.locality, r.jurisdiction.district, r.jurisdiction.state].filter(Boolean).join(' · ')}</div>
        {r.downwind.cities.length > 0 && <div style={{ marginTop: 8 }}>Smoke heads toward <b>{r.downwind.cities.map((c) => `${c.name} (~${c.eta_h} h)`).join(', ')}</b></div>}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => ctx.openPlace(r.lat, r.lon, 9000)}>⌖ Live view</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { ctx.setDraftFor({ kind: 'report', report_id: r.id, label: a.source_label }); ctx.setMode('command') }}>▲ Escalate as order</button>
        </div>
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
      <p className="lede">Pollution doesn't respect city limits. India's six economic corridors, 72 hours ahead, every 6 hours — so a spike in Ludhiana warns Delhi before it arrives.</p>
      {ctx.corridors.map((c) => (
        <div key={c.id} className="card corridor" onClick={() => {
          const lons = c.path.map((p) => p[0]), lats = c.path.map((p) => p[1])
          const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats))
          ctx.flyTo((Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2, Math.max(4e5, span * 1.6e5), -60)
        }}>
          <div className="sec-h">
            <div><h3>{c.name}</h3><div className="muted" style={{ fontSize: 12 }}>{c.kind} · {fmt(c.pop_m, 1)} M people · {c.strip.length} cities</div></div>
            <IndexBadge v={c.peak72} cat={c.peak_category} />
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
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{c.blurb} Worst: <b style={{ color: 'var(--ink)' }}>{c.worst_city}</b> around {istTime(c.worst_time)} IST.</div>
        </div>
      ))}
    </div>
  )
}

/* ================================================================ COMMAND */
const FLOW = ['draft', 'approved', 'dispatched', 'acknowledged', 'resolved']
const ALL_LANGS = Object.keys(LANG_NAMES)

function Composer({ ctx, target, onDone, onCancel }: { ctx: Ctx; target: DraftFor; onDone: (a: Alert) => void; onCancel: () => void }) {
  const city = target.city ? ctx.cities.find((c) => c.id === target.city) : null
  const [langs, setLangs] = useState<string[]>(() => {
    const local = target.suggested ?? (city ? (city.india ? ctx.meta?.states?.[city.state]?.languages : ctx.meta?.country_languages?.[city.country]) ?? [] : [])
    return ['en', ...local.filter((l) => l !== 'en')].slice(0, 3)
  })
  const [imagery, setImagery] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const elapsed = useElapsed(busy)
  const steps = ['Assembling forecast, sources & jurisdiction', imagery ? 'Fetching today’s NASA satellite image; Gemini reads it' : 'Skipping imagery', 'Gemini drafts the order', 'Writing advisories: ' + langs.map((l) => LANG_NAMES[l] ?? l).join(', ')]
  const at = useSteps(busy, steps, 5500)
  async function go() {
    setBusy(true); setErr(null)
    const body: DraftBody = { kind: target.kind, city: target.city, report_id: target.report_id, lat: target.lat, lon: target.lon, languages: langs, attach_imagery: imagery, audience: target.audience }
    try { onDone(await api.draftAlert(body)) } catch (e) {
      setErr((e as Error).name === 'AbortError' ? 'The AI took too long (over 95 s). Please retry — a faster model is used automatically.' : (e as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <div className="card focus-gold">
      <div className="sec-h"><h3>New order · {target.label ?? target.kind}</h3><button className="x" onClick={onCancel} aria-label="Cancel">×</button></div>
      <div className="eyebrow">Languages (English + local, up to 4)</div>
      <div className="chips-row">
        {langs.map((l) => <button key={l} className="chip chip-btn on" onClick={() => setLangs(langs.filter((x) => x !== l))} title="Remove">{LANG_NAMES[l] ?? l} ×</button>)}
        {langs.length < 4 && (
          <select className="select mini-select" value="" onChange={(e) => e.target.value && setLangs([...langs, e.target.value])} aria-label="Add language">
            <option value="">+ add</option>
            {ALL_LANGS.filter((l) => !langs.includes(l)).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
          </select>
        )}
      </div>
      <label className="check"><input type="checkbox" checked={imagery} onChange={(e) => setImagery(e.target.checked)} /> Attach today’s NASA satellite image (Gemini describes it)</label>
      {busy ? <StepList steps={steps} at={at} elapsed={elapsed} /> : <button className="btn btn-primary" style={{ justifyContent: 'center' }} disabled={!langs.length} onClick={go}>✦ Draft with Gemini</button>}
      {err && <div className="err">{err} <button className="btn btn-ghost btn-sm" onClick={go}>Retry</button></div>}
    </div>
  )
}

export function CommandPanel({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState<Alert | null>(null)
  const [target, setTarget] = useState<DraftFor | null>(null)
  useEffect(() => { if (ctx.draftFor) { setTarget(ctx.draftFor); setOpen(null); ctx.setDraftFor(null) } }, [ctx.draftFor]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {  // the Copilot can hand over a freshly drafted order
    if (!ctx.openAlertId) return
    const id = ctx.openAlertId
    ctx.setOpenAlertId(null)
    api.alerts().then((r) => { const a = r.alerts.find((x) => x.id === id); if (a) { setOpen(a); setTarget(null) } }).catch(() => {})
  }, [ctx.openAlertId]) // eslint-disable-line react-hooks/exhaustive-deps
  const spikes = ctx.cities.filter((c) => c.spike).sort((a, b) => b.spike!.peak_category.level - a.spike!.peak_category.level || b.spike!.peak - a.spike!.peak).slice(0, 8)
  if (open) return <AlertView ctx={ctx} a={open} onBack={() => setOpen(null)} onUpdate={setOpen} />
  return (
    <div className="stack">
      <p className="lede">From forecast to action. Gemini drafts the order and public advisories in English and local languages, with today's satellite image as evidence; a human officer approves every dispatch.</p>
      {target && <Composer ctx={ctx} target={target} onCancel={() => setTarget(null)} onDone={(a) => { setTarget(null); setOpen(a); ctx.refreshAlerts() }} />}
      <section>
        <div className="sec-h"><h3>Needs action</h3><span className="muted">forecast spikes worldwide</span></div>
        <div className="list">
          {spikes.map((c) => (
            <div key={c.id} className="row">
              <span className="dot" style={{ background: c.spike!.peak_category.color }} />
              <div className="row-main"><div className="row-t">{c.name} <span className="muted">· {c.india ? c.state_name : c.country_name}</span></div><div className="row-s">{c.spike!.grap.name} in ~{c.spike!.lead_hours} h · {c.authority.primary_short}</div></div>
              <button className="btn btn-ghost btn-sm" onClick={() => setTarget({ kind: 'city', city: c.id, label: c.name })}>Draft</button>
            </div>
          ))}
          {!spikes.length && <div className="muted" style={{ fontSize: 13 }}>No forecast spikes. Draft for any place from its live view (click the globe).</div>}
        </div>
      </section>
      <section>
        <div className="sec-h"><h3>Action ledger</h3><span className="muted">{ctx.alerts.length}</span></div>
        <div className="list">
          {ctx.alerts.map((a) => (
            <button key={a.id} className="row" onClick={() => setOpen(a)}>
              <span className={`sev-dot sev-${a.draft.severity}`} />
              <div className="row-main"><div className="row-t">{a.draft.title}</div><div className="row-s">{a.target.name} · {a.languages.map((l) => LANG_NAMES[l] ?? l).join(', ')} · {ago(a.created_at)}</div></div>
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
  const [lang, setLang] = useState(d.advisories.find((x) => x.lang === 'en')?.lang ?? d.advisories[0]?.lang ?? 'en')
  const [speaking, setSpeaking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [big, setBig] = useState<string | null>(null)
  const adv = d.advisories.find((x) => x.lang === lang) ?? d.advisories[0]
  const idx = FLOW.indexOf(a.status)
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null
  const verb: Record<string, string> = { approved: 'Approve', dispatched: 'Dispatch', acknowledged: 'Mark acknowledged', resolved: 'Mark resolved' }
  const ai = a.evidence?.find((e) => e.ai)?.ai
  return (
    <div className="stack">
      <button className="back" onClick={onBack}>← Ledger</button>
      <div>
        <span className={`sev-pill sev-${d.severity}`}>{d.severity}</span>
        <div className="display" style={{ fontSize: 24, lineHeight: 1.15, marginTop: 8 }}>{d.title}</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>To: {a.context?.authority ?? '—'}</div>
      </div>
      <div className="flow">{FLOW.map((s, i) => <div key={s} className={i <= idx ? 'on' : ''}><i />{s}</div>)}</div>
      <p style={{ margin: 0 }}>{d.situation}</p>
      {!!a.evidence?.length && (
        <section>
          <div className="sec-h"><h3>Evidence attached</h3><span className="muted">live imagery</span></div>
          <div className="img-row">
            {a.evidence.map((e, i) => (
              <figure key={i} className="shot" onClick={() => setBig(e.url)}>
                <img src={e.url} alt={e.source} loading="lazy" />
                <figcaption>{e.kind === 'satellite' ? `NASA VIIRS · ${e.date}` : `Street View · ${e.date ?? ''}`}</figcaption>
              </figure>
            ))}
          </div>
          {ai && (
            <div className="quote" style={{ marginTop: 8 }}><div className="eyebrow">Gemini reads the satellite image</div>{ai.observation}
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>smoke visible: {ai.visible_smoke ? 'yes' : 'no'} · haze: {ai.visible_haze ? 'yes' : 'no'} · clouds: {ai.cloud_cover}</div></div>
          )}
        </section>
      )}
      <section className="card">
        <div className="sec-h"><h3>Ordered actions</h3></div>
        <div className="actions">
          {d.actions.map((x, i) => (
            <div key={i} className="action"><span className="mono num-b">{i + 1}</span>
              <div><div className="row-t">{x.action}</div><div className="row-s">{x.owner}{x.why ? ` — ${x.why}` : ''}</div></div>
              <span className="chip mono">≤ {x.within_hours} h</span></div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="sec-h"><h3>Public advisory</h3>
          <div className="seg">{d.advisories.map((x) => <button key={x.lang} className={x.lang === lang ? 'on' : ''} onClick={() => setLang(x.lang)}>{LANG_NAMES[x.lang] ?? x.lang}</button>)}</div>
        </div>
        {adv && <div className="bubble" dangerouslySetInnerHTML={{ __html: mdLite(adv.text) }} />}
        <button className="btn btn-ghost btn-sm" disabled={speaking || !adv} onClick={async () => {
          try { setSpeaking(true); const u = await api.tts(adv!.text.slice(0, 850)); await new Audio(u).play() } catch { /* optional */ } finally { setSpeaking(false) }
        }}>{speaking ? 'Synthesising…' : '▶ Play voice advisory (IVR / radio)'}</button>
      </section>
      <section className="phone"><div className="eyebrow">SMS · cell broadcast preview</div><div className="sms">{d.sms}</div></section>
      {d.review_note && <div className="callout warn"><b>Officer check:</b> {d.review_note}</div>}
      {next && (
        <button className="btn btn-primary" style={{ justifyContent: 'center' }} disabled={busy} onClick={async () => {
          setBusy(true); try { const u = await api.alertStatus(a.id, next); onUpdate(u); ctx.refreshAlerts() } finally { setBusy(false) }
        }}>{busy ? '…' : `${verb[next]} →`}</button>
      )}
      <section>
        <div className="sec-h"><h3>Ledger</h3></div>
        <ol className="ledger">
          {a.timeline.map((t, i) => <li key={i}><b>{t.status}</b> · {t.by} · <span className="muted">{istTime(t.at)} IST</span>{t.channels && <div className="muted" style={{ fontSize: 12 }}>{t.channels.join(' · ')}</div>}</li>)}
        </ol>
      </section>
      <AiTag model={a.ai.model} ms={a.ai.ms} />
      {big && <div className="lightbox" onClick={() => setBig(null)}><img src={big} alt="" /></div>}
    </div>
  )
}

/* ================================================================ COMMONS */
export function CommonsPanel({ ctx }: { ctx: Ctx }) {
  const c = ctx.commons
  const [dp, setDp] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => { ctx.flyTo(40, 20, 2.1e7, -90) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <Loading lines={6} label="Loading the forecast accuracy report…" />
  const s = c.summary
  const groups = new Map<string, typeof c.nodes>()
  for (const n of c.nodes) { const k = n.federation ?? 'Global'; groups.set(k, [...(groups.get(k) ?? []), n]) }
  return (
    <div className="stack">
      <p className="lede"><b>Why trust our forecasts?</b> Global air-quality models (like Europe's CAMS) are good but miss local reality: they run too high in some places and too low in others. Albedo-Watch corrects them with local ground measurements, <b>without anyone handing over their raw data</b>.</p>
      <div className="explain card">
        <ol>
          <li><b>Each state or country learns locally.</b> It compares the global forecast with its own monitors and learns a small correction.</li>
          <li><b>Only the lessons are shared.</b> Nodes send model weights (a few KB), never their measurements. This is <i>federated learning</i>.</li>
          <li><b>Neighbours pool what they learn.</b> Regions such as the Indian states, South Asia or Europe average their corrections, so a place with no monitors still gets a better forecast.</li>
        </ol>
        <div className="fine" style={{ marginTop: 6 }}>Tested on the last 18 hours, which the models never saw. The map shows each node linked to its regional federation.</div>
      </div>
      <div className="stats-2">
        <Stat value={`−${s.improvement_pct}%`} label="less forecast error than the raw global model" tone="var(--albedo)" />
        <Stat value={`−${s.zero_data_improvement_pct}%`} label="less error even for a place with no monitors of its own" tone="var(--wind)" />
        <Stat value={`${s.nodes}`} label={`nodes in ${Object.keys(s.federations ?? {}).length || 1} regional federations`} />
        <Stat value={`${fmt(s.raw_bytes_kept_local / 1024, 0)} KB`} label={`of measurements stayed where they were collected · only ${fmt(s.bytes_shared / 1024, 0)} KB of model weights moved`} />
      </div>
      <section>
        <div className="sec-h"><h3>Mean abs. error, PM2.5 (µg/m³)</h3><span className="muted">held-out 18 h · lower is better</span></div>
        <HBars rows={[
          { label: 'Global model (CAMS)', value: s.mae_cams },
          ...(s.mae_global != null ? [{ label: 'One planet-wide model', value: s.mae_global, note: 'biases differ by region' }] : []),
          { label: 'Regional federations', value: s.mae_federated, accent: true },
          { label: 'Each node alone', value: s.mae_local },
          { label: 'Federated + personalised', value: s.mae_personalised, accent: true },
          { label: 'Node with zero data', value: s.mae_zero_data, accent: true },
        ]} />
      </section>
      <section>
        <div className="sec-h"><h3>Convergence</h3><span className="muted">{s.rounds} FedAvg rounds · {s.train_ms} ms</span></div>
        <RoundsChart rounds={c.rounds} baseline={s.mae_cams} />
      </section>
      <section className="card">
        <div className="sec-h"><h3>Retrain the federations</h3></div>
        <label className="slider">Differential-privacy noise σ <b className="mono">{dp.toFixed(2)}</b>
          <input type="range" min={0} max={0.1} step={0.01} value={dp} onChange={(e) => setDp(+e.target.value)} />
        </label>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { ctx.setCommons(await api.train(30, dp)); await ctx.reloadPulse() } finally { setBusy(false) } }}>{busy ? `Training ${s.nodes} nodes…` : '⬡ Run 30 rounds'}</button>
      </section>
      <section>
        <div className="sec-h"><h3>Federations</h3><span className="muted">global-model bias → corrected error</span></div>
        {[...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([g, nodes]) => (
          <div key={g} className="fed-group">
            <div className="eyebrow" style={{ margin: '10px 0 4px' }}>{g} · {nodes.length}</div>
            <div className="nodes">
              {[...nodes].sort((a, b) => b.mae_cams - a.mae_cams).map((n) => (
                <div key={n.state} className="node">
                  <span>{n.name} <span className="muted">({n.authority})</span></span>
                  <span className="mono" style={{ color: n.bias_cams > 0 ? '#f08a24' : '#6fe3ff' }}>{n.bias_cams > 0 ? '+' : ''}{n.bias_cams}</span>
                  <span className="mono muted">{n.mae_cams}</span>
                  <span className="mono" style={{ color: n.mae_personalised < n.mae_cams ? 'var(--good)' : 'var(--ink-2)' }}>{n.mae_personalised}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
      <section className="card">
        <div className="sec-h"><h3>Open by design — a Digital Public Good</h3></div>
        <div className="links">
          <a href="/api/interop/schema" target="_blank" rel="noreferrer">Open Air Event Protocol (JSON Schema) ↗</a>
          <a href="/api/interop/events.geojson" target="_blank" rel="noreferrer">Live OAEP event feed (GeoJSON) ↗</a>
          <a href="/api/commons" target="_blank" rel="noreferrer">Model card + weights (CC-BY-4.0) ↗</a>
        </div>
      </section>
    </div>
  )
}

/* ================================================================ ASK */
type SR = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void; stop: () => void }

const TOOL_IC: Record<string, string> = { find_place: '⌖', city_air: '◉', worst_air: '▲', hidden_hotspots: '◎', trace_sources: '↶',
  sensitive_sites: '⛨', place_air: '⌖', simulate_measures: '⚖', draft_order: '✎' }

export function AskDrawer({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [msgs, setMsgs] = useState<{ role: 'u' | 'a'; text: string; model?: string | null; steps?: CopilotStep[] }[]>([])
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceLang, setVoiceLang] = useState('en-IN')
  const srRef = useRef<SR | null>(null)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = body.current  // scroll the chat only, never the page behind it
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy])
  useEffect(() => () => { srRef.current?.stop() }, [])
  const SRClass = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition
  const elapsed = useElapsed(busy)
  async function send(text: string) {
    if (!text.trim() || busy) return
    const history = [...msgs, { role: 'u' as const, text }].slice(-8).map((m) => ({ role: m.role === 'u' ? 'user' as const : 'assistant' as const, text: m.text }))
    setMsgs((m) => [...m, { role: 'u', text }]); setQ(''); setBusy(true)
    try {
      const r = await api.copilot(history)
      setMsgs((m) => [...m, { role: 'a', text: r.answer, model: r.model, steps: r.steps }])
      ctx.runActions(r.actions)  // the globe follows the agent: fly, open Detect, Protect, the draft order…
    } catch {
      try { const r = await api.ask(text, ctx.selectedCity ?? undefined); setMsgs((m) => [...m, { role: 'a', text: r.answer, model: r.model }]) }
      catch { setMsgs((m) => [...m, { role: 'a', text: 'Sorry — I could not reach the assistant.' }]) }
    } finally { setBusy(false) }
  }
  function listen() {
    if (!SRClass) return
    if (listening) { srRef.current?.stop(); return }
    const sr = new SRClass(); sr.lang = voiceLang; sr.interimResults = false
    sr.onresult = (e) => send(e.results[0][0].transcript)
    sr.onend = () => setListening(false)
    srRef.current = sr; sr.start(); setListening(true)
  }
  const samples = ['Which schools in Delhi should keep children indoors tomorrow? Draft a notice to principals in Hindi.',
    'Where is the smoke over Lahore coming from, and what would cut it fastest?', 'Show me unmonitored fires in India right now.',
    'சென்னையில் குழந்தைகள் இன்று வெளியே விளையாடலாமா?', '¿Cómo está el aire en Ciudad de México hoy?']
  return (
    <div className="ask glass fade-up" role="dialog" aria-label="Ask Albedo">
      <div className="sec-h" style={{ padding: '14px 16px 0' }}>
        <div><div className="eyebrow">✦ Albedo Copilot</div><div className="muted" style={{ fontSize: 12 }}>Asks the live data, then acts on the map · any language · type or speak</div></div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="ask-body scroll-y" ref={body}>
        {!msgs.length && <div className="samples">{samples.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {!!m.steps?.length && (
              <div className="cop-steps">
                {m.steps.map((s, k) => <div key={k} className={`cop-step ${s.ok ? '' : 'bad'}`}><span className="mono">{TOOL_IC[s.tool] ?? '•'} {s.tool.replace(/_/g, ' ')}</span><span>{s.summary}</span></div>)}
              </div>
            )}
            <div dangerouslySetInnerHTML={{ __html: mdLite(m.text) }} />
            {m.role === 'a' && (
              <div className="msg-foot">
                {m.model && <AiTag model={m.model} />}
                <button className="linkish" onClick={async () => { try { const u = await api.tts(m.text.slice(0, 850)); new Audio(u).play() } catch { /* optional */ } }}>▶ listen</button>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg a"><div className="typing"><i /><i /><i /></div><div className="muted mono" style={{ fontSize: 11, marginTop: 6 }}>{elapsed < 4 ? 'planning' : elapsed < 12 ? 'calling Albedo-Watch tools' : elapsed < 30 ? 'reading live data' : 'drafting'} · {elapsed}s</div></div>}
      </div>
      <form className="ask-in" onSubmit={(e) => { e.preventDefault(); send(q) }}>
        {SRClass && (<>
          <select className="select mini" value={voiceLang} onChange={(e) => setVoiceLang(e.target.value)} aria-label="Voice language">
            {[['en-IN', 'EN'], ['hi-IN', 'हि'], ['ta-IN', 'த'], ['bn-IN', 'বা'], ['te-IN', 'తె'], ['mr-IN', 'म'], ['pa-IN', 'ਪੰ'], ['es-ES', 'ES'], ['pt-BR', 'PT'], ['fr-FR', 'FR'], ['zh-CN', '中'], ['ar-SA', 'ع']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="button" className={`mic ${listening ? 'on' : ''}`} onClick={listen} aria-label="Speak">●</button>
        </>)}
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about any city, any language…" />
        <button className="btn btn-primary btn-sm" disabled={busy}>Ask</button>
      </form>
    </div>
  )
}
