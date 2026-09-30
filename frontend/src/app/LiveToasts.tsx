import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LiveItem } from '../lib/api'
import { api } from '../lib/api'
import { ago } from '../lib/format'

const KIND: Record<LiveItem['kind'], { label: string; ic: string }> = {
  citizen: { label: 'Citizen report', ic: '✦' },
  news: { label: 'News photo', ic: '◧' },
  satellite: { label: 'Satellite', ic: '◉' },
}
const FIRST_MS = 5000, EVERY_MS = 17000, SHOW_MS = 9500

/**
 * Real-time notifications with pictures, each pinned to a place on the globe. One at a
 * time, newest first, never repeating within a session; hover holds a card open.
 */
export function LiveToasts({ enabled, country, onPing, onOpen }: {
  enabled: boolean; country: string | null
  onPing: (it: LiveItem) => void; onOpen: (it: LiveItem) => void
}) {
  const [items, setItems] = useState<LiveItem[]>([])
  const [cur, setCur] = useState<LiveItem | null>(null)
  const seen = useRef<Set<string>>(new Set((() => { try { return JSON.parse(sessionStorage.getItem('aw-live-seen') ?? '[]') as string[] } catch { return [] } })()))
  const hold = useRef(false)

  useEffect(() => {
    let live = true
    const load = () => api.live().then((r) => live && setItems(r.items)).catch(() => {})
    load()
    const iv = setInterval(load, 90_000)
    return () => { live = false; clearInterval(iv) }
  }, [])

  useEffect(() => {
    if (!enabled || !items.length) return
    let hide: number | undefined
    const next = () => {
      if (hold.current) return
      const pool = items.filter((i) => !seen.current.has(i.id) && (!country || !i.country || i.country === country))
      // alternate sources so the stream never becomes one publisher's feed
      const lastKind = cur?.kind
      const it = pool.find((i) => i.kind !== lastKind) ?? pool[0]
      if (!it) return
      seen.current.add(it.id)
      try { sessionStorage.setItem('aw-live-seen', JSON.stringify([...seen.current].slice(-300))) } catch { /* private mode */ }
      setCur(it); onPing(it)
      window.clearTimeout(hide)
      hide = window.setTimeout(() => { if (!hold.current) setCur(null) }, SHOW_MS)
    }
    const first = window.setTimeout(next, FIRST_MS)
    const iv = window.setInterval(next, EVERY_MS)
    return () => { window.clearTimeout(first); window.clearInterval(iv); window.clearTimeout(hide) }
  }, [enabled, items, country]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled || !cur) return null
  const k = KIND[cur.kind]
  return (
    <button className={`live-toast glass k-${cur.kind}`} key={cur.id} onClick={() => { onOpen(cur); setCur(null); hold.current = false }}
      onMouseEnter={() => { hold.current = true }} onMouseLeave={() => { hold.current = false; window.setTimeout(() => !hold.current && setCur(null), 2500) }}>
      <span className="lt-img" style={{ backgroundImage: `url("${cur.image}")` }} />
      <span className="lt-body">
        <span className="lt-k mono"><span className="live-dot" /> {k.ic} {k.label.toUpperCase()} · {cur.place}</span>
        <span className="lt-t">{cur.title}</span>
        <span className="lt-s">{cur.source} · {ago(cur.t)}</span>
      </span>
    </button>
  )
}

export function LiveDetail({ it, onClose, onReport, onPlace }: {
  it: LiveItem; onClose: () => void; onReport: (id: string) => void; onPlace: (lat: number, lon: number) => void
}) {
  return createPortal(
    <div className="live-modal" onClick={onClose}>
      <div className="live-card glass fade-up" onClick={(e) => e.stopPropagation()}>
        <button className="x" aria-label="Close" onClick={onClose}>×</button>
        <img src={it.image} alt={it.title} />
        <div className="live-card-body">
          <div className="eyebrow">{KIND[it.kind].label} · {it.place} · {ago(it.t)}</div>
          <div className="display" style={{ fontSize: 22, lineHeight: 1.2 }}>{it.title}</div>
          <div className="muted" style={{ fontSize: 13 }}>{it.source}</div>
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" onClick={() => { onPlace(it.lat, it.lon); onClose() }}>⌖ Live air at this place</button>
            {it.report && <button className="btn btn-ghost btn-sm" onClick={() => { onReport(it.report!); onClose() }}>✦ Open the report</button>}
            {it.url && <a className="btn btn-ghost btn-sm" href={it.url} target="_blank" rel="noreferrer noopener">Read at source ↗</a>}
          </div>
          {it.kind === 'news' && <p className="fine">Photo and headline belong to the publisher; Albedo-Watch places the story on the globe from the city it names (GDELT news index).</p>}
        </div>
      </div>
    </div>, document.body)
}
