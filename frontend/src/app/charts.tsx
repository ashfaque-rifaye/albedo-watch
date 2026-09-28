import { useMemo, useState } from 'react'
import type { Series } from '../lib/api'
import { NAQI_BANDS, fmt, istHour, naqiColor } from '../lib/format'

// Validated (dark surface #0e121b): lightness band, chroma, contrast, normal-vision ΔE pass;
// one CVD pair in the 6–8 floor band → always shipped with gaps + direct labels + legend.
export const SECTOR_COLOR: Record<string, string> = {
  biomass: '#e0561c', transport: '#1a9cc4', industry: '#8c6ef2', dust: '#b98318', residential: '#d6448a', construction: '#3c9f57',
}

/* ---------------------------------------------------------------- forecast */
export function ForecastChart({ s, height = 170 }: { s: Series; height?: number }) {
  const W = 420, H = height, PL = 30, PR = 10, PT = 12, PB = 22
  const [hover, setHover] = useState<number | null>(null)
  const n = s.time.length
  const vals = s.naqi.map((v) => v ?? null)
  const maxV = Math.max(120, ...vals.filter((v): v is number => v != null)) * 1.1
  const x = (k: number) => PL + (k / Math.max(1, n - 1)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - v / maxV) * (H - PT - PB)
  const pts = vals.map((v, k) => (v == null ? null : [x(k), y(v)] as const))
  const line = pts.reduce((acc, p, k) => (p ? acc + `${acc && pts[k - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : acc), '')
  const bands = NAQI_BANDS.filter((_b, i) => (i === 0 ? 0 : NAQI_BANDS[i - 1].max) < maxV)
  const ticks = useMemo(() => s.time.map((t, k) => ({ t, k })).filter(({ k }) => (k - s.now_offset) % 24 === 0), [s])
  const h = hover ?? s.now_offset
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const k = Math.round(((e.clientX - r.left) / r.width * W - PL) / (W - PL - PR) * (n - 1))
          setHover(Math.max(0, Math.min(n - 1, k)))
        }} onMouseLeave={() => setHover(null)}>
        {bands.map((b, i) => {
          const lo = i === 0 ? 0 : NAQI_BANDS[i - 1].max
          const hi = Math.min(b.max, maxV)
          return <rect key={b.label} x={PL} width={W - PL - PR} y={y(hi)} height={y(lo) - y(hi)} fill={b.color} opacity={0.07} />
        })}
        {[100, 200, 300, 400].filter((v) => v < maxV).map((v) => (
          <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,.07)" />
            <text x={PL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#7c8595" className="mono">{v}</text></g>
        ))}
        <rect x={x(s.now_offset)} y={PT} width={W - PR - x(s.now_offset)} height={H - PT - PB} fill="rgba(111,227,255,.035)" />
        <line x1={x(s.now_offset)} x2={x(s.now_offset)} y1={PT} y2={H - PB} stroke="rgba(241,230,200,.5)" strokeDasharray="3 3" />
        <text x={x(s.now_offset) + 4} y={PT + 8} fontSize="9" fill="#f1e6c8" className="mono">NOW → FORECAST</text>
        <defs>
          <linearGradient id="fcg" x1="0" x2="1">
            {vals.map((v, k) => <stop key={k} offset={`${(k / Math.max(1, n - 1)) * 100}%`} stopColor={naqiColor(v)} />)}
          </linearGradient>
        </defs>
        <path d={line} fill="none" stroke="url(#fcg)" strokeWidth={2} strokeLinejoin="round" />
        {ticks.map(({ t, k }) => <text key={k} x={x(k)} y={H - 6} fontSize="9" fill="#7c8595" textAnchor="middle" className="mono">{istHour(t).replace(/,.*/, '')}</text>)}
        {pts[h] && <g>
          <line x1={x(h)} x2={x(h)} y1={PT} y2={H - PB} stroke="rgba(255,255,255,.25)" />
          <circle cx={pts[h]![0]} cy={pts[h]![1]} r={4.5} fill={naqiColor(vals[h])} stroke="#0e121b" strokeWidth={2} />
        </g>}
      </svg>
      {vals[h] != null && (
        <div className="chart-tip" style={{ left: `${(x(h) / W) * 100}%` }}>
          <b className="mono">{vals[h]}</b> NAQI · {istHour(s.time[h])}
          <div className="muted">PM2.5 {fmt(s.pm25[h], 0)} µg/m³ <span style={{ opacity: .7 }}>(CAMS raw {fmt(s.pm25_cams[h], 0)})</span></div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------- stacked shares */
export function SourceBar({ sources }: { sources: { key: string; label: string; share: number; ugm3: number }[] }) {
  const [hover, setHover] = useState<string | null>(null)
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 18, borderRadius: 6, overflow: 'hidden' }}>
        {sources.map((s) => (
          <div key={s.key} title={`${s.label}: ${Math.round(s.share * 100)}%`} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}
            style={{ flex: s.share, background: SECTOR_COLOR[s.key], opacity: hover && hover !== s.key ? 0.35 : 1, transition: 'opacity .2s', minWidth: 3 }} />
        ))}
      </div>
      <div className="src-legend">
        {sources.map((s) => (
          <div key={s.key} className="src-row" onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)} style={{ opacity: hover && hover !== s.key ? 0.45 : 1 }}>
            <span className="dot" style={{ background: SECTOR_COLOR[s.key], borderRadius: 3 }} />
            <span>{s.label}</span>
            <span className="mono muted" style={{ marginLeft: 'auto' }}>{s.ugm3.toFixed(1)} µg</span>
            <b className="mono" style={{ width: 38, textAlign: 'right' }}>{Math.round(s.share * 100)}%</b>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------- horizontal magnitude */
export function HBars({ rows, unit = '', max }: { rows: { label: string; value: number; accent?: boolean; note?: string }[]; unit?: string; max?: number }) {
  const m = max ?? Math.max(...rows.map((r) => r.value)) * 1.05
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {rows.map((r) => (
        <div key={r.label} className="hbar">
          <div className="hbar-label"><span>{r.label}</span>{r.note && <span className="muted" style={{ fontSize: 11 }}>{r.note}</span>}</div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(r.value / m) * 100}%`, background: r.accent ? 'linear-gradient(90deg,#b9a877,#f1e6c8)' : '#3a4150' }} />
            <span className="mono hbar-val">{r.value.toFixed(1)}{unit}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------- convergence */
export function RoundsChart({ rounds, baseline }: { rounds: { round: number; mae: number }[]; baseline: number }) {
  const W = 420, H = 120, PL = 28, PR = 8, PT = 10, PB = 18
  const [hover, setHover] = useState<number | null>(null)
  if (!rounds.length) return null
  const maxV = Math.max(baseline, ...rounds.map((r) => r.mae)) * 1.08
  const minV = Math.min(...rounds.map((r) => r.mae)) * 0.9
  const x = (i: number) => PL + (i / (rounds.length - 1)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - (v - minV) / (maxV - minV)) * (H - PT - PB)
  const d = rounds.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.mae).toFixed(1)}`).join('')
  const hi = hover ?? rounds.length - 1
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}
      onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const i = Math.round(((e.clientX - r.left) / r.width * W - PL) / (W - PL - PR) * (rounds.length - 1)); setHover(Math.max(0, Math.min(rounds.length - 1, i))) }}
      onMouseLeave={() => setHover(null)}>
      <line x1={PL} x2={W - PR} y1={y(baseline)} y2={y(baseline)} stroke="#7c8595" strokeDasharray="4 4" />
      <text x={W - PR} y={y(baseline) - 4} fontSize="9" textAnchor="end" fill="#7c8595" className="mono">global CAMS {baseline.toFixed(1)}</text>
      <path d={d} fill="none" stroke="#f1e6c8" strokeWidth={2} />
      <circle cx={x(hi)} cy={y(rounds[hi].mae)} r={4} fill="#f1e6c8" stroke="#0e121b" strokeWidth={2} />
      <text x={x(hi)} y={y(rounds[hi].mae) + 16} fontSize="10" textAnchor="middle" fill="#f4f6fa" className="mono">r{rounds[hi].round} · {rounds[hi].mae}</text>
      <text x={PL} y={H - 4} fontSize="9" fill="#7c8595" className="mono">round 1</text>
      <text x={W - PR} y={H - 4} fontSize="9" fill="#7c8595" textAnchor="end" className="mono">round {rounds.length}</text>
    </svg>
  )
}

/* -------------------------------------------------------------- sparkline */
export function Spark({ values, now, w = 90, h = 26 }: { values: (number | null)[]; now: number; w?: number; h?: number }) {
  const v = values.map((x) => x ?? 0)
  const max = Math.max(60, ...v)
  const d = v.map((q, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * w).toFixed(1)},${(h - (q / max) * (h - 2) - 1).toFixed(1)}`).join('')
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <line x1={(now / (v.length - 1)) * w} x2={(now / (v.length - 1)) * w} y1={0} y2={h} stroke="rgba(241,230,200,.35)" strokeDasharray="2 2" />
      <path d={d} fill="none" stroke={naqiColor(Math.max(...v.slice(now)))} strokeWidth={1.5} />
    </svg>
  )
}
