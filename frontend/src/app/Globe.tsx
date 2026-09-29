import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { BuildingSet, City, Cluster, Corridor, Hotspot, Report, WindVec } from '../lib/api'

export type Theme = 'satellite' | 'night' | 'today'
/** Real satellite products, not colour filters: true colour, land-surface heat, aerosol haze, night lights. */
export type Lens = 'true' | 'heat' | 'haze' | 'night'
export type GlobeLayers = {
  wind: boolean; fires: boolean; cities: boolean; hotspots: boolean; reports: boolean
  sensors: boolean; corridors: boolean; aq: boolean; photoreal: boolean; sunlight: boolean
}
export type FlyTarget = { lon: number; lat: number; h?: number; range: number; pitch?: number; heading?: number; duration?: number; key?: number }
export type Track = { lon: number; lat: number; h?: number; label: string } | null
export type Telemetry = { lat: number | null; lon: number | null; alt: number; heading: number; pitch: number; photoreal: boolean; fps: number }
export type FireBin = [number, number, number, number, number]   // lat, lon, count, frpSum, frpMax
export type FireDet = [number, number, number, number]            // lat, lon, frp, ageH
export type SensorPt = [number, number, number, number]           // lat, lon, pm25, ageMin
export type NetNode = { lat: number; lon: number; name: string; fed?: string }

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
  network: NetNode[] | null
  selectedCity: string | null
  selectedReport: string | null
  pick: { lat: number; lon: number; h?: number } | null
  hub: { lat: number; lon: number } | null
  layers: GlobeLayers
  theme: Theme
  lens: Lens
  hud: boolean
  autoPhotoreal: boolean
  buildings: BuildingSet | null
  buildingTint: string | null
  /** Aerosol light extinction near the ground, per metre (from measured PM2.5 + humidity); null = no haze */
  haze: number | null
  track: Track
  flyTo: FlyTarget | null
  onCity: (id: string) => void
  onHotspot: (h: Hotspot) => void
  onReport: (id: string) => void
  onPlace: (lat: number, lon: number, h?: number) => void
  onView: (bbox: [number, number, number, number] | null, height: number) => void
  onUserMove?: () => void
}

export const LEVEL_COLORS = ['#2bb673', '#9ccc3a', '#f2c230', '#f08a24', '#e0452b', '#9b1c3a']
let GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined) || ''
export function setGoogleKey(k: string | null | undefined) { if (k) GOOGLE_KEY = k }
export const hasGoogleKey = () => !!GOOGLE_KEY

// Telemetry lives outside React state so the HUD can tick without re-rendering the app.
let telState: Telemetry | null = null
const telSubs = new Set<() => void>()
export const telemetry = {
  get: () => telState,
  subscribe: (f: () => void) => { telSubs.add(f); return () => { telSubs.delete(f) } },
}

// Depth-test markers against the planet (so the far side never shows through), but
// not within this distance of the camera — otherwise terrain/3D buildings would bury them.
const DDT = 2.5e5
const MOBILE = typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches
const inIndia = (lat: number, lon: number) => lat > 6 && lat < 37.5 && lon > 68 && lon < 97.5

