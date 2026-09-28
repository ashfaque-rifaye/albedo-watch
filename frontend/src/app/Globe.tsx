import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { City, Cluster, Corridor, Hotspot, Report, WindVec } from '../lib/api'

export type Theme = 'satellite' | 'night' | 'today'
export type Sensor = 'eo' | 'flir' | 'nvg' | 'crt'
export type GlobeLayers = {
  wind: boolean; fires: boolean; cities: boolean; hotspots: boolean; reports: boolean
  sensors: boolean; corridors: boolean; aq: boolean; photoreal: boolean; sunlight: boolean
}
export type FlyTarget = { lon: number; lat: number; range: number; pitch?: number; heading?: number; duration?: number; key?: number }
export type Track = { lon: number; lat: number; label: string } | null
export type Telemetry = { lat: number | null; lon: number | null; alt: number; heading: number; pitch: number; photoreal: boolean }
export type FireBin = [number, number, number, number, number]   // lat, lon, count, frpSum, frpMax
export type FireDet = [number, number, number, number]            // lat, lon, frp, ageH
export type SensorPt = [number, number, number, number]           // lat, lon, pm25, ageMin

export type GlobeProps = {
  cities: City[]
  frameLevel: Record<string, number> | null
  wind: WindVec[]
  fireBins: FireBin[]
  fireDets: FireDet[] | null
  citizen: SensorPt[]
  stations: SensorPt[]
  hotspots: Hotspot[]
  reports: Report[]
  corridors: Corridor[]
  trajectories: [number, number, number][][] | null
  clusters: Cluster[]
  plume: [number, number, number][][] | null
  network: { lat: number; lon: number; name: string }[] | null
  selectedCity: string | null
  selectedReport: string | null
  pick: { lat: number; lon: number } | null
  hub: { lat: number; lon: number } | null
  layers: GlobeLayers
  theme: Theme
  sensor: Sensor
  hud: boolean
  autoPhotoreal: boolean
  track: Track
  flyTo: FlyTarget | null
  onCity: (id: string) => void
  onHotspot: (h: Hotspot) => void
  onReport: (id: string) => void
  onPlace: (lat: number, lon: number) => void
  onView: (bbox: [number, number, number, number] | null, height: number) => void
  onTelemetry?: (t: Telemetry) => void
  onUserMove?: () => void
}

export const LEVEL_COLORS = ['#2bb673', '#9ccc3a', '#f2c230', '#f08a24', '#e0452b', '#9b1c3a']
let GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined) || ''
export function setGoogleKey(k: string | null | undefined) { if (k) GOOGLE_KEY = k }
export const hasGoogleKey = () => !!GOOGLE_KEY
const HUB = { lat: 21.15, lon: 79.09 }
// Depth-test markers against the planet (so the far side never shows through), but
// not within this distance of the camera — otherwise terrain/3D buildings would bury them.
const DDT = 2.5e5

const col = (hex: string, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a)
const pmLevel = (v: number) => (v <= 9 ? 0 : v <= 35.4 ? 1 : v <= 55.4 ? 2 : v <= 125.4 ? 3 : v <= 225.4 ? 4 : 5)
const fireColor = (frp: number) => (frp < 5 ? '#ffd27a' : frp < 20 ? '#ffa04a' : '#ff4a26')

type Tag = { kind: 'city' | 'hotspot' | 'report' | 'fire' | 'sensor' | 'station'; id?: string; data?: unknown; label: string }

