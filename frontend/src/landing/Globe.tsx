import { useEffect, useRef } from 'react'

/* A slowly turning dotted Earth, lit from the upper-left (albedo), India facing
   the viewer, with ember pin-pricks over the Indo-Gangetic plain and drifting
   wind streaks. Pure canvas — it's the hero's backdrop until the film loads,
   and the fallback if it never does. */
export function Globe() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const ctx = c.getContext('2d')!
    let raf = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr }
    resize()
    window.addEventListener('resize', resize)
    const pts: [number, number][] = []
    for (let i = 0; i < 2600; i++) {
      const y = 1 - (i / 2599) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963
      pts.push([Math.asin(y), Math.atan2(Math.sin(th) * r, Math.cos(th) * r)])
    }
    const embers = Array.from({ length: 70 }, () => [(26 + Math.random() * 6) * Math.PI / 180, (74 + Math.random() * 14) * Math.PI / 180, Math.random()] as const)
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      const W = c.width, H = c.height
      ctx.clearRect(0, 0, W, H)
      const R = Math.min(W, H) * (W > H ? 0.46 : 0.5), cx = W * (W > H ? 0.7 : 0.5), cy = H * (W > H ? 0.42 : 0.34)
      const rot = -78 * Math.PI / 180 - Math.sin(t / 9000) * 0.12, tilt = 0.3
      const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.35)
      halo.addColorStop(0, 'rgba(111,227,255,0.16)'); halo.addColorStop(1, 'rgba(111,227,255,0)')
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, Math.PI * 2); ctx.fill()
      const body = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.55, R * 0.1, cx, cy, R)
      body.addColorStop(0, 'rgba(241,230,200,0.10)'); body.addColorStop(1, 'rgba(8,11,18,0.95)')
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill()
      const proj = (lat: number, lon: number) => {
        const x0 = Math.cos(lat) * Math.sin(lon + rot), y0 = Math.sin(lat), z0 = Math.cos(lat) * Math.cos(lon + rot)
        const y1 = y0 * Math.cos(tilt) - z0 * Math.sin(tilt), z1 = y0 * Math.sin(tilt) + z0 * Math.cos(tilt)
        return [cx + x0 * R, cy - y1 * R, z1] as const
      }
      for (const [lat, lon] of pts) {
        const [x, y, z] = proj(lat, lon)
        if (z < 0) continue
        const light = Math.max(0.08, (x - cx) / R * -0.4 + (cy - y) / R * 0.6 + 0.35)
        ctx.fillStyle = `rgba(241,230,200,${0.16 + light * 0.6 * z})`
        ctx.fillRect(x, y, 1.3 * dpr, 1.3 * dpr)
      }
      for (const [lat, lon, ph] of embers) {
        const [x, y, z] = proj(lat, lon)
        if (z < 0) continue
        const a = 0.35 + 0.65 * Math.abs(Math.sin(t / 700 + ph * 6))
        const g = ctx.createRadialGradient(x, y, 0, x, y, 7 * dpr)
        g.addColorStop(0, `rgba(255,179,92,${a})`); g.addColorStop(1, 'rgba(255,106,43,0)')
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2); ctx.fill()
      }
      ctx.strokeStyle = 'rgba(111,227,255,0.22)'; ctx.lineWidth = 1 * dpr
      for (let k = 0; k < 14; k++) {
        const lat0 = (22 + k * 1.1) * Math.PI / 180, off = ((t / 60 + k * 37) % 360) * Math.PI / 180 * 0.08
        ctx.beginPath()
        for (let j = 0; j < 18; j++) {
          const [x, y, z] = proj(lat0 + Math.sin(j / 3 + k) * 0.02, (60 + j * 1.6) * Math.PI / 180 + off)
          if (z < 0) continue
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])
  return <canvas ref={ref} className="globe" aria-hidden />
}