const col = (hex: string, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a)
const pmLevel = (v: number) => (v <= 9 ? 0 : v <= 35.4 ? 1 : v <= 55.4 ? 2 : v <= 125.4 ? 3 : v <= 225.4 ? 4 : 5)
const fireColor = (frp: number) => (frp < 5 ? '#ffd27a' : frp < 20 ? '#ffa04a' : '#ff4a26')
const day = (ago: number) => new Date(Date.now() - ago * 86400e3).toISOString().slice(0, 10)
const gibs = (layer: string, date: string, level: number) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.png`

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

// Distance haze from measured particles: Beer–Lambert extinction along each pixel's
// line of sight, using the scene depth. Sky pixels get the full haze colour.
const HAZE_GLSL = `uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float ext;
uniform float fade;
uniform vec3 hazeColor;
in vec2 v_textureCoordinates;
void main() {
  vec4 c = texture(colorTexture, v_textureCoordinates);
  float ld = texture(depthTexture, v_textureCoordinates).r;
  float d = 40000.0;
  if (ld < 1.0) { vec4 e = czm_windowToEyeCoordinates(gl_FragCoord.xy, ld); e /= e.w; d = length(e.xyz); }
  float f = clamp((1.0 - exp(-ext * d)) * fade, 0.0, 0.93);
  out_FragColor = vec4(mix(c.rgb, hazeColor, f), c.a);
}`

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

/** Great-circle arc lifted into a gentle bow (height proportional to distance). */
function arc(a: { lat: number; lon: number }, b: { lat: number; lon: number }, n = 36): Cesium.Cartesian3[] {
  const g = new Cesium.EllipsoidGeodesic(Cesium.Cartographic.fromDegrees(a.lon, a.lat), Cesium.Cartographic.fromDegrees(b.lon, b.lat))
  const lift = Math.min(7e5, g.surfaceDistance * 0.16)
  const out: Cesium.Cartesian3[] = []
  for (let k = 0; k <= n; k++) {
    const t = k / n, c = g.interpolateUsingFraction(t)
    out.push(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, Math.sin(Math.PI * t) * lift))
  }
  return out
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
  const bPrim = useRef<Cesium.Primitive | null>(null)
  const hazeStage = useRef<Cesium.PostProcessStage | null>(null)
  const hazeFade = useRef(0)
  const sampler = useRef<ReturnType<typeof makeSampler>>(null)
  const particles = useRef<Particle[]>([])
  const arcs = useRef<Cesium.Cartesian3[][]>([])
  const idle = useRef(true)
  const orbit = useRef<{ center: Cesium.Cartesian3; heading: number; pitch: number; range: number } | null>(null)
  const themeGen = useRef(0)
  // Photorealistic ground sits on the ellipsoid + geoid (e.g. ≈ −85 m in Chennai), not at 0:
  // markers are lifted/lowered by this offset so they sit on the real surface.
  const gOff = useRef(0)
  const [gOffV, setGOffV] = useState(0)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [ready, setReady] = useState(false)

  const at = (lon: number, lat: number, h = 0) => Cesium.Cartesian3.fromDegrees(lon, lat, h + gOff.current)

  function centerLL(v: Cesium.Viewer) {
    const c = v.camera.pickEllipsoid(new Cesium.Cartesian2(v.canvas.clientWidth / 2, v.canvas.clientHeight / 2))
    if (!c) return null
    const g = Cesium.Cartographic.fromCartesian(c)
    return { lat: Cesium.Math.toDegrees(g.latitude), lon: Cesium.Math.toDegrees(g.longitude) }
  }

  function updateGround() {
    const v = viewer.current
    if (!v) return
    const set = (h: number) => { if (Math.abs(h - gOff.current) > 2) { gOff.current = h; setGOffV(h) } }
    if (!tileset.current?.show || v.camera.positionCartographic.height > 80_000) { set(0); return }
    const c = centerLL(v)
    if (!c || !v.scene.sampleHeightSupported) return
    v.scene.sampleHeightMostDetailed([Cesium.Cartographic.fromDegrees(c.lon, c.lat)])
      .then(([r]) => { if (r && Number.isFinite(r.height) && tileset.current?.show) set(r.height) })
      .catch(() => {})
  }

  function ensureTileset(show: boolean) {
    const v = viewer.current
    if (!v) return
    if (!show) { if (tileset.current) tileset.current.show = false; v.scene.globe.show = true; updateGround(); return }
    if (!GOOGLE_KEY) return
    if (tileset.current) { tileset.current.show = true; v.scene.globe.show = false; updateGround(); return }
    if (tilesetLoading.current) return
    tilesetLoading.current = true
    Cesium.createGooglePhotorealistic3DTileset({ key: GOOGLE_KEY }, { maximumScreenSpaceError: MOBILE ? 16 : 8 })
      .then((ts) => {
        tileset.current = ts; v.scene.primitives.add(ts); v.scene.primitives.lowerToBottom(ts)
        ts.show = true; v.scene.globe.show = false
        setTimeout(updateGround, 1500)
      })
      .catch(() => { /* quota / key issue: stay on the imagery globe */ })
      .finally(() => { tilesetLoading.current = false })
  }

  // ---------------------------------------------------------------- init
  useEffect(() => {
    if (!el.current) return
    const v = new Cesium.Viewer(el.current, {
      baseLayer: false, animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      creditContainer: credits.current ?? undefined, msaaSamples: MOBILE ? 1 : 4, requestRenderMode: false, showRenderLoopErrors: false,
      // Render at the display's real pixel density (the default renders at CSS pixels and
      // upscales, which looks soft on any scaled Windows/Mac/phone display).
      useBrowserRecommendedResolution: false,
    })
    const dpr = window.devicePixelRatio || 1
    const maxScale = Math.min(1, (MOBILE ? 1.6 : 2) / dpr)
    v.resolutionScale = maxScale
    v.scene.backgroundColor = Cesium.Color.fromCssColorString('#020306')
    v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0b1018')
    v.scene.globe.showGroundAtmosphere = true
    v.scene.globe.depthTestAgainstTerrain = true
    v.scene.globe.maximumScreenSpaceError = MOBILE ? 2 : 1.5
    v.scene.globe.tileCacheSize = 400
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true
    v.scene.fog.enabled = true
    v.scene.postProcessStages.fxaa.enabled = MOBILE
    v.clock.shouldAnimate = true
    v.clock.currentTime = Cesium.JulianDate.now()
    v.scene.screenSpaceCameraController.minimumZoomDistance = 80
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

    // Haze stage (enabled only when a place with measured particles is in view)
    const hz = new Cesium.PostProcessStage({
      fragmentShader: HAZE_GLSL,
      uniforms: { ext: () => P.current.haze ?? 0, fade: () => hazeFade.current, hazeColor: new Cesium.Cartesian3(0.78, 0.76, 0.71) },
    })
    hz.enabled = false
    v.scene.postProcessStages.add(hz)
    hazeStage.current = hz

    const cv = v.scene.canvas
    const userMoved = () => {
      idle.current = false
      if (orbit.current) { orbit.current = null; v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY) }
      P.current.onUserMove?.()
    }
    cv.addEventListener('pointerdown', userMoved); cv.addEventListener('wheel', userMoved, { passive: true })
    let lastTel = 0, frames = 0, fps = 60, fpsT = performance.now(), slow = 0, fast = 0
    let lastTick = performance.now()
    v.clock.onTick.addEventListener(() => {
      // motion is time-based, so a 144 Hz display doesn't spin the planet 2.4x faster
      const tick = performance.now(), k = Math.min(4, (tick - lastTick) / 16.67); lastTick = tick
      if (idle.current && v.camera.positionCartographic.height > 8e6) v.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.0004 * k)
      const o = orbit.current
      if (o) { o.heading += 0.0009 * k; v.camera.lookAt(o.center, new Cesium.HeadingPitchRange(o.heading, o.pitch, o.range)) }
      const hgt = v.camera.positionCartographic.height
      hazeFade.current = Math.max(0, Math.min(1, (30_000 - hgt) / 15_000))
      hz.enabled = P.current.haze != null && hazeFade.current > 0
      frames++
      const now = performance.now()
      if (now - fpsT > 1000) {
        fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now
        if (document.visibilityState === 'visible') {
          if (fps < 24) slow++; else slow = 0
          if (fps > 50) fast++; else fast = 0
          if (slow >= 3 && v.resolutionScale > Math.max(0.5, maxScale * 0.6)) { v.resolutionScale = Math.max(0.5, v.resolutionScale - 0.15); slow = 0 }
          if (fast >= 5 && v.resolutionScale < maxScale) { v.resolutionScale = Math.min(maxScale, v.resolutionScale + 0.1); fast = 0 }
        }
      }
      if (telSubs.size && now - lastTel > 200) {
        lastTel = now
        const c = centerLL(v)
        telState = { lat: c?.lat ?? null, lon: c?.lon ?? null, alt: hgt, heading: Cesium.Math.toDegrees(v.camera.heading),
          pitch: Cesium.Math.toDegrees(v.camera.pitch), photoreal: !!tileset.current?.show, fps }
        telSubs.forEach((f) => f())
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
      // The exact surface under the finger: 3D tiles / buildings via the depth buffer,
      // otherwise the globe (whose imagery lies on the ellipsoid).
      let cart: Cesium.Cartesian3 | undefined
      if (v.scene.pickPositionSupported && (tileset.current?.show || bPrim.current)) cart = v.scene.pickPosition(e.position)
      if (!cart) { const ray = v.camera.getPickRay(e.position); cart = ray ? v.scene.globe.pick(ray, v.scene) : undefined }
      cart = cart ?? v.camera.pickEllipsoid(e.position, v.scene.globe.ellipsoid)
      if (!cart) return
      const c = Cesium.Cartographic.fromCartesian(cart)
      P.current.onPlace(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude), tileset.current?.show ? c.height : undefined)
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
      if (P.current.autoPhotoreal && !P.current.layers.photoreal && !P.current.buildings) {
        // Google's photoreal mesh is flat over most of India — there the OSM city model is used instead.
        const c = centerLL(v)
        const india = c ? inIndia(c.lat, c.lon) : false
        if (hgt < 40_000 && !india) ensureTileset(true)
        else if (hgt > 150_000 || india) ensureTileset(false)
      }
      updateGround()
    }
    v.camera.moveEnd.addEventListener(report)
    v.scene.postRender.addEventListener(() => {
      try { drawOverlay() } catch (e) { console.warn('[albedo] overlay frame skipped', e) }
    })
    // Watchdog: Cesium stops its render loop on any exception outside scene.render
    // (e.g. in a clock listener). Restart it instead of leaving a frozen globe.
    const dog = window.setInterval(() => {
      if (viewer.current === v && !v.isDestroyed() && !v.useDefaultRenderLoop) {
        console.warn('[albedo] render loop restarted')
        v.resize(); v.useDefaultRenderLoop = true
      }
    }, 1500)
    setReady(true)
    return () => { window.clearInterval(dog); h.destroy(); v.destroy(); viewer.current = null }
  }, [])

  // ---------------------------------------------------------------- imagery theme, HD tiles & lenses
  useEffect(() => {
    const v = viewer.current; if (!v) return
    const gen = ++themeGen.current
    const L = v.imageryLayers
    L.removeAll()
    const yday = day(1.5)
    const labels = () => {
      const lbl = new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19, credit: 'Boundaries & places © Esri' }), { maximumTerrainLevel: 12 })
      lbl.alpha = 0.9
      L.add(lbl)
    }
    if (p.theme === 'satellite') {
      L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19, credit: 'Imagery © Esri, Maxar, Earthstar Geographics' }))
      // Google's own satellite tiles take over once you zoom into a region (sharper, newer).
      if (GOOGLE_KEY) {
        Cesium.Google2DImageryProvider.fromUrl({ key: GOOGLE_KEY, mapType: 'satellite', language: 'en', region: 'IN' })
          .then((prov) => { if (gen === themeGen.current) L.add(new Cesium.ImageryLayer(prov as unknown as Cesium.ImageryProvider, { minimumTerrainLevel: 10 }), 1) })
          .catch(() => { /* Esri stays */ })
      }
    } else if (p.theme === 'today') {
      L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${yday}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
        maximumLevel: 9, credit: `NASA GIBS · VIIRS NOAA-20 true colour · ${yday}` }))
    } else {
      const base = L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', subdomains: ['a', 'b', 'c', 'd'],
        maximumLevel: 18, credit: '© OpenStreetMap contributors © CARTO' }))
      base.brightness = 1.25
    }
    const lens = p.lens === 'heat' ? { url: gibs('MODIS_Terra_Land_Surface_Temp_Day', day(1), 7), max: 7, a: 0.78, c: `NASA MODIS Terra land-surface temperature · ${day(1)}` }
      : p.lens === 'haze' ? { url: gibs('MODIS_Combined_Value_Added_AOD', day(2.5), 6), max: 6, a: 0.74, c: `NASA MODIS aerosol optical depth · ${day(2.5)}` }
      : p.lens === 'night' ? { url: gibs('VIIRS_Black_Marble', '2016-01-01', 8), max: 8, a: 1, c: 'NASA Black Marble night lights (VIIRS)' } : null
    if (lens) {
      const l = L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url: lens.url, maximumLevel: lens.max, credit: lens.c }))
      l.alpha = lens.a
    }
    if (p.theme !== 'night') labels()
    if (p.layers.aq && GOOGLE_KEY) {
      const aq = L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: `https://airquality.googleapis.com/v1/mapTypes/UAQI_RED_GREEN/heatmapTiles/{z}/{x}/{y}?key=${GOOGLE_KEY}`,
        maximumLevel: 12, credit: 'Air quality heatmap © Google' }))
      aq.alpha = 0.55
    }
    v.scene.globe.enableLighting = p.layers.sunlight && p.theme !== 'night' && p.lens !== 'night'
    v.scene.globe.dynamicAtmosphereLighting = v.scene.globe.enableLighting
  }, [p.theme, p.lens, p.layers.aq, p.layers.sunlight, ready])

  useEffect(() => { if (ready) ensureTileset(p.layers.photoreal && !p.buildings) }, [p.layers.photoreal, p.buildings, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- 3D city model (OpenStreetMap footprints)
  useEffect(() => {
    const v = viewer.current; if (!v) return
    if (bPrim.current) { v.scene.primitives.remove(bPrim.current); bPrim.current = null }
    const B = p.buildings
    if (!B?.buildings.length) return
    const tint = Cesium.Color.fromCssColorString(p.buildingTint ?? '#dfe8f2')
    const low = Cesium.Color.lerp(Cesium.Color.fromCssColorString('#cfd9e6'), tint, 0.14, new Cesium.Color())
    const hi = Cesium.Color.lerp(Cesium.Color.fromCssColorString('#f7fbff'), tint, 0.06, new Cesium.Color())
    const inst: Cesium.GeometryInstance[] = []
    for (const [base, top, est, ring] of B.buildings) {
      try {
        const c = Cesium.Color.lerp(low, hi, Math.min(1, top / 70), new Cesium.Color())
        inst.push(new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring)),
            height: base, extrudedHeight: top, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(est ? c : Cesium.Color.lerp(c, Cesium.Color.WHITE, 0.25, new Cesium.Color())) },
        }))
      } catch { /* degenerate footprint */ }
    }
    const prim = new Cesium.Primitive({
      geometryInstances: inst, asynchronous: true, releaseGeometryInstances: true,
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true }),
    })
    v.scene.primitives.add(prim)
    bPrim.current = prim
  }, [p.buildings, p.buildingTint, ready])

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
      const pos = at(c.lon, c.lat, 30)
      const sel = c.id === p.selectedCity
      glow.add({ position: pos, pixelSize: 12 + Math.sqrt(c.pop_m) * 3.2, color: col(color, 0.2), disableDepthTestDistance: DDT,
        scaleByDistance: new Cesium.NearFarScalar(3e5, 1.0, 1.5e7, 0.6), translucencyByDistance: new Cesium.NearFarScalar(4e4, 0, 2.5e5, 1) })
      pts.add({ position: pos, pixelSize: (sel ? 11 : 7) + Math.sqrt(c.pop_m) * 0.9, color: col(color),
        outlineColor: sel ? Cesium.Color.WHITE : col('#05070b'), outlineWidth: sel ? 2.5 : 1.5, disableDepthTestDistance: DDT,
        scaleByDistance: new Cesium.NearFarScalar(3e5, 1.0, 1.5e7, 0.7), translucencyByDistance: new Cesium.NearFarScalar(6e3, 0, 3e4, 1),
        id: { kind: 'city', id: c.id, label: `${c.name}, ${c.india ? c.state_name : c.country_name} · ${c.index_system} ${c.naqi ?? '—'} (${c.category.label})` } as Tag })
      const tagText = sel ? `${c.name} · ${c.naqi ?? '—'}` : c.naqi != null ? String(c.naqi) : ''
      if (!tagText) continue // an empty label has zero width and would crash Cesium's renderer
      labels.add({ position: pos, text: tagText,
        font: '700 12px "JetBrains Mono", monospace', fillColor: col('#0b0d12'),
        showBackground: true, backgroundColor: col(color, 0.92), backgroundPadding: new Cesium.Cartesian2(5, 3),
        pixelOffset: new Cesium.Cartesian2(10, -12), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        disableDepthTestDistance: DDT, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(3e4, sel ? 3e7 : 4.2e6) })
    }
  }, [p.cities, p.frameLevel, p.selectedCity, p.layers.cities, ready, gOffV]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const f = coll.current.fires as Cesium.PointPrimitiveCollection
    if (!f) return
    f.removeAll()
    if (!p.layers.fires) return
    if (p.fireDets) {
      for (const [lat, lon, frp, age] of p.fireDets) {
        f.add({ position: at(lon, lat, 20), pixelSize: 3 + Math.min(6, Math.sqrt(frp) * 0.8),
          color: col(fireColor(frp), age < 12 ? 0.95 : 0.6), outlineColor: col('#1a0800', 0.8), outlineWidth: 1, disableDepthTestDistance: DDT,
          id: { kind: 'fire', label: `NASA heat detection · ${frp.toFixed(1)} MW · ${age.toFixed(0)} h ago` } as Tag })
      }
    } else {
      for (const [lat, lon, n, , mx] of p.fireBins) {
        f.add({ position: at(lon, lat, 20), pixelSize: 2 + Math.min(6, Math.sqrt(n) * 0.7),
          color: col(fireColor(mx), 0.7), disableDepthTestDistance: DDT,
          id: { kind: 'fire', label: `${n} NASA heat detection${n > 1 ? 's' : ''} in this ~100 km cell (24 h) · strongest ${mx} MW` } as Tag })
      }
    }
  }, [p.fireBins, p.fireDets, p.layers.fires, ready, gOffV]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = coll.current.sensors as Cesium.PointPrimitiveCollection
    if (!s) return
    s.removeAll()
    if (!p.layers.sensors) return
    const vis = new Cesium.DistanceDisplayCondition(0, 6e6)
    for (const [lat, lon, pm, age] of p.citizen) {
      s.add({ position: at(lon, lat, 8), pixelSize: 4, color: col(LEVEL_COLORS[pmLevel(pm)], 0.85),
        distanceDisplayCondition: vis, disableDepthTestDistance: DDT,
        id: { kind: 'sensor', label: `Citizen sensor · PM2.5 ${pm} µg/m³ · ${age} min ago (low-cost, uncalibrated)` } as Tag })
    }
    for (const [lat, lon, pm, age] of p.stations) {
      s.add({ position: at(lon, lat, 8), pixelSize: 7, color: col(LEVEL_COLORS[pmLevel(pm)]),
        outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5, distanceDisplayCondition: vis, disableDepthTestDistance: DDT,
        id: { kind: 'station', label: `Official monitor · PM2.5 ${pm} µg/m³ · ${age} min ago (OpenAQ reference monitor)` } as Tag })
    }
  }, [p.citizen, p.stations, p.layers.sensors, ready, gOffV]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const b = coll.current.hotspots as Cesium.BillboardCollection
    if (!b) return
    b.removeAll()
    if (!p.layers.hotspots) return
    p.hotspots.forEach((h, i) => b.add({
      position: at(h.lon, h.lat, 40), image: ringIcon(i + 1), width: 30, height: 30, disableDepthTestDistance: DDT,
      id: { kind: 'hotspot', data: h, label: `Hidden hotspot #${i + 1} · ${h.admin?.district || h.place.label} — ${h.why}` } as Tag,
    }))
  }, [p.hotspots, p.layers.hotspots, ready, gOffV]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const b = coll.current.reports as Cesium.BillboardCollection
    if (!b) return
    b.removeAll()
    if (!p.layers.reports) return
    for (const r of p.reports) b.add({
      position: at(r.lon, r.lat, 20), image: reportIcon(r.verification.status),
      width: r.id === p.selectedReport ? 34 : 24, height: r.id === p.selectedReport ? 34 : 24, disableDepthTestDistance: DDT,
      id: { kind: 'report', id: r.id, label: `Citizen report · ${r.analysis.source_label} · ${r.verification.status}` } as Tag,
    })
  }, [p.reports, p.selectedReport, p.layers.reports, ready, gOffV]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const b = coll.current.hub as Cesium.BillboardCollection
    if (!b) return
    b.removeAll()
    if (p.hub) b.add({ position: at(p.hub.lon, p.hub.lat, 10), image: hubIcon(), width: 30, height: 30, disableDepthTestDistance: DDT })
  }, [p.hub, ready, gOffV]) // eslint-disable-line react-hooks/exhaustive-deps

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
      position: at(c.lon, c.lat, 40), image: ringIcon(Math.round(c.share * 100), '#ffb35c'),
      width: 24 + c.share * 26, height: 24 + c.share * 26, disableDepthTestDistance: DDT,
      id: { kind: 'fire', label: `${c.place.label}: ${c.fires} detections carry ~${Math.round(c.share * 100)}% of incoming fire smoke (~${c.transport_h} h transport)` } as Tag,
    })
  }, [p.trajectories, p.plume, p.clusters, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Federation network: each node links to its own federation's aggregator (the centroid of
  // its members) along a great-circle bow — not one tangle of lines to a single hub.
  useEffect(() => {
    const a = coll.current.arcs as Cesium.PolylineCollection
    if (!a) return
    a.removeAll(); arcs.current = []
    const nodes = p.network ?? []
    const hubs = new Map<string, { lat: number; lon: number; n: number }>()
    for (const n of nodes) {
      const k = n.fed ?? 'global', h = hubs.get(k) ?? { lat: 0, lon: 0, n: 0 }
      h.lat += n.lat; h.lon += n.lon; h.n++; hubs.set(k, h)
    }
    for (const n of nodes) {
      const h = hubs.get(n.fed ?? 'global')!
      const hub = { lat: h.lat / h.n, lon: h.lon / h.n }
      if (Math.hypot(hub.lat - n.lat, hub.lon - n.lon) < 0.3) continue
      const pts = arc(n, hub)
      arcs.current.push(pts)
      a.add({ positions: pts, width: 2.2, material: Cesium.Material.fromType('PolylineGlow', { color: col('#6fe3ff', 0.55), glowPower: 0.22 }) })
    }
  }, [p.network, ready])

  // ---------------------------------------------------------------- camera & tracking
  useEffect(() => {
    const v = viewer.current, f = p.flyTo
    if (!v || !f) return
    idle.current = false
    if (orbit.current) { orbit.current = null; v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY) }
    const h0 = f.h ?? (tileset.current?.show ? gOff.current : 0)
    const hpr = new Cesium.HeadingPitchRange(Cesium.Math.toRadians(f.heading ?? 0), Cesium.Math.toRadians(f.pitch ?? -50), f.range)
    v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(f.lon, f.lat, h0), 1), {
      offset: hpr, duration: f.duration ?? 2.4,
      complete: () => {
        const tr = P.current.track
        const tracking = tr && Math.abs(tr.lon - f.lon) < 1e-3 && Math.abs(tr.lat - f.lat) < 1e-3
        if (tracking) orbit.current = { center: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, h0), heading: v.camera.heading, pitch: v.camera.pitch, range: f.range }
        // On photoreal ground, re-centre on the real surface once its tiles are loaded.
        if (tileset.current?.show && f.h == null && f.range < 60_000 && v.scene.sampleHeightSupported) {
          v.scene.sampleHeightMostDetailed([Cesium.Cartographic.fromDegrees(f.lon, f.lat)]).then(([r]) => {
            if (!r || !Number.isFinite(r.height) || Math.abs(r.height - h0) < 3) return
            const c = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, r.height)
            if (orbit.current) orbit.current.center = c
            else if (!idle.current) v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(c, 1), {
              offset: new Cesium.HeadingPitchRange(v.camera.heading, v.camera.pitch, f.range), duration: 0.6 })
          }).catch(() => {})
        }
      },
    })
  }, [p.flyTo])

  useEffect(() => {
    const v = viewer.current
    if (!p.track && orbit.current && v) { orbit.current = null; v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY) }
  }, [p.track])

  useEffect(() => { sampler.current = makeSampler(p.wind); particles.current = [] }, [p.wind])

  // ---------------------------------------------------------------- overlay (drawn in the same frame as the globe)
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
    const off = gOff.current
    const scratch = new Cesium.Cartesian3(), toCam = new Cesium.Cartesian3(), out = new Cesium.Cartesian2()
    const projC = (c: Cesium.Cartesian3): [number, number] | null => {
      if (Cesium.Cartesian3.dot(c, Cesium.Cartesian3.subtract(camPos, c, toCam)) < 0) return null
      const s = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, c, out)
      return s && s.x > -40 && s.y > -40 && s.x < w + 40 && s.y < h + 40 ? [s.x, s.y] : null
    }
    const proj = (lon: number, lat: number, alt = 0) => projC(Cesium.Cartesian3.fromDegrees(lon, lat, alt + off, undefined, scratch))
    const t = performance.now()

    const smp = sampler.current
    if (S.layers.wind && smp && hgt > 6e4) {
      const rect = cam.computeViewRectangle()
      const W = rect ? Cesium.Math.toDegrees(rect.west) : -180, E = rect ? Cesium.Math.toDegrees(rect.east) : 180
      const So = rect ? Math.max(-75, Cesium.Math.toDegrees(rect.south)) : -75, N = rect ? Math.min(75, Cesium.Math.toDegrees(rect.north)) : 75
      const span = E >= W ? E - W : E + 360 - W
      const spawn = (): Particle => { let x = W + Math.random() * span; if (x > 180) x -= 360; return { age: 0, life: 40 + Math.random() * 80, trail: [[x, So + Math.random() * (N - So)]] } }
      const n = MOBILE ? 500 : hgt > 6e6 ? 1100 : 800
      while (particles.current.length < n) { const q = spawn(); q.age = Math.random() * 40; particles.current.push(q) }
      particles.current.length = n
      const k = 0.0016 * Math.min(1.6, Math.max(0.03, hgt / 6e6))
      // batch strokes by opacity bucket: 4 paths per frame instead of one per particle
      const buckets = [new Path2D(), new Path2D(), new Path2D(), new Path2D()]
      for (let i = 0; i < particles.current.length; i++) {
        const q = particles.current[i]
        const [x, y] = q.trail[q.trail.length - 1]
        const [u, vv] = smp(y, x)
        let nx = x + (u * k) / Math.max(0.2, Math.cos((y * Math.PI) / 180))
        const ny = y + vv * k
        if (nx > 180) nx -= 360; if (nx < -180) nx += 360
        q.trail.push([nx, ny]); if (q.trail.length > 6) q.trail.shift()
        q.age++
        if (q.age > q.life || ny > 78 || ny < -78) { particles.current[i] = spawn(); continue }
        const fade = Math.min(1, q.age / 10) * Math.min(1, (q.life - q.age) / 15)
        const path = buckets[Math.min(3, Math.floor(fade * 4))]
        let prev: [number, number] | null = null
        for (const [lx, ly] of q.trail) {
          const a = proj(lx, ly, -off)
          if (a && prev && Math.abs(a[0] - prev[0]) < 60 && Math.abs(a[1] - prev[1]) < 60) path.lineTo(a[0], a[1])
          else if (a) path.moveTo(a[0], a[1])
          prev = a
        }
      }
      g.lineWidth = 1.2; g.lineCap = 'round'
      buckets.forEach((b, i) => { g.strokeStyle = `rgba(140,232,255,${0.12 + i * 0.13})`; g.stroke(b) })
    }

    if (S.layers.cities) {
      for (const c of S.cities) {
        if (!c.spike) continue
        const a = proj(c.lon, c.lat); if (!a) continue
        const ph = ((((t / 1400) + c.lat) % 1) + 1) % 1
        g.beginPath(); g.arc(a[0], a[1], 8 + ph * 24, 0, Math.PI * 2)
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
          const q = path[idx], a = proj(q[0], q[1], 800 + q[2] * 40 - off); if (!a) continue
          g.beginPath(); g.arc(a[0], a[1], Math.max(0.5, 3.2 - s * 0.25), 0, Math.PI * 2); g.fillStyle = `rgba(${rgb},${0.95 - s * 0.09})`; g.fill()
        }
      }
    }
    comet(S.trajectories, '255,179,92', false)
    comet(S.plume, '241,230,200', true)
    if (arcs.current.length) {
      const ph = (t / 2200) % 1
      g.fillStyle = 'rgba(255,255,255,0.95)'
      for (const pts of arcs.current) {
        const a = projC(pts[Math.floor(ph * (pts.length - 1))])
        if (a) { g.beginPath(); g.arc(a[0], a[1], 2.6, 0, Math.PI * 2); g.fill() }
      }
    }

    if (S.hud && hgt < 8e6) {
      g.font = '600 10px "JetBrains Mono", monospace'
      const drawnRects: [number, number, number, number][] = []
      const box = (x: number, y: number, r: number, color: string, label: string) => {
        const tw = g.measureText(label).width + 8
        const rect: [number, number, number, number] = [x - r, y - r, Math.max(2 * r, tw), 2 * r + 18]
        if (drawnRects.some(([a, b, cw, ch]) => rect[0] < a + cw && a < rect[0] + rect[2] && rect[1] < b + ch && b < rect[1] + rect[3])) return false
        drawnRects.push(rect)
        const L = r * 0.45
        g.strokeStyle = color; g.lineWidth = 1.4
        g.beginPath()
        g.moveTo(x - r, y - r + L); g.lineTo(x - r, y - r); g.lineTo(x - r + L, y - r)
        g.moveTo(x + r - L, y - r); g.lineTo(x + r, y - r); g.lineTo(x + r, y - r + L)
        g.moveTo(x + r, y + r - L); g.lineTo(x + r, y + r); g.lineTo(x + r - L, y + r)
        g.moveTo(x - r + L, y + r); g.lineTo(x - r, y + r); g.lineTo(x - r, y + r - L)
        g.stroke()
        g.fillStyle = 'rgba(4,8,12,0.78)'; g.fillRect(x - r, y + r + 3, tw, 14)
        g.fillStyle = color; g.fillText(label, x - r + 4, y + r + 13)
        return true
      }
      let drawn = 0
      S.hotspots.forEach((hs, i) => {
        if (drawn >= 8) return
        const a = proj(hs.lon, hs.lat); if (!a) return
        if (box(a[0], a[1], 20, 'rgba(240,150,255,0.95)', `HS-${String(i + 1).padStart(2, '0')} ${hs.fires} DET · ${hs.frp_max.toFixed(0)} MW`)) drawn++
      })
      for (const c of S.cities) {
        if (drawn >= 18) break
        if (!(c.spike || c.category.level >= 4 || c.id === S.selectedCity)) continue
        const a = proj(c.lon, c.lat); if (!a) continue
        if (box(a[0], a[1], 16, c.category.color, `${c.name.slice(0, 12).toUpperCase()} ${c.index_system === 'NAQI' ? 'NAQI' : 'AQI'} ${c.naqi ?? '—'}${c.spike ? ` ▲${c.spike.peak}` : ''}`)) drawn++
      }
    }
    if (S.track) {
      const a = S.track.h != null ? projC(Cesium.Cartesian3.fromDegrees(S.track.lon, S.track.lat, S.track.h, undefined, scratch)) : proj(S.track.lon, S.track.lat)
      if (a) {
        const ph = (t / 900) % 1, r = 26
        g.strokeStyle = 'rgba(111,227,255,0.95)'; g.lineWidth = 1.5
        g.beginPath(); g.arc(a[0], a[1], r, 0, Math.PI * 2); g.stroke()
        g.beginPath(); g.arc(a[0], a[1], r + 10 + ph * 10, -0.6, 0.6); g.stroke()
        g.beginPath(); g.arc(a[0], a[1], r + 10 + ph * 10, Math.PI - 0.6, Math.PI + 0.6); g.stroke()
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.beginPath(); g.moveTo(a[0] + dx * (r - 8), a[1] + dy * (r - 8)); g.lineTo(a[0] + dx * (r + 6), a[1] + dy * (r + 6)); g.stroke() }
        g.font = '600 10px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(111,227,255,0.95)'
        g.fillText(`TRK ${S.track.label.toUpperCase()}`, a[0] + r + 8, a[1] - r)
      }
    }
    if (S.pick) {
      const a = S.pick.h != null ? projC(Cesium.Cartesian3.fromDegrees(S.pick.lon, S.pick.lat, S.pick.h, undefined, scratch)) : proj(S.pick.lon, S.pick.lat)
      if (a) {
        const ph = (t / 1200) % 1
        g.beginPath(); g.arc(a[0], a[1], 5, 0, Math.PI * 2); g.fillStyle = '#f1e6c8'; g.fill()
        g.beginPath(); g.arc(a[0], a[1], 8 + ph * 18, 0, Math.PI * 2); g.strokeStyle = `rgba(241,230,200,${1 - ph})`; g.lineWidth = 2; g.stroke()
      }
    }
  }

  return (
    <div className="globe-wrap">
      <div ref={el} className="globe-canvas" />
      <canvas ref={overlay} className="globe-overlay" />
      <div ref={credits} className="globe-credits" />
      {tip && <div className="globe-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 300), top: tip.y + 14 }}>{tip.text}</div>}
    </div>
  )
}
