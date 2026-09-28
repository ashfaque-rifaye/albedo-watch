export const NAQI_BANDS = [
  { max: 50, label: 'Good', color: '#2bb673' },
  { max: 100, label: 'Satisfactory', color: '#9ccc3a' },
  { max: 200, label: 'Moderate', color: '#f2c230' },
  { max: 300, label: 'Poor', color: '#f08a24' },
  { max: 400, label: 'Very Poor', color: '#e0452b' },
  { max: 10000, label: 'Severe', color: '#9b1c3a' },
]

export function naqiColor(v: number | null | undefined): string {
  if (v == null) return '#4a5261'
  return (NAQI_BANDS.find((b) => v <= b.max) ?? NAQI_BANDS[5]).color
}

export function naqiLabel(v: number | null | undefined): string {
  if (v == null) return 'No data'
  return (NAQI_BANDS.find((b) => v <= b.max) ?? NAQI_BANDS[5]).label
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const IST = 'Asia/Kolkata'
export function istTime(unix: number, withDay = true): string {
  const d = new Date(unix * 1000)
  return d.toLocaleString('en-IN', {
    timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true,
    ...(withDay ? { weekday: 'short' } : {}),
  })
}

export function istHour(unix: number): string {
  return new Date(unix * 1000).toLocaleString('en-IN', { timeZone: IST, hour: 'numeric', hour12: true, weekday: 'short' })
}

export function ago(unix: number): string {
  const s = Date.now() / 1000 - unix
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export const fmt = (v: number | null | undefined, d = 0) => (v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }))
export const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`

export const LANG_NAMES: Record<string, string> = {
  en: 'English', hi: 'हिन्दी', pa: 'ਪੰਜਾਬੀ', ur: 'اردو', bn: 'বাংলা', mai: 'मैथिली', or: 'ଓଡ଼ିଆ', gu: 'ગુજરાતી', mr: 'मराठी',
  te: 'తెలుగు', kn: 'ಕನ್ನಡ', ta: 'தமிழ்', ml: 'മലയാളം', kok: 'कोंकणी', as: 'অসমীয়া', kha: 'Khasi', mni: 'মৈতৈলোন্', ks: 'کٲشُر',
}

export function mdLite(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>')
}
