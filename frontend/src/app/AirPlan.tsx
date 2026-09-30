import { useEffect, useState } from 'react'
import type { PlaceIntel } from '../lib/api'
import { api } from '../lib/api'
import { LEVEL_COLORS } from './Globe'

export const PROFILES: { id: string; label: string; max: number; tip: string }[] = [
  { id: 'general', label: 'Everyone', max: 2, tip: 'Cut long or heavy exertion outdoors when air is Poor or worse.' },
  { id: 'child', label: 'Children', max: 1, tip: 'Move play and sport indoors once air passes Satisfactory; school runs at the cleanest hour.' },
  { id: 'asthma', label: 'Asthma / COPD', max: 1, tip: 'Keep the reliever inhaler with you; avoid traffic corridors; ventilate only in clean hours.' },
  { id: 'elderly', label: 'Older adults', max: 1, tip: 'Walks in the cleanest window; avoid early-morning smog and busy roads.' },
  { id: 'heart', label: 'Heart disease', max: 1, tip: 'Avoid exertion in Moderate-or-worse air; watch for chest pain or breathlessness.' },
  { id: 'pregnant', label: 'Pregnancy', max: 1, tip: 'Limit time near traffic and smoke; a well-fitted N95 helps outdoors on bad days.' },
  { id: 'outdoor_worker', label: 'Outdoor work', max: 2, tip: 'Shift heavy tasks to the cleanest hours; wear an N95 when air is Poor.' },
  { id: 'athlete', label: 'Runners', max: 1, tip: 'Train in the green window; move intervals indoors when the index climbs.' },
]
const KEY = 'aw-profile'

function hourLabel(t: number, tz: number) {
  const d = new Date((t + tz * 3600) * 1000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:00`
}

function urlB64ToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

/** My Air Plan: a health profile turns the hub's hourly forecast into personal safe hours, plus push alerts. */
export function AirPlan({ intel, lat, lon, vapidKey }: { intel: PlaceIntel; lat: number; lon: number; vapidKey: string | null | undefined }) {
  const [profile, setProfile] = useState(() => { try { return localStorage.getItem(KEY) || 'general' } catch { return 'general' } })
  const [push, setPush] = useState<'off' | 'busy' | 'on' | 'denied' | 'unsupported'>('off')
  const [msg, setMsg] = useState<string | null>(null)
  const P = PROFILES.find((p) => p.id === profile) ?? PROFILES[0]
  const s = intel.forecast.series
  const tz = lon > 68 && lon < 97.5 && lat > 6 && lat < 37.5 ? 5.5 : Math.round(lon / 15)

  useEffect(() => { try { localStorage.setItem(KEY, profile) } catch { /* private mode */ } }, [profile])
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !vapidKey) { setPush('unsupported'); return }
    if (Notification.permission === 'denied') { setPush('denied'); return }
    navigator.serviceWorker.getRegistration('/').then((r) => r?.pushManager.getSubscription()).then((sub) => { if (sub) setPush('on') }).catch(() => {})
  }, [vapidKey])

  // next 24 h, hour by hour, judged against this person's threshold
  const hours = s ? s.time.slice(s.now_offset, s.now_offset + 24).map((t, k) => ({ t, lvl: s.level[s.now_offset + k], v: s.index[s.now_offset + k] })) : []
  const good = hours.filter((h) => h.lvl != null && h.lvl <= P.max)
  const daytime = good.filter((h) => { const hr = new Date((h.t + tz * 3600) * 1000).getUTCHours(); return hr >= 5 && hr <= 21 })
  let best: { a: number; b: number } | null = null
  for (let i = 0; i < daytime.length;) {  // longest run of consecutive clean daytime hours
    let j = i
    while (j + 1 < daytime.length && daytime[j + 1].t - daytime[j].t === 3600) j++
    if (!best || daytime[j].t - daytime[i].t > best.b - best.a) best = { a: daytime[i].t, b: daytime[j].t + 3600 }
    i = j + 1
  }

  async function subscribe() {
    setPush('busy'); setMsg(null)
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setPush(perm === 'denied' ? 'denied' : 'off'); return }
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(vapidKey!) })
      await api.pushSubscribe({ subscription: sub.toJSON() as never, lat, lon, profile, label: intel.place.locality || intel.place.nearest_city })
      setPush('on'); setMsg('Alerts on. You will hear from us before the air here turns unhealthy for this profile.')
    } catch (e) { setPush('off'); setMsg(`Could not turn on alerts: ${(e as Error).message}`) }
  }
  async function test() {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) { setPush('off'); return }
    await api.pushSubscribe({ subscription: sub.toJSON() as never, lat, lon, profile, label: intel.place.locality || intel.place.nearest_city })
    const r = await api.pushTest(sub.endpoint).catch(() => null)
    setMsg(r?.sent ? 'Sent — check your notifications.' : 'The push service did not accept the test; try again in a minute.')
  }

  return (
    <div className="airplan">
      <div className="eyebrow">My air plan · next 24 h</div>
      <div className="chips-row">{PROFILES.map((p) => <button key={p.id} className={`chip chip-btn ${p.id === profile ? 'on' : ''}`} onClick={() => setProfile(p.id)}>{p.label}</button>)}</div>
      {hours.length > 0 && (
        <div className="plan-strip" aria-label="Hour by hour">
          {hours.map((h, k) => <i key={k} title={`${hourLabel(h.t, tz)} · ${h.v ?? '—'}`} className={h.lvl != null && h.lvl <= P.max ? 'ok' : 'bad'}
            style={{ background: LEVEL_COLORS[Math.max(0, h.lvl ?? 0)] }} />)}
        </div>
      )}
      <div className="plan-txt">
        {best ? <><b>Best time outside: {hourLabel(best.a, tz)}–{hourLabel(best.b, tz)}</b> for {P.label.toLowerCase()}.</>
          : <b>No clean daytime window in the next 24 h for {P.label.toLowerCase()} — keep activity indoors.</b>} {P.tip}
      </div>
      <div className="btn-row">
        {push === 'on' ? (<>
          <span className="chip" style={{ color: '#7ff0b2' }}>🔔 Alerts on for this hub</span>
          <button className="btn btn-ghost btn-sm" onClick={test}>Send a test alert</button>
        </>) : push === 'unsupported' ? <span className="muted" style={{ fontSize: 12 }}>This browser can't receive push alerts.</span>
          : push === 'denied' ? <span className="muted" style={{ fontSize: 12 }}>Notifications are blocked for this site in your browser settings.</span>
          : <button className="btn btn-primary btn-sm" disabled={push === 'busy'} onClick={subscribe}>{push === 'busy' ? 'Turning on…' : '🔔 Alert me before bad air'}</button>}
      </div>
      {msg && <div className="fine" style={{ margin: 0 }}>{msg}</div>}
    </div>
  )
}
