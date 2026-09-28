import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ArcLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { TripsLayer } from '@deck.gl/geo-layers'
import type { Layer } from '@deck.gl/core'
import type { City, Cluster, Corridor, Fire, Hotspot, Report, WindVec } from '../lib/api'
import { hexToRgb, naqiColor } from '../lib/format'

const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'
const ADDITIVE = { blend: true, blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one' } as const

export type Layers = { wind: boolean; fires: boolean; cities: boolean; hotspots: boolean; reports: boolean; corridors: boolean }

export type MapProps = {
  cities: City[]
  frameNaqi: Record<string, number | null> | null
  wind: WindVec[]
  fires: Fire[]
  hotspots: Hotspot[]
  reports: Report[]
  corridors: Corridor[]
  trajectories: [number, number, number][][] | null
  clusters: Cluster[]
  plume: [number, number, number][][] | null
  network: { lat: number; lon: number; name: string }[] | null
  selectedCity: string | null
  selectedReport: string | null
  pickMode: boolean
  pick: { lat: number; lon: number } | null
  layers: Layers
  flyTo: { lon: number; lat: number; zoom: number; pitch?: number; bearing?: number } | null
  onCity: (id: string) => void
  onHotspot: (h: Hotspot) => void
  onReport: (id: string) => void
  onPick: (lat: number, lon: number) => void
}

// ---- wind particle system ------------------------------------------------ //
type Particle = { x: number; y: number; age: number; life: number; trail: [number, number][] }
const N_PARTICLES = 2200
const TRAIL = 7
const LAT0 = 5, LON0 = 65, STEP = 2.5, NI = 14, NJ = 14

function makeGrid(vecs: WindVec[]) {
  const u = new Float32Array(NI * NJ), v = new Float32Array(NI * NJ)
  for (const w of vecs) {
    const i = Math.round((w.lat - LAT0) / STEP), j = Math.round((w.lon - LON0) / STEP)
    if (i >= 0 && i < NI && j >= 0 && j < NJ) { u[i * NJ + j] = w.u; v[i * NJ + j] = w.v }
  }
  return (lat: number, lon: number): [number, number] => {
    const fi = Math.min(Math.max((lat - LAT0) / STEP, 0), NI - 1.001)
    const fj = Math.min(Math.max((lon - LON0) / STEP, 0), NJ - 1.001)
    const i = Math.floor(fi), j = Math.floor(fj), di = fi - i, dj = fj - j
    const b = (g: Float32Array) => g[i * NJ + j] * (1 - di) * (1 - dj) + g[(i + 1) * NJ + j] * di * (1 - dj) + g[i * NJ + j + 1] * (1 - di) * dj + g[(i + 1) * NJ + j + 1] * di * dj
    return [b(u), b(v)]
  }
}

function spawn(): Particle {
  const x = 66 + Math.random() * 31, y = 6 + Math.random() * 31
  return { x, y, age: 0, life: 60 + Math.random() * 120, trail: [[x, y]] }
}

export default function MapView(p: MapProps) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const overlay = useRef<MapboxOverlay | null>(null)
  const props = useRef(p)
  props.current = p
  const particles = useRef<Particle[]>([])
  const sampler = useRef<((lat: number, lon: number) => [number, number]) | null>(null)

  useEffect(() => {
    if (!el.current) return
    const m = new maplibregl.Map({
      container: el.current, style: STYLE, center: [80.5, 21.5], zoom: 3.9, pitch: 32, bearing: -6,
      attributionControl: { compact: true }, maxPitch: 70, minZoom: 3, maxZoom: 11,
    })
    const ov = new MapboxOverlay({ interleaved: false, layers: [] })
    m.addControl(ov)
    m.on('click', (e: maplibregl.MapMouseEvent) => { if (props.current.pickMode) props.current.onPick(e.lngLat.lat, e.lngLat.lng) })
    map.current = m
    overlay.current = ov
    // ensure the canvas paints even if the container was measured before layout settled
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current)
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      if (t - last < 33) return // ~30 fps is plenty and saves laptop batteries on demo day
      last = t
      stepParticles()
      ov.setProps({ layers: buildLayers(t) })
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); m.remove() }
  }, [])

  useEffect(() => {
    if (p.wind.length) {
      sampler.current = makeGrid(p.wind)
      if (!particles.current.length) particles.current = Array.from({ length: N_PARTICLES }, spawn).map((q) => ({ ...q, age: Math.random() * q.life }))
    }
  }, [p.wind])

  useEffect(() => {
    const m = map.current
    const f = p.flyTo
    if (!f || !m) return
    const go = () => m.flyTo({ center: [f.lon, f.lat], zoom: f.zoom, pitch: f.pitch ?? 40, bearing: f.bearing ?? -8, speed: 0.9, curve: 1.5, essential: true })
    if (m.loaded()) go(); else m.once('load', go)
  }, [p.flyTo])

  useEffect(() => {
    const c = map.current?.getCanvas()
    if (c) c.style.cursor = p.pickMode ? 'crosshair' : ''
  }, [p.pickMode])

  function stepParticles() {
    const s = sampler.current
    if (!s) return
    const k = 0.0022 // km/h → degrees per frame (visually exaggerated, consistent across the map)
    for (let n = 0; n < particles.current.length; n++) {
      const q = particles.current[n]
      const [u, v] = s(q.y, q.x)
      q.x += u * k / Math.cos((q.y * Math.PI) / 180)
      q.y += v * k
      q.age++
      q.trail.push([q.x, q.y])
      if (q.trail.length > TRAIL) q.trail.shift()
      if (q.age > q.life || q.x < 65 || q.x > 98 || q.y < 5 || q.y > 38) particles.current[n] = spawn()
    }
  }

  function buildLayers(t: number): Layer[] {
    const P = props.current
    const L: Layer[] = []
    const pulse = (Math.sin(t / 380) + 1) / 2

    if (P.layers.corridors && P.corridors.length) {
      L.push(new PathLayer<Corridor>({
        id: 'corridors', data: P.corridors, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: 5, capRounded: true, jointRounded: true,
        getColor: (d) => [...hexToRgb(d.peak_category.color), 150] as [number, number, number, number],
        parameters: ADDITIVE,
      }))
    }

    if (P.layers.wind && particles.current.length) {
      L.push(new PathLayer<Particle>({
        id: 'wind', data: particles.current, getPath: (d) => d.trail, widthUnits: 'pixels', getWidth: 1.3,
        getColor: (d) => [111, 227, 255, Math.min(140, 30 + d.trail.length * 14) * Math.min(1, d.age / 12) * Math.min(1, (d.life - d.age) / 20)],
        updateTriggers: { getPath: t, getColor: t }, parameters: ADDITIVE,
      }))
    }

    if (P.layers.fires && P.fires.length) {
      L.push(new ScatterplotLayer<Fire>({
        id: 'fire-halo', data: P.fires, getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels',
        getRadius: (d) => 5 + Math.min(14, Math.sqrt(d.frp) * 1.6), getFillColor: (d) => [255, 106, 43, d.age_h < 12 ? 70 : 35],
        parameters: ADDITIVE,
      }))
      L.push(new ScatterplotLayer<Fire>({
        id: 'fire-core', data: P.fires, getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels', getRadius: 1.6,
        getFillColor: [255, 214, 150, 230], parameters: ADDITIVE,
      }))
    }

    if (P.trajectories) {
      L.push(new TripsLayer({
        id: 'traj', data: P.trajectories, getPath: (d: [number, number, number][]) => d.map((q) => [q[0], q[1]] as [number, number]),
        getTimestamps: (d: [number, number, number][]) => d.map((q) => 48 - q[2]),
        getColor: [255, 179, 92], widthUnits: 'pixels', getWidth: 2.4, trailLength: 20, currentTime: ((t / 90) % 60),
        capRounded: true, jointRounded: true, fadeTrail: true, parameters: ADDITIVE,
      }))
      L.push(new PathLayer({
        id: 'traj-static', data: P.trajectories, getPath: (d: [number, number, number][]) => d.map((q) => [q[0], q[1]] as [number, number]),
        getColor: [255, 179, 92, 40], widthUnits: 'pixels', getWidth: 1,
      }))
    }
    if (P.clusters.length) {
      L.push(new ScatterplotLayer<Cluster>({
        id: 'clusters', data: P.clusters, getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels',
        getRadius: (d) => 10 + d.share * 40 + pulse * 4, stroked: true, filled: true,
        getFillColor: [255, 106, 43, 40], getLineColor: [255, 179, 92, 220], lineWidthUnits: 'pixels', getLineWidth: 1.5,
        updateTriggers: { getRadius: t },
      }))
    }

    if (P.plume) {
      L.push(new TripsLayer({
        id: 'plume', data: P.plume, getPath: (d: [number, number, number][]) => d.map((q) => [q[0], q[1]] as [number, number]),
        getTimestamps: (d: [number, number, number][]) => d.map((q) => q[2]), getColor: [241, 230, 200],
        widthUnits: 'pixels', getWidth: 3, trailLength: 6, currentTime: (t / 300) % 14, fadeTrail: true, parameters: ADDITIVE,
      }))
    }

    if (P.layers.hotspots && P.hotspots.length) {
      L.push(new ScatterplotLayer<Hotspot>({
        id: 'hotspots', data: P.hotspots, getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels', pickable: true,
        getRadius: (d) => 12 + d.priority * 14 + pulse * 6, stroked: true, filled: true,
        getFillColor: [233, 90, 255, 26], getLineColor: [240, 150, 255, 210], lineWidthUnits: 'pixels', getLineWidth: 1.5,
        onClick: (i) => i.object && P.onHotspot(i.object), updateTriggers: { getRadius: t },
      }))
    }

    if (P.layers.cities && P.cities.length) {
      const val = (c: City) => (P.frameNaqi ? P.frameNaqi[c.id] ?? c.naqi : c.naqi)
      L.push(new ScatterplotLayer<City>({
        id: 'city-glow', data: P.cities, getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels',
        getRadius: (d) => 10 + Math.sqrt(d.pop_m) * 5, getFillColor: (d) => [...hexToRgb(naqiColor(val(d))), 55] as [number, number, number, number],
        updateTriggers: { getFillColor: P.frameNaqi }, parameters: ADDITIVE,
      }))
      L.push(new ScatterplotLayer<City>({
        id: 'city-spike', data: P.cities.filter((c) => c.spike), getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels',
        getRadius: (d) => 8 + Math.sqrt(d.pop_m) * 3 + ((t / 30) % 26), stroked: true, filled: false,
        getLineColor: (d) => [...hexToRgb(d.spike!.grap.stage >= 2 ? '#e0452b' : '#f08a24'), Math.max(0, 200 - ((t / 30) % 26) * 8)] as [number, number, number, number],
        lineWidthUnits: 'pixels', getLineWidth: 1.4, updateTriggers: { getRadius: t, getLineColor: t },
      }))
      L.push(new ScatterplotLayer<City>({
        id: 'city', data: P.cities, getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels', pickable: true,
        getRadius: (d) => 3.5 + Math.sqrt(d.pop_m) * 1.4 + (d.id === P.selectedCity ? 3 : 0),
        getFillColor: (d) => [...hexToRgb(naqiColor(val(d))), 255] as [number, number, number, number],
        stroked: true, getLineColor: (d) => (d.id === P.selectedCity ? [255, 255, 255, 255] : [4, 6, 10, 255]), lineWidthUnits: 'pixels', getLineWidth: (d) => (d.id === P.selectedCity ? 2 : 1),
        onClick: (i) => i.object && P.onCity(i.object.id),
        updateTriggers: { getFillColor: P.frameNaqi, getRadius: P.selectedCity, getLineColor: P.selectedCity, getLineWidth: P.selectedCity },
      }))
      L.push(new TextLayer<City>({
        id: 'city-label', data: P.cities.filter((c) => c.pop_m >= 2.8 || c.id === P.selectedCity), getPosition: (d) => [d.lon, d.lat],
        getText: (d) => d.name, getSize: 11, sizeUnits: 'pixels', getColor: [230, 234, 240, 200], getPixelOffset: [0, -16],
        fontFamily: 'Inter Tight, Inter, sans-serif', fontWeight: 600, outlineWidth: 3, outlineColor: [4, 6, 10, 230],
        fontSettings: { sdf: true }, updateTriggers: { getPosition: P.selectedCity },
      }))
    }

    if (P.layers.reports && P.reports.length) {
      L.push(new ScatterplotLayer<Report>({
        id: 'reports', data: P.reports, getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels', pickable: true,
        getRadius: (d) => (d.id === P.selectedReport ? 9 : 6), stroked: true,
        getFillColor: (d) => (d.verification.status === 'verified' ? [241, 230, 200, 255] : d.verification.status === 'rejected' ? [110, 116, 128, 200] : [241, 230, 200, 150]),
        getLineColor: [4, 6, 10, 255], lineWidthUnits: 'pixels', getLineWidth: 2,
        onClick: (i) => i.object && P.onReport(i.object.id), updateTriggers: { getRadius: P.selectedReport },
      }))
    }

    if (P.network?.length) {
      const hub = { lat: 21.15, lon: 79.09 } // coordinator shown at India's geographic centre (Nagpur)
      const phase = (t / 1600) % 1
      L.push(new ArcLayer<{ lat: number; lon: number }>({
        id: 'fed-arcs', data: P.network, getSourcePosition: (d) => [d.lon, d.lat], getTargetPosition: () => [hub.lon, hub.lat],
        getSourceColor: [241, 230, 200, 200], getTargetColor: [111, 227, 255, 200], getWidth: 1.6, widthUnits: 'pixels',
        getHeight: 0.35, greatCircle: false, parameters: ADDITIVE,
      }))
      L.push(new ScatterplotLayer<{ lat: number; lon: number }>({
        id: 'fed-packets', data: P.network, radiusUnits: 'pixels', getRadius: 3.5, getFillColor: [255, 255, 255, 230],
        getPosition: (d) => [d.lon + (hub.lon - d.lon) * phase, d.lat + (hub.lat - d.lat) * phase],
        updateTriggers: { getPosition: t }, parameters: ADDITIVE,
      }))
      L.push(new ScatterplotLayer({
        id: 'fed-hub', data: [hub], getPosition: (d: typeof hub) => [d.lon, d.lat], radiusUnits: 'pixels',
        getRadius: 10 + pulse * 6, getFillColor: [111, 227, 255, 60], stroked: true, getLineColor: [111, 227, 255, 255],
        lineWidthUnits: 'pixels', getLineWidth: 1.5, updateTriggers: { getRadius: t },
      }))
      L.push(new ScatterplotLayer<{ lat: number; lon: number }>({
        id: 'fed-nodes', data: P.network, getPosition: (d) => [d.lon, d.lat], radiusUnits: 'pixels', getRadius: 5,
        getFillColor: [241, 230, 200, 255], stroked: true, getLineColor: [4, 6, 10, 255], lineWidthUnits: 'pixels', getLineWidth: 2,
      }))
    }

    if (P.pick) {
      L.push(new ScatterplotLayer({
        id: 'pick', data: [P.pick], getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat], radiusUnits: 'pixels',
        getRadius: 7 + pulse * 5, stroked: true, filled: true, getFillColor: [241, 230, 200, 90], getLineColor: [255, 255, 255, 255],
        lineWidthUnits: 'pixels', getLineWidth: 2, updateTriggers: { getRadius: t },
      }))
    }
    return L
  }

  return <div ref={el} style={{ position: 'absolute', inset: 0, background: '#04060a' }} />
}
