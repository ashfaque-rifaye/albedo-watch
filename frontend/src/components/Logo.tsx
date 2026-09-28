// Albedo-Watch mark: a half-lit planet (albedo = reflected light) inside a scanning orbit.
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <radialGradient id="aw-g" cx="34%" cy="32%" r="72%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".5" stopColor="#efe2c2" />
          <stop offset="1" stopColor="#1c2029" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="14" fill="url(#aw-g)" />
      <circle cx="32" cy="32" r="24" fill="none" stroke="#6fe3ff" strokeWidth="2" strokeDasharray="3 5" opacity=".85">
        <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="14s" repeatCount="indefinite" />
      </circle>
      <circle cx="56" cy="32" r="3" fill="#ff6a2b">
        <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="14s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}