function ringIcon(rank: number, color = '#f096ff'): string {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.fillStyle = 'rgba(20,6,24,0.8)'; g.fill()
  g.lineWidth = 3.5; g.strokeStyle = color; g.stroke()
  g.fillStyle = '#fff'; g.font = '700 22px Inter Tight, Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(String(rank), 32, 33)
  return c.toDataURL()
}
function reportIcon(status: string): string {
  const c = document.createElement('canvas'); c.width = c.height = 48
  const g = c.getContext('2d')!
  g.beginPath(); g.arc(24, 24, 13, 0, Math.PI * 2)
  g.fillStyle = status === 'verified' ? '#f1e6c8' : status === 'rejected' ? '#6b7280' : 'rgba(241,230,200,0.7)'; g.fill()
  g.lineWidth = 3; g.strokeStyle = '#05070b'; g.stroke()
  g.fillStyle = '#05070b'; g.font = '700 15px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('✦', 24, 25)
  return c.toDataURL()
}
function hubIcon(): string {
  const c = document.createElement('canvas'); c.width = c.height = 56
  const g = c.getContext('2d')!
  g.beginPath(); g.arc(28, 28, 11, 0, Math.PI * 2); g.fillStyle = '#6fe3ff'; g.fill()
  g.lineWidth = 4; g.strokeStyle = '#04121a'; g.stroke()
  g.beginPath(); g.arc(28, 28, 22, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = 'rgba(111,227,255,.6)'; g.stroke()
  return c.toDataURL()
}

// ---- sensor "looks" (post-process GLSL) ------------------------------------ //
const SHADERS: Record<Exclude<Sensor, 'eo'>, string> = {
  flir: `uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
vec3 ironbow(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.02, 0.0, 0.08), b = vec3(0.35, 0.02, 0.45), c = vec3(0.85, 0.12, 0.25), d = vec3(1.0, 0.55, 0.05), e = vec3(1.0, 0.98, 0.78);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.78) return mix(c, d, (t - 0.5) / 0.28);
  return mix(d, e, (t - 0.78) / 0.22);
}
void main() {
  vec3 rgb = texture(colorTexture, v_textureCoordinates).rgb;
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  float heat = max(0.0, rgb.r - 0.5 * (rgb.g + rgb.b));
  float t = pow(lum, 1.15) * 0.72 + heat * 1.6;
  vec2 d = v_textureCoordinates - 0.5;
  float vig = 1.0 - dot(d, d) * 0.9;
  out_FragColor = vec4(ironbow(t) * vig, 1.0);
}`,
  nvg: `uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 rgb = texture(colorTexture, v_textureCoordinates).rgb;
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  lum = pow(lum, 0.8) * 1.35;
  float n = rand(v_textureCoordinates * 900.0 + mod(czm_frameNumber, 97.0)) * 0.12;
  vec2 d = v_textureCoordinates - 0.5;
  float vig = smoothstep(0.62, 0.18, length(d));
  float scan = 0.94 + 0.06 * sin(v_textureCoordinates.y * 900.0);
  out_FragColor = vec4(vec3(0.18, 1.0, 0.35) * (lum + n) * vig * scan, 1.0);
}`,
  crt: `uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
void main() {
  vec2 uv = v_textureCoordinates;
  float off = 0.0016;
  float r = texture(colorTexture, uv + vec2(off, 0.0)).r;
  float g = texture(colorTexture, uv).g;
  float b = texture(colorTexture, uv - vec2(off, 0.0)).b;
  float scan = 0.82 + 0.18 * sin(uv.y * 1400.0);
  vec2 d = uv - 0.5;
  float vig = 1.0 - dot(d, d) * 1.4;
  vec3 c = vec3(r, g, b) * scan * vig;
  c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))) * vec3(0.9, 1.05, 1.1), 0.25);
  out_FragColor = vec4(c, 1.0);
}`,
}

function makeSampler(vecs: WindVec[]) {
  if (!vecs.length) return null
  const lats = [...new Set(vecs.map((v) => v.lat))].sort((a, b) => a - b)
  const lons = [...new Set(vecs.map((v) => v.lon))].sort((a, b) => a - b)
  const nI = lats.length, nJ = lons.length
  const U = new Float32Array(nI * nJ), V = new Float32Array(nI * nJ)
  const li = new Map(lats.map((v, i) => [v, i])), lj = new Map(lons.map((v, j) => [v, j]))
  for (const w of vecs) { const k = li.get(w.lat)! * nJ + lj.get(w.lon)!; U[k] = w.u; V[k] = w.v }
  const sI = lats[1] - lats[0], sJ = lons[1] - lons[0]
  return (lat: number, lon: number): [number, number] => {
    const fi = Math.min(Math.max((lat - lats[0]) / sI, 0), nI - 1.001)
    const fj = Math.min(Math.max((lon - lons[0]) / sJ, 0), nJ - 1.001)
    const i = Math.floor(fi), j = Math.floor(fj), di = fi - i, dj = fj - j
    const b = (g: Float32Array) => g[i * nJ + j] * (1 - di) * (1 - dj) + g[(i + 1) * nJ + j] * di * (1 - dj) + g[i * nJ + j + 1] * (1 - di) * dj + g[(i + 1) * nJ + j + 1] * di * dj
    return [b(U), b(V)]
  }
}

type Particle = { age: number; life: number; trail: [number, number][] }

export default function Globe(p: GlobeProps) {
  const el = useRef<HTMLDivElement>(null)
  const credits = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const viewer = useRef<Cesium.Viewer | null>(null)
  const P = useRef(p); P.current = p
  const coll = useRef<Record<string, Cesium.PointPrimitiveCollection | Cesium.BillboardCollection | Cesium.LabelCollection | Cesium.PolylineCollection>>({})
  const tileset = useRef<Cesium.Cesium3DTileset | null>(null)
  const tilesetLoading = useRef(false)
  const stages = useRef<Partial<Record<Sensor, Cesium.PostProcessStage>>>({})
  const sampler = useRef<ReturnType<typeof makeSampler>>(null)
  const particles = useRef<Particle[]>([])
  const idle = useRef(true)
  const orbit = useRef<{ center: Cesium.Cartesian3; heading: number; pitch: number; range: number } | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [ready, setReady] = useState(false)

  function ensureTileset(show: boolean) {
    const v = viewer.current
    if (!v) return
    if (!show) { if (tileset.current) tileset.current.show = false; v.scene.globe.show = true; return }
    if (!GOOGLE_KEY) return
    if (tileset.current) { tileset.current.show = true; v.scene.globe.show = false; return }
    if (tilesetLoading.current) return
    tilesetLoading.current = true
    Cesium.createGooglePhotorealistic3DTileset({ key: GOOGLE_KEY }, { maximumScreenSpaceError: 12 })
      .then((ts) => { tileset.current = ts; v.scene.primitives.add(ts); v.scene.primitives.lowerToBottom(ts); ts.show = true; v.scene.globe.show = false })
      .catch(() => { /* quota / key issue: stay on the imagery globe */ })
      .finally(() => { tilesetLoading.current = false })
  }

  // ---------------------------------------------------------------- init
  useEffect(() => {
    if (!el.current) return
    const v = new Cesium.Viewer(el.current, {
      baseLayer: false, animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      creditContainer: credits.current ?? undefined, msaaSamples: 4, requestRenderMode: false, showRenderLoopErrors: false,
    })
    v.scene.backgroundColor = Cesium.Color.fromCssColorString('#020306')
    v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0b1018')
    v.scene.globe.showGroundAtmosphere = true
    v.scene.globe.depthTestAgainstTerrain = false
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true
    v.scene.fog.enabled = true
    v.scene.postProcessStages.fxaa.enabled = true
    v.clock.shouldAnimate = true
    v.clock.currentTime = Cesium.JulianDate.now()
    v.scene.screenSpaceCameraController.minimumZoomDistance = 120
    v.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(79, 18, 17_500_000) })
    viewer.current = v
    // Self-healing render loop: a transient error (e.g. a zero-size canvas while a tab is
    // hidden or resized) must never freeze the globe for the rest of the session.
    const recoveries: number[] = []
    v.scene.renderError.addEventListener((_s: unknown, e: unknown) => {
      console.error('[albedo] render error', (e as Error)?.stack ?? e)
      const now = Date.now()
      while (recoveries.length && now - recoveries[0] > 60_000) recoveries.shift()
      if (recoveries.length >= 5) return
      recoveries.push(now)
      setTimeout(() => { if (viewer.current === v && !v.isDestroyed()) { v.resize(); v.useDefaultRenderLoop = true } }, 400)
    })
    for (const [k, c] of Object.entries({
      corridors: new Cesium.PolylineCollection(), traj: new Cesium.PolylineCollection(), arcs: new Cesium.PolylineCollection(),
      fires: new Cesium.PointPrimitiveCollection(), sensors: new Cesium.PointPrimitiveCollection(),
      cityGlow: new Cesium.PointPrimitiveCollection(), cities: new Cesium.PointPrimitiveCollection(),
      labels: new Cesium.LabelCollection(), clusters: new Cesium.BillboardCollection(),
      hotspots: new Cesium.BillboardCollection(), reports: new Cesium.BillboardCollection(), hub: new Cesium.BillboardCollection(),
    })) { v.scene.primitives.add(c); coll.current[k] = c }

    const cv = v.scene.canvas
    const userMoved = () => {
      idle.current = false
      if (orbit.current) { orbit.current = null; v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY) }
      P.current.onUserMove?.()
    }
    cv.addEventListener('pointerdown', userMoved); cv.addEventListener('wheel', userMoved, { passive: true })
    let lastTel = 0
    v.clock.onTick.addEventListener(() => {
      if (idle.current && v.camera.positionCartographic.height > 8e6) v.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.0004)
      const o = orbit.current
      if (o) { o.heading += 0.0011; v.camera.lookAt(o.center, new Cesium.HeadingPitchRange(o.heading, o.pitch, o.range)) }
      const now = performance.now()
      if (P.current.onTelemetry && now - lastTel > 160) {
        lastTel = now
        const c = v.camera.pickEllipsoid(new Cesium.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2))
        const g = c ? Cesium.Cartographic.fromCartesian(c) : null
        P.current.onTelemetry({
          lat: g ? Cesium.Math.toDegrees(g.latitude) : null, lon: g ? Cesium.Math.toDegrees(g.longitude) : null,
          alt: v.camera.positionCartographic.height, heading: Cesium.Math.toDegrees(v.camera.heading),
          pitch: Cesium.Math.toDegrees(v.camera.pitch), photoreal: !!tileset.current?.show,
        })
      }
    })

    const h = new Cesium.ScreenSpaceEventHandler(cv)
    h.setInputAction((e: { position: Cesium.Cartesian2 }) => {
      const picked = v.scene.pick(e.position)
      const tag = (picked?.id ?? picked?.primitive?.id) as Tag | undefined
      if (tag && typeof tag === 'object' && 'kind' in tag) {
        if (tag.kind === 'city' && tag.id) return P.current.onCity(tag.id)
        if (tag.kind === 'hotspot') return P.current.onHotspot(tag.data as Hotspot)
        if (tag.kind === 'report' && tag.id) return P.current.onReport(tag.id)
      }
      let cart: Cesium.Cartesian3 | undefined
      if (v.scene.pickPositionSupported && tileset.current?.show) cart = v.scene.pickPosition(e.position)
      cart = cart ?? v.camera.pickEllipsoid(e.position, v.scene.globe.ellipsoid)
      if (!cart) return
      const c = Cesium.Cartographic.fromCartesian(cart)
      P.current.onPlace(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude))
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    h.setInputAction((e: { endPosition: Cesium.Cartesian2 }) => {
      const picked = v.scene.pick(e.endPosition)
      const tag = (picked?.id ?? picked?.primitive?.id) as Tag | undefined
      if (tag && typeof tag === 'object' && 'label' in tag) { setTip({ x: e.endPosition.x, y: e.endPosition.y, text: tag.label }); cv.style.cursor = 'pointer' }
      else { setTip(null); cv.style.cursor = 'crosshair' }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    const report = () => {
      const r = v.camera.computeViewRectangle()
      const hgt = v.camera.positionCartographic.height
      P.current.onView(r ? [Cesium.Math.toDegrees(r.west), Cesium.Math.toDegrees(r.south), Cesium.Math.toDegrees(r.east), Cesium.Math.toDegrees(r.north)] : null, hgt)
      if (P.current.autoPhotoreal && !P.current.layers.photoreal) {
        if (hgt < 40_000) ensureTileset(true)
        else if (hgt > 150_000) ensureTileset(false)
      }
    }
    v.camera.moveEnd.addEventListener(report)
    v.scene.postRender.addEventListener(() => drawOverlay())
    setReady(true)
    return () => { h.destroy(); v.destroy(); viewer.current = null }
  }, [])

  // ---------------------------------------------------------------- imagery theme & overlays
  useEffect(() => {
    const v = viewer.current; if (!v) return
    const L = v.imageryLayers
    L.removeAll()
    const yday = new Date(Date.now() - 36 * 3600 * 1000).toISOString().slice(0, 10)
    const labels = () => {
      const lbl = L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19, credit: 'Boundaries & places © Esri' }))
      lbl.alpha = 0.9
    }
    if (p.theme === 'satellite') {
      L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19, credit: 'Imagery © Esri, Maxar, Earthstar Geographics' }))
      labels()
    } else if (p.theme === 'today') {
      L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${yday}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
        maximumLevel: 9, credit: `NASA GIBS · VIIRS NOAA-20 true colour · ${yday}` }))
      labels()
    } else {
      const base = L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', subdomains: ['a', 'b', 'c', 'd'],
        maximumLevel: 18, credit: '© OpenStreetMap contributors © CARTO' }))
      base.brightness = 1.25
    }
    if (p.layers.aq && GOOGLE_KEY) {
      const aq = L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: `https://airquality.googleapis.com/v1/mapTypes/UAQI_RED_GREEN/heatmapTiles/{z}/{x}/{y}?key=${GOOGLE_KEY}`,
        maximumLevel: 12, credit: 'Air quality heatmap © Google' }))
      aq.alpha = 0.55
    }
    v.scene.globe.enableLighting = p.layers.sunlight && p.theme !== 'night'
    v.scene.globe.dynamicAtmosphereLighting = v.scene.globe.enableLighting
  }, [p.theme, p.layers.aq, p.layers.sunlight, ready])

  useEffect(() => { if (ready) ensureTileset(p.layers.photoreal) }, [p.layers.photoreal, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sensor looks are created on demand: a post-process stage made before the canvas
  // has a size allocates a zero-width framebuffer and stops Cesium's renderer.
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    for (const st of Object.values(stages.current)) if (st) v.scene.postProcessStages.remove(st)
    stages.current = {}
    if (p.sensor === 'eo' || v.canvas.clientWidth < 2 || v.canvas.clientHeight < 2) return
    const st = new Cesium.PostProcessStage({ fragmentShader: SHADERS[p.sensor] })
    v.scene.postProcessStages.add(st)
    stages.current[p.sensor] = st
  }, [p.sensor, ready])

  // ---------------------------------------------------------------- cities: dot + value tag (names come from the basemap)
  useEffect(() => {
    const pts = coll.current.cities as Cesium.PointPrimitiveCollection, glow = coll.current.cityGlow as Cesium.PointPrimitiveCollection
    const labels = coll.current.labels as Cesium.LabelCollection
    if (!pts) return
    pts.removeAll(); glow.removeAll(); labels.removeAll()
    if (!p.layers.cities) return
    for (const c of p.cities) {
      const lvl = p.frameLevel?.[c.id] ?? c.category.level
      const color = LEVEL_COLORS[Math.max(0, lvl)] ?? '#6b7280'
      const pos = Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 60)
      const sel = c.id === p.selectedCity
      glow.add({ position: pos, pixelSize: 12 + Math.sqrt(c.pop_m) * 3.2, color: col(color, 0.2), disableDepthTestDistance: DDT,
        scaleByDistance: new Cesium.NearFarScalar(3e5, 1.0, 1.5e7, 0.6), translucencyByDistance: new Cesium.NearFarScalar(4e4, 0, 2.5e5, 1) })
      pts.add({ position: pos, pixelSize: (sel ? 11 : 7) + Math.sqrt(c.pop_m) * 0.9, color: col(color),
        outlineColor: sel ? Cesium.Color.WHITE : col('#05070b'), outlineWidth: sel ? 2.5 : 1.5, disableDepthTestDistance: DDT,
        scaleByDistance: new Cesium.NearFarScalar(3e5, 1.0, 1.5e7, 0.7),
        id: { kind: 'city', id: c.id, label: `${c.name}, ${c.india ? c.state_name : c.country_name} · ${c.index_system} ${c.naqi ?? '—'} (${c.category.label})` } as Tag })
      const tagText = sel ? `${c.name} · ${c.naqi ?? '—'}` : c.naqi != null ? String(c.naqi) : ''
      if (!tagText) continue // an empty label has zero width and would crash Cesium's renderer
      labels.add({ position: pos, text: tagText,
        font: '700 12px "JetBrains Mono", monospace', fillColor: col('#0b0d12'),
        showBackground: true, backgroundColor: col(color, 0.92), backgroundPadding: new Cesium.Cartesian2(5, 3),
        pixelOffset: new Cesium.Cartesian2(10, -12), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        disableDepthTestDistance: DDT, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, sel ? 3e7 : 4.2e6) })
    }
  }, [p.cities, p.frameLevel, p.selectedCity, p.layers.cities, ready])

  useEffect(() => {
    const f = coll.current.fires as Cesium.PointPrimitiveCollection
    if (!f) return
    f.removeAll()
    if (!p.layers.fires) return
    if (p.fireDets) {
      for (const [lat, lon, frp, age] of p.fireDets) {
        f.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 40), pixelSize: 3 + Math.min(6, Math.sqrt(frp) * 0.8),
          color: col(fireColor(frp), age < 12 ? 0.95 : 0.6), outlineColor: col('#1a0800', 0.8), outlineWidth: 1, disableDepthTestDistance: DDT,
          id: { kind: 'fire', label: `NASA heat detection · ${frp.toFixed(1)} MW · ${age.toFixed(0)} h ago` } as Tag })
      }
    } else {
      for (const [lat, lon, n, , mx] of p.fireBins) {
        f.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 40), pixelSize: 2 + Math.min(6, Math.sqrt(n) * 0.7),
          color: col(fireColor(mx), 0.7), disableDepthTestDistance: DDT,
          id: { kind: 'fire', label: `${n} NASA heat detection${n > 1 ? 's' : ''} in this ~100 km cell (24 h) · strongest ${mx} MW` } as Tag })
      }
    }
  }, [p.fireBins, p.fireDets, p.layers.fires, ready])

  useEffect(() => {
    const s = coll.current.sensors as Cesium.PointPrimitiveCollection
    if (!s) return
    s.removeAll()
    if (!p.layers.sensors) return
    const vis = new Cesium.DistanceDisplayCondition(0, 6e6)
    for (const [lat, lon, pm, age] of p.citizen) {
      s.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 30), pixelSize: 4, color: col(LEVEL_COLORS[pmLevel(pm)], 0.85),
        distanceDisplayCondition: vis, disableDepthTestDistance: DDT,
        id: { kind: 'sensor', label: `Citizen sensor · PM2.5 ${pm} µg/m³ · ${age} min ago (low-cost, uncalibrated)` } as Tag })
    }
    for (const [lat, lon, pm, age] of p.stations) {
      s.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 30), pixelSize: 7, color: col(LEVEL_COLORS[pmLevel(pm)]),
        outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5, distanceDisplayCondition: vis, disableDepthTestDistance: DDT,
        id: { kind: 'station', label: `Official monitor · PM2.5 ${pm} µg/m³ · ${age} min ago (OpenAQ)` } as Tag })
    }
  }, [p.citizen, p.stations, p.layers.sensors, ready])

  useEffect(() => {
    const b = coll.current.hotspots as Cesium.BillboardCollection
    if (!b) return
    b.removeAll()
    if (!p.layers.hotspots) return
    p.hotspots.forEach((h, i) => b.add({
      position: Cesium.Cartesian3.fromDegrees(h.lon, h.lat, 80), image: ringIcon(i + 1), width: 30, height: 30, disableDepthTestDistance: DDT,
      id: { kind: 'hotspot', data: h, label: `Hidden hotspot #${i + 1} · ${h.admin?.district || h.place.label} — ${h.why}` } as Tag,
    }))
  }, [p.hotspots, p.layers.hotspots, ready])

  useEffect(() => {
    const b = coll.current.reports as Cesium.BillboardCollection
    if (!b) return
    b.removeAll()
    if (!p.layers.reports) return
    for (const r of p.reports) b.add({
      position: Cesium.Cartesian3.fromDegrees(r.lon, r.lat, 60), image: reportIcon(r.verification.status),
      width: r.id === p.selectedReport ? 34 : 24, height: r.id === p.selectedReport ? 34 : 24, disableDepthTestDistance: DDT,
      id: { kind: 'report', id: r.id, label: `Citizen report · ${r.analysis.source_label} · ${r.verification.status}` } as Tag,
    })
  }, [p.reports, p.selectedReport, p.layers.reports, ready])

  useEffect(() => {
    const b = coll.current.hub as Cesium.BillboardCollection
    if (!b) return
    b.removeAll()
    if (p.hub) b.add({ position: Cesium.Cartesian3.fromDegrees(p.hub.lon, p.hub.lat, 50), image: hubIcon(), width: 30, height: 30, disableDepthTestDistance: DDT })
  }, [p.hub, ready])

  useEffect(() => {
    const cor = coll.current.corridors as Cesium.PolylineCollection
    if (!cor) return
    cor.removeAll()
    if (!p.layers.corridors) return
    for (const c of p.corridors) cor.add({
      positions: Cesium.Cartesian3.fromDegreesArrayHeights(c.path.flatMap(([lo, la]) => [lo, la, 2000])), width: 5,
      material: Cesium.Material.fromType('PolylineGlow', { color: col(c.peak_category.color, 0.9), glowPower: 0.18 }),
    })
  }, [p.corridors, p.layers.corridors, ready])

  useEffect(() => {
    const t = coll.current.traj as Cesium.PolylineCollection
    const cl = coll.current.clusters as Cesium.BillboardCollection
    if (!t) return
    t.removeAll(); cl.removeAll()
    const add = (paths: [number, number, number][][] | null, color: string) => {
      for (const path of paths ?? []) {
        if (path.length < 2) continue
        t.add({ positions: Cesium.Cartesian3.fromDegreesArrayHeights(path.flatMap((q) => [q[0], q[1], 800 + q[2] * 40])), width: 4,
          material: Cesium.Material.fromType('PolylineGlow', { color: col(color, 0.55), glowPower: 0.12 }) })
      }
    }
    add(p.trajectories, '#ffb35c'); add(p.plume, '#f1e6c8')
    for (const c of p.clusters) cl.add({
      position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 80), image: ringIcon(Math.round(c.share * 100), '#ffb35c'),
      width: 24 + c.share * 26, height: 24 + c.share * 26, disableDepthTestDistance: DDT,
      id: { kind: 'fire', label: `${c.place.label}: ${c.fires} detections carry ~${Math.round(c.share * 100)}% of incoming fire smoke (~${c.transport_h} h transport)` } as Tag,
    })
  }, [p.trajectories, p.plume, p.clusters, ready])

  useEffect(() => {
    const a = coll.current.arcs as Cesium.PolylineCollection
    if (!a) return
    a.removeAll()
    for (const n of p.network ?? []) {
      const pts: number[] = []
      for (let k = 0; k <= 32; k++) {
        const t = k / 32
        pts.push(n.lon + (HUB.lon - n.lon) * t, n.lat + (HUB.lat - n.lat) * t, Math.sin(Math.PI * t) * 3.5e5 * Math.min(1, Math.hypot(HUB.lon - n.lon, HUB.lat - n.lat) / 20))
      }
      a.add({ positions: Cesium.Cartesian3.fromDegreesArrayHeights(pts), width: 3,
        material: Cesium.Material.fromType('PolylineGlow', { color: col('#6fe3ff', 0.7), glowPower: 0.2 }) })
    }
  }, [p.network, ready])

  // ---------------------------------------------------------------- camera & tracking
  useEffect(() => {
    const v = viewer.current, f = p.flyTo
    if (!v || !f) return
    idle.current = false
    if (orbit.current) { orbit.current = null; v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY) }
    v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(f.lon, f.lat, 0), 1), {
      offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(f.heading ?? 0), Cesium.Math.toRadians(f.pitch ?? -50), f.range),
      duration: f.duration ?? 2.4,
      complete: () => {
        const tr = P.current.track
        if (tr && Math.abs(tr.lon - f.lon) < 1e-3 && Math.abs(tr.lat - f.lat) < 1e-3) {
          orbit.current = { center: Cesium.Cartesian3.fromDegrees(tr.lon, tr.lat, 0), heading: v.camera.heading, pitch: v.camera.pitch, range: f.range }
        }
      },
    })
  }, [p.flyTo])

  useEffect(() => {
    const v = viewer.current
    if (!p.track && orbit.current && v) { orbit.current = null; v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY) }
  }, [p.track])

  useEffect(() => { sampler.current = makeSampler(p.wind); particles.current = [] }, [p.wind])

  // ---------------------------------------------------------------- overlay: cleared every frame (no smearing)
  function drawOverlay() {
    const v = viewer.current, cv = overlay.current
    if (!v || !cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = v.canvas.clientWidth, h = v.canvas.clientHeight
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const S = P.current, cam = v.camera
    const hgt = cam.positionCartographic.height
    const camPos = cam.positionWC
    const scratch = new Cesium.Cartesian3(), toCam = new Cesium.Cartesian3()
    const proj = (lon: number, lat: number, alt = 0) => {
      const c = Cesium.Cartesian3.fromDegrees(lon, lat, alt, undefined, scratch)
      if (Cesium.Cartesian3.dot(c, Cesium.Cartesian3.subtract(camPos, c, toCam)) < 0) return null
      const s = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, c)
      return s && s.x > -40 && s.y > -40 && s.x < w + 40 && s.y < h + 40 ? s : null
    }
    const t = performance.now()

    const smp = sampler.current
    if (S.layers.wind && smp && hgt > 6e4) {
      const rect = cam.computeViewRectangle()
      const W = rect ? Cesium.Math.toDegrees(rect.west) : -180, E = rect ? Cesium.Math.toDegrees(rect.east) : 180
      const So = rect ? Math.max(-75, Cesium.Math.toDegrees(rect.south)) : -75, N = rect ? Math.min(75, Cesium.Math.toDegrees(rect.north)) : 75
      const span = E >= W ? E - W : E + 360 - W
      const spawn = (): Particle => { let x = W + Math.random() * span; if (x > 180) x -= 360; return { age: 0, life: 40 + Math.random() * 80, trail: [[x, So + Math.random() * (N - So)]] } }
      const n = hgt > 6e6 ? 1800 : 1200
      while (particles.current.length < n) { const q = spawn(); q.age = Math.random() * 40; particles.current.push(q) }
      particles.current.length = n
      const k = 0.0016 * Math.min(1.6, Math.max(0.03, hgt / 6e6))
      g.lineWidth = 1.2; g.lineCap = 'round'
      for (let i = 0; i < particles.current.length; i++) {
        const q = particles.current[i]
        const [x, y] = q.trail[q.trail.length - 1]
        const [u, vv] = smp(y, x)
        let nx = x + (u * k) / Math.max(0.2, Math.cos((y * Math.PI) / 180))
        const ny = y + vv * k
        if (nx > 180) nx -= 360; if (nx < -180) nx += 360
        q.trail.push([nx, ny]); if (q.trail.length > 7) q.trail.shift()
        q.age++
        if (q.age > q.life || ny > 78 || ny < -78) { particles.current[i] = spawn(); continue }
        const fade = Math.min(1, q.age / 10) * Math.min(1, (q.life - q.age) / 15)
        let prev: { x: number; y: number } | null = null
        g.beginPath()
        for (const [lx, ly] of q.trail) {
          const a = proj(lx, ly)
          if (a && prev && Math.abs(a.x - prev.x) < 60 && Math.abs(a.y - prev.y) < 60) g.lineTo(a.x, a.y)
          else if (a) g.moveTo(a.x, a.y)
          prev = a ? { x: a.x, y: a.y } : null
        }
        g.strokeStyle = `rgba(140,232,255,${0.5 * fade})`; g.stroke()
      }
    }

    if (S.layers.cities) {
      for (const c of S.cities) {
        if (!c.spike) continue
        const a = proj(c.lon, c.lat); if (!a) continue
        const ph = ((t / 1400) + c.lat) % 1
        g.beginPath(); g.arc(a.x, a.y, 8 + ph * 24, 0, Math.PI * 2)
        g.strokeStyle = `rgba(240,138,36,${0.8 * (1 - ph)})`; g.lineWidth = 1.6; g.stroke()
      }
    }
    const comet = (paths: [number, number, number][][] | null, rgb: string, toEnd: boolean) => {
      for (const path of paths ?? []) {
        if (path.length < 4) continue
        const L = path.length, ph = (t / 2600) % 1
        const head = Math.floor((toEnd ? ph : 1 - ph) * (L - 1))
        for (let s = 0; s < 10; s++) {
          const idx = toEnd ? head - s : head + s
          if (idx < 0 || idx >= L) break
          const q = path[idx], a = proj(q[0], q[1], 800 + q[2] * 40); if (!a) continue
          g.beginPath(); g.arc(a.x, a.y, 3.2 - s * 0.25, 0, Math.PI * 2); g.fillStyle = `rgba(${rgb},${0.95 - s * 0.09})`; g.fill()
        }
      }
    }
    comet(S.trajectories, '255,179,92', false)
    comet(S.plume, '241,230,200', true)
    if (S.network) {
      const ph = (t / 1800) % 1
      for (const n of S.network) {
        const a = proj(n.lon + (HUB.lon - n.lon) * ph, n.lat + (HUB.lat - n.lat) * ph, Math.sin(Math.PI * ph) * 3.5e5 * Math.min(1, Math.hypot(HUB.lon - n.lon, HUB.lat - n.lat) / 20))
        if (a) { g.beginPath(); g.arc(a.x, a.y, 3, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill() }
      }
    }

    if (S.hud && hgt < 8e6) {
      g.font = '600 10px "JetBrains Mono", monospace'
      const box = (x: number, y: number, r: number, color: string, label: string) => {
        const L = r * 0.45
        g.strokeStyle = color; g.lineWidth = 1.4
        g.beginPath()
        g.moveTo(x - r, y - r + L); g.lineTo(x - r, y - r); g.lineTo(x - r + L, y - r)
        g.moveTo(x + r - L, y - r); g.lineTo(x + r, y - r); g.lineTo(x + r, y - r + L)
        g.moveTo(x + r, y + r - L); g.lineTo(x + r, y + r); g.lineTo(x + r - L, y + r)
        g.moveTo(x - r + L, y + r); g.lineTo(x - r, y + r); g.lineTo(x - r, y + r - L)
        g.stroke()
        const tw = g.measureText(label).width + 8
        g.fillStyle = 'rgba(4,8,12,0.78)'; g.fillRect(x - r, y + r + 3, tw, 14)
        g.fillStyle = color; g.fillText(label, x - r + 4, y + r + 13)
      }
      let drawn = 0
      S.hotspots.forEach((hs, i) => {
        if (drawn > 24) return
        const a = proj(hs.lon, hs.lat); if (!a) return
        box(a.x, a.y, 20, 'rgba(240,150,255,0.95)', `HS-${String(i + 1).padStart(2, '0')} ${hs.fires}×DET ${hs.frp_max.toFixed(0)}MW`); drawn++
      })
      for (const c of S.cities) {
        if (drawn > 40) break
        if (!(c.spike || c.category.level >= 3 || c.id === S.selectedCity)) continue
        const a = proj(c.lon, c.lat); if (!a) continue
        box(a.x, a.y, 16, c.category.color, `${c.id.slice(0, 3).toUpperCase()} ${c.index_system === 'NAQI' ? 'NAQI' : 'AQI'} ${c.naqi ?? '—'}${c.spike ? ` ▲${c.spike.peak}` : ''}`); drawn++
      }
    }
    if (S.track) {
      const a = proj(S.track.lon, S.track.lat)
      if (a) {
        const ph = (t / 900) % 1, r = 26
        g.strokeStyle = 'rgba(111,227,255,0.95)'; g.lineWidth = 1.5
        g.beginPath(); g.arc(a.x, a.y, r, 0, Math.PI * 2); g.stroke()
        g.beginPath(); g.arc(a.x, a.y, r + 10 + ph * 10, -0.6, 0.6); g.stroke()
        g.beginPath(); g.arc(a.x, a.y, r + 10 + ph * 10, Math.PI - 0.6, Math.PI + 0.6); g.stroke()
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.beginPath(); g.moveTo(a.x + dx * (r - 8), a.y + dy * (r - 8)); g.lineTo(a.x + dx * (r + 6), a.y + dy * (r + 6)); g.stroke() }
        g.font = '600 10px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(111,227,255,0.95)'
        g.fillText(`TRK ${S.track.label.toUpperCase()}`, a.x + r + 8, a.y - r)
      }
    }
    if (S.pick) {
      const a = proj(S.pick.lon, S.pick.lat)
      if (a) {
        const ph = (t / 1200) % 1
        g.beginPath(); g.arc(a.x, a.y, 5, 0, Math.PI * 2); g.fillStyle = '#f1e6c8'; g.fill()
        g.beginPath(); g.arc(a.x, a.y, 8 + ph * 18, 0, Math.PI * 2); g.strokeStyle = `rgba(241,230,200,${1 - ph})`; g.lineWidth = 2; g.stroke()
      }
    }
  }

  return (
    <div className={`globe-wrap sensor-${p.sensor}`}>
      <div ref={el} className="globe-canvas" />
      <canvas ref={overlay} className="globe-overlay" />
      <div ref={credits} className="globe-credits" />
      {tip && <div className="globe-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 300), top: tip.y + 14 }}>{tip.text}</div>}
    </div>
  )
}
