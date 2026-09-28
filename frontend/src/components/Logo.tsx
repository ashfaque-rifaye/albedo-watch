import { useId } from 'react'
import './logo.css'

/* Albedo-Watch mark — an eye whose iris is a planet.
   · the lit crescent sweeps across the sphere (albedo: sunlight reflected by Earth)
   · a satellite traces the orbit ring (the watch)
   · a specular glint pulses; the lids blink every few seconds */
export function Logo({ size = 28, animated = true }: { size?: number; animated?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className={`aw-logo ${animated ? 'on' : ''}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <radialGradient id={`sph${id}`} cx="30%" cy="28%" r="80%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".35" stopColor="#f4e7c3" />
          <stop offset=".75" stopColor="#8f7a52" />
          <stop offset="1" stopColor="#2a2418" />
        </radialGradient>
        <linearGradient id={`lid${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#6fe3ff" stopOpacity=".35" />
          <stop offset=".5" stopColor="#f1e6c8" />
          <stop offset="1" stopColor="#6fe3ff" stopOpacity=".35" />
        </linearGradient>
        <clipPath id={`iris${id}`}><circle cx="32" cy="32" r="12.5" /></clipPath>
        <clipPath id={`eye${id}`}><path d="M3 32 C 14 12, 50 12, 61 32 C 50 52, 14 52, 3 32 Z" /></clipPath>
      </defs>
      <g className="aw-lids">
        <path d="M3 32 C 14 12, 50 12, 61 32 C 50 52, 14 52, 3 32 Z" fill="rgba(8,12,18,.55)" stroke={`url(#lid${id})`} strokeWidth="2.2" />
      </g>
      <g clipPath={`url(#eye${id})`}>
        <g className="aw-orbit">
          <ellipse cx="32" cy="32" rx="22" ry="7.5" fill="none" stroke="#6fe3ff" strokeWidth="1.2" strokeDasharray="2 3" opacity=".75" transform="rotate(-18 32 32)" />
        </g>
      </g>
      <g clipPath={`url(#iris${id})`}>
        <circle cx="32" cy="32" r="12.5" fill="#0c0f16" />
        <circle className="aw-day" cx="32" cy="32" r="12.5" fill={`url(#sph${id})`} />
        <circle className="aw-night" cx="32" cy="32" r="12.5" fill="#0a0d14" opacity=".92" />
        <circle cx="27" cy="27" r="1.1" fill="#ff8a3d" className="aw-city" />
        <circle cx="35" cy="30" r=".8" fill="#ffb35c" className="aw-city d2" />
      </g>
      <circle cx="32" cy="32" r="12.5" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth=".6" />
      <circle className="aw-glint" cx="27.5" cy="26.5" r="1.8" fill="#fff" />
      <g transform="rotate(-18 32 32)">
        <g>
          <circle r="4.6" fill="#ff6a2b" opacity=".22" /><circle r="2.1" fill="#ff7a3d" />
          {animated
            ? <animateMotion dur="6s" repeatCount="indefinite" path="M54,32 A22,7.5 0 1,1 10,32 A22,7.5 0 1,1 54,32" />
            : <animateMotion dur="0.01s" fill="freeze" path="M54,32 L54,32" />}
        </g>
      </g>
    </svg>
  )
}

export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span className="aw-word" style={{ fontSize: size }}>
      <span className="aw-w1">Albedo</span><span className="aw-dash">-</span><span className="aw-w2">Watch</span>
    </span>
  )
}
