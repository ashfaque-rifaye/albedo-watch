import { useEffect, useMemo, useState } from 'react'
import type { City, ProtectData } from '../lib/api'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import type { Ctx } from './MissionControl'

const TYPE_IC: Record<string, string> = { Hospital: '✚', Clinic: '✚', 'Health centre': '✚', School: '▣', 'Pre-school': '▣', College: '▣', University: '▣' }

function pickDefault(ctx: Ctx): string | null {
  if (ctx.protectCity) return ctx.protectCity
  if (ctx.selectedCity) return ctx.selectedCity
  // your hub's nearest city first, then the worst forecast in your country (India by default)
  if (ctx.hub) {
    const near = [...ctx.cities].sort((a, b) => Math.hypot(a.lat - ctx.hub!.lat, a.lon - ctx.hub!.lon) - Math.hypot(b.lat - ctx.hub!.lat, b.lon - ctx.hub!.lon))[0]
    if (near) return near.id
  }
  const cc = ctx.country ?? 'IN'
  const spike = [...ctx.cities].filter((c) => c.spike && c.country === cc).sort((a, b) => b.spike!.peak - a.spike!.peak)[0]
  return spike?.id ?? ctx.cities.find((c) => c.id === 'delhi')?.id ?? null
}

export function ProtectPanel({ ctx }: { ctx: Ctx }) {
  const [cid, setCid] = useState<string | null>(() => pickDefault(ctx))
  const [d, setD] = useState<ProtectData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const city: City | undefined = useMemo(() => ctx.cities.find((c) => c.id === cid), [ctx.cities, cid])

  useEffect(() => { if (!cid) { const x = pickDefault(ctx); if (x) setCid(x) } }, [ctx.cities.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ctx.protectCity && ctx.protectCity !== cid) setCid(ctx.protectCity) }, [ctx.protectCity]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cid) return
    let live = true
    setD(null); setErr(null)
    const c = ctx.cities.find((x) => x.id === cid)
    if (c) ctx.flyTo(c.lon, c.lat, 60000, -55)
    api.protectCity(cid).then((r) => { if (live) { setD(r); ctx.setSites(r.points) } }).catch((e) => live && setErr((e as Error).message))
    return () => { live = false }
  }, [cid]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => ctx.setSites(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  const draft = (audience: 'schools' | 'hospitals') => {
    if (!city) return
    ctx.setDraftFor({ kind: 'city', city: city.id, label: `${city.name} · ${audience === 'schools' ? 'school principals' : 'hospitals & clinics'}`, audience })
    ctx.setMode('command')
  }
  const w = d?.windows_text
  return (
    <div className="stack">
      <p className="lede">Children, patients and the elderly feel bad air first. For any city, Albedo-Watch finds the <b>schools, hospitals and clinics</b> in the smoke and turns the hourly forecast into instructions they can follow today.</p>
      <select className="select" value={cid ?? ''} onChange={(e) => setCid(e.target.value)} aria-label="City">
        <option value="" disabled>Choose a city…</option>
        {[...ctx.cities].sort((a, b) => (b.spike ? 1 : 0) - (a.spike ? 1 : 0) || a.name.localeCompare(b.name)).map((c) => (
          <option key={c.id} value={c.id}>{c.spike ? '▲ ' : ''}{c.name} · {c.india ? c.state_name : c.country_name}</option>
        ))}
      </select>
      {err && <div className="err">{err}</div>}
      {!d && !err && <div className="muted" style={{ fontSize: 13 }}>Finding schools and hospitals on OpenStreetMap…</div>}
      {d && (<>
        <div className="stats-2">
          <div className="stat"><b className="display" style={{ color: '#f7d36a' }}>{fmt(d.schools)}</b><span>schools, colleges &amp; pre-schools within {d.radius_km} km</span></div>
          <div className="stat"><b className="display" style={{ color: '#ff8fa3' }}>{fmt(d.health)}</b><span>hospitals &amp; clinics — patients with lung and heart disease</span></div>
        </div>
        <section className="card">
          <div className="sec-h"><h3>Today, hour by hour</h3><span className="muted">{d.index_system} now {d.now} · peak {d.peak72}</span></div>
          <div className="win-row"><span className="win-k ok">Outdoor OK</span>
            {w?.outdoor_ok.length ? w.outdoor_ok.map((x) => <span key={x} className="chip mono win ok">{x}</span>) : <span className="muted" style={{ fontSize: 13 }}>no clean daytime window in the next 24 h — move sports and assembly indoors</span>}
          </div>
          <div className="win-row"><span className="win-k bad">Keep indoors</span>
            {w?.stay_indoors.length ? w.stay_indoors.map((x) => <span key={x} className="chip mono win bad">{x}</span>) : <span className="muted" style={{ fontSize: 13 }}>no Poor-or-worse hours forecast</span>}
          </div>
          <p className="fine" style={{ margin: '6px 0 0' }}>Local time. "Outdoor OK" = Good/Satisfactory air (sensitive-group threshold) between 06:00 and 20:00; "Keep indoors" = Poor or worse.</p>
        </section>
        <div className="btn-row">
          <button className="btn btn-primary btn-sm" onClick={() => draft('schools')}>▲ Advisory to school principals</button>
          <button className="btn btn-ghost btn-sm" onClick={() => draft('hospitals')}>▲ Advisory to hospitals</button>
        </div>
        <div className="chips-row">{Object.entries(d.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k} className="chip">{TYPE_IC[k] ?? '•'} {k} {fmt(v)}</span>)}</div>
        <section>
          <div className="sec-h"><h3>Nearest named sites</h3><span className="muted">hospitals and pre-schools first</span></div>
          <div className="list">
            {d.top.slice(0, 14).map((s, i) => (
              <button key={i} className="row" onClick={() => ctx.openPlace(s.lat, s.lon, 2600)}>
                <span className={`site-ic ${s.group}`}>{TYPE_IC[s.type] ?? '•'}</span>
                <div className="row-main"><div className="row-t">{s.name}</div><div className="row-s">{s.type} · {s.km} km from centre</div></div>
              </button>
            ))}
          </div>
        </section>
        <p className="fine">{d.source}. Yellow squares = schools, pink crosses = hospitals and clinics on the globe.</p>
      </>)}
    </div>
  )
}
