import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { City, Cluster, Corridor, Hotspot, Report, WindVec } from '../lib/api'

export type Theme = 'satellite' | 'night' | 'today'
export type GlobeLayers = {
  wind: boolean; fires: boolean; cities: boolean; hotspots: boolean; reports: boolean
  sensors: boolean; corridors: boolean; aq: boolean; photoreal: boolean; sunlight: boolean
}
export type FlyTarget = { lon: number; lat: number; range: number; pitch?: number; heading?: number; duration?: number; key?: number }
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
  layers: GlobeLayers
  theme: Theme
  flyTo: FlyTarget | null
  onCity: (id: string) => void
  onHotspot: (h: Hotspot) => void
  onReport: (id: string) => void
  onPlace: (lat: number, lon: number) => void
  onView: (bbox: [number, number, number, number] | null, height: number) => void
}

export const LEVEL_COLORS = ['#2bb673', '#9ccc3a', '#f2c230', '#f08a24', '#e0452b', '#9b1c3a']
let GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined) || ''
export function setGoogleKey(k: string | null | undefined) { if (k) GOOGLE_KEY = k }
const HUB = { lat: 21.15, lon: 79.09 }

const col = (hex: string, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a)
const pmLevel = (v: number) => (v <= 9 ? 0 : v <= 35.4 ? 1 : v <= 55.4 ? 2 : v <= 125.4 ? 3 : v <= 225.4 ? 4 : 5)
const fireColor = (frp: number) => (frp < 5 ? '#ffd27a' : frp < 20 ? '#ffa04a' : frp < 100 ? '#ff6a2b' : '#ff3322')

type Tag = { kind: 'city' | 'hotspot' | 'report' | 'fire' | 'sensor' | 'station'; id?: string; data?: unknown; label: string }

function ringIcon(rank: number, color = '#f096ff'): string {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.fillStyle = 'rgba(20,6,24,0.78)'; g.fill()
  g.lineWidth = 3; g.strokeStyle = color; g.stroke()
  g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = 'rgba(240,150,255,0.45)'; g.stroke()
  g.fillStyle = '#fff'; g.font = '700 22px Inter Tight, Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(String(rank), 32, 33)
  return c.toDataURL()
}

function reportIcon(status: string): string {
  const c = document.createElement('canvas'); c.width = c.height = 48
  const g = c.getContext('2d')!
  const fill = status === 'verified' ? '#f1e6c8' : status === 'rejected' ? '#6b7280' : 'rgba(241,230,200,0.7)'
  g.beginPath(); g.arc(24, 24, 13, 0, Math.PI * 2); g.fillStyle = fill; g.fill()
  g.lineWidth = 3; g.strokeStyle = '#05070b'; g.stroke()
  g.fillStyle = '#05070b'; g.font = '700 15px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('✦', 24, 25)
  return c.toDataURL()
}

// ---- wind sampler over any regular lat/lon grid -------------------------------- //
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

type Particle = { x: number; y: number; age: number; life: number; trail: [number, number][] }

export default function Globe(p: GlobeProps) {
  const el = useRef<HTMLDivElement>(null)
  const credits = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const viewer = useRef<Cesium.Viewer | null>(null)
  const P = useRef(p); P.current = p
  const coll = useRef<Record<string, Cesium.PointPrimitiveCollection | Cesium.BillboardCollection | Cesium.LabelCollection | Cesium.PolylineCollection>>({})
  const tileset = useRef<Cesium.Cesium3DTileset | null>(null)
  const aqLayer = useRef<Cesium.ImageryLayer | null>(null)
  const sampler = useRef<ReturnType<typeof makeSampler>>(null)
  const particles = useRef<Particle[]>([])
  const idle = useRef(true)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [ready, setReady] = useState(false)

  // ---------------------------------------------------------------- init
  useEffect(() => {
    if (!el.current) return
    const v = new Cesium.Viewer(el.current, {
      baseLayer: false, animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      creditContainer: credits.current ?? undefined, msaaSamples: 4, requestRenderMode: false,
    })
    v.scene.backgroundColor = Cesium.Color.fromCssColorString('#020306')
    v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0b1018')
    v.scene.globe.showGroundAtmosphere = true
    v.scene.globe.depthTestAgainstTerrain = false
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true
    v.scene.fog.enabled = true
    v.scene.highDynamicRange = false
    v.scene.postProcessStages.fxaa.enabled = true
    v.clock.shouldAnimate = true
    v.clock.currentTime = Cesium.JulianDate.now()
    v.scene.screenSpaceCameraController.minimumZoomDistance = 150
    v.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(79, 18, 17_500_000) })
    viewer.current = v
    for (const [k, c] of Object.entries({
      corridors: new Cesium.PolylineCollection(), traj: new Cesium.PolylineCollection(), arcs: new Cesium.PolylineCollection(),
      fires: new Cesium.PointPrimitiveCollection(), sensors: new Cesium.PointPrimitiveCollection(),
      cityGlow: new Cesium.PointPrimitiveCollection(), cities: new Cesium.PointPrimitiveCollection(),
      labels: new Cesium.LabelCollection(), clusters: new Cesium.BillboardCollection(),
      hotspots: new Cesium.BillboardCollection(), reports: new Cesium.BillboardCollection(),
    })) { v.scene.primitives.add(c); coll.current[k] = c }

    // idle auto-rotate until the first interaction
    const stop = () => { idle.current = false }
    const cv = v.scene.canvas
    cv.addEventListener('pointerdown', stop); cv.addEventListener('wheel', stop)
    v.clock.onTick.addEventListener(() => {
      if (idle.current && v.camera.positionCartographic.height > 8e6) v.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.0004)
    })

    // picking & hover
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

    // report the view so the parent can fetch detail (e.g. individual fire detections)
    const report = () => {
      const r = v.camera.computeViewRectangle()
      const hgt = v.camera.positionCartographic.height
      P.current.onView(r ? [Cesium.Math.toDegrees(r.west), Cesium.Math.toDegrees(r.south), Cesium.Math.toDegrees(r.east), Cesium.Math.toDegrees(r.north)] : null, hgt)
    }
    v.camera.moveEnd.addEventListener(report)

    // canvas overlay: wind particles, spike rings, animated trajectories
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
    if (p.theme === 'satellite') {
      L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19, credit: 'Imagery © Esri, Maxar, Earthstar Geographics' }))
      const lbl = L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19, credit: 'Boundaries © Esri' }))
      lbl.alpha = 0.85
    } else if (p.theme === 'today') {
      L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${yday}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
        maximumLevel: 9, credit: `NASA GIBS · VIIRS NOAA-20 true colour · ${yday}` }))
      const lbl = L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19, credit: 'Boundaries © Esri' }))
      lbl.alpha = 0.8
    } else {
      const base = L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', subdomains: ['a', 'b', 'c', 'd'],
        maximumLevel: 18, credit: '© OpenStreetMap contributors © CARTO' }))
      base.brightness = 1.25
    }
    aqLayer.current = null
    if (p.layers.aq && GOOGLE_KEY) {
      aqLayer.current = L.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: `https://airquality.googleapis.com/v1/mapTypes/UAQI_RED_GREEN/heatmapTiles/{z}/{x}/{y}?key=${GOOGLE_KEY}`,
        maximumLevel: 12, credit: 'Air quality heatmap © Google' }))
      aqLayer.current.alpha = 0.55
    }
    v.scene.globe.enableLighting = p.layers.sunlight && p.theme !== 'night'
    v.scene.globe.dynamicAtmosphereLighting = v.scene.globe.enableLighting
  }, [p.theme, p.layers.aq, p.layers.sunlight, ready])

  // ---------------------------------------------------------------- Google photorealistic 3D
  useEffect(() => {
    const v = viewer.current; if (!v) return
    let dead = false
    if (p.layers.photoreal && GOOGLE_KEY) {
      if (!tileset.current) {
        Cesium.createGooglePhotorealistic3DTileset({ key: GOOGLE_KEY }, { maximumScreenSpaceError: 12 })
          .then((ts) => { if (dead) return; tileset.current = ts; v.scene.primitives.add(ts); ts.show = true; v.scene.globe.show = false })
          .catch(() => { /* key/quota issue: stay on imagery globe */ })
      } else { tileset.current.show = true; v.scene.globe.show = false }
    } else if (tileset.current) { tileset.current.show = false; v.scene.globe.show = true }
    return () => { dead = true }
  }, [p.layers.photoreal, ready])

  // ---------------------------------------------------------------- cities
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
      glow.add({ position: pos, pixelSize: 14 + Math.sqrt(c.pop_m) * 4.5, color: col(color, 0.22), disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(2e5, 1.4, 1.5e7, 0.6) })
      pts.add({ position: pos, pixelSize: (sel ? 11 : 7) + Math.sqrt(c.pop_m) * 1.1, color: col(color),
        outlineColor: sel ? Cesium.Color.WHITE : col('#05070b'), outlineWidth: sel ? 2.5 : 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new Cesium.NearFarScalar(2e5, 1.4, 1.5e7, 0.75),
        id: { kind: 'city', id: c.id, label: `${c.name} · ${c.index_system} ${c.naqi ?? '—'} (${c.category.label})` } as Tag })
      if (c.pop_m >= 6 || sel || c.india && c.pop_m >= 2.5) {
        labels.add({ position: pos, text: c.name, font: '600 13px "Inter Tight", Inter, sans-serif',
          fillColor: Cesium.Color.WHITE, outlineColor: col('#04060a', 0.9), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, sel || c.pop_m >= 12 ? 2.4e7 : 7e6),
          scaleByDistance: new Cesium.NearFarScalar(3e5, 1.1, 1.2e7, 0.75) })
      }
    }
  }, [p.cities, p.frameLevel, p.selectedCity, p.layers.cities, ready])

  // ---------------------------------------------------------------- fires (honest: small, sized by real heat output)
  useEffect(() => {
    const f = coll.current.fires as Cesium.PointPrimitiveCollection
    if (!f) return
    f.removeAll()
    if (!p.layers.fires) return
    if (p.fireDets) {
      for (const [lat, lon, frp, age] of p.fireDets) {
        f.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 40), pixelSize: 3 + Math.min(7, Math.sqrt(frp) * 0.9),
          color: col(fireColor(frp), age < 12 ? 0.95 : 0.6), outlineColor: col('#1a0800', 0.8), outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new Cesium.NearFarScalar(5e3, 1.6, 3e6, 0.8),
          id: { kind: 'fire', label: `Satellite heat detection · ${frp.toFixed(1)} MW · ${age.toFixed(0)} h ago` } as Tag })
      }
    } else {
      for (const [lat, lon, n, , mx] of p.fireBins) {
        f.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 40), pixelSize: 2 + Math.min(7, Math.sqrt(n) * 0.8),
          color: col(fireColor(mx), 0.75), disableDepthTestDistance: Number.POSITIVE_INFINITY,
          id: { kind: 'fire', label: `${n} heat detection${n > 1 ? 's' : ''} in this 1° cell (24 h) · max ${mx} MW` } as Tag })
      }
    }
  }, [p.fireBins, p.fireDets, p.layers.fires, ready])

  // ---------------------------------------------------------------- ground sensors
  useEffect(() => {
    const s = coll.current.sensors as Cesium.PointPrimitiveCollection
    if (!s) return
    s.removeAll()
    if (!p.layers.sensors) return
    const far = new Cesium.NearFarScalar(2e4, 1.4, 6e6, 0.35)
    const vis = new Cesium.DistanceDisplayCondition(0, 9e6)
    for (const [lat, lon, pm, age] of p.citizen) {
      s.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 30), pixelSize: 4.5, color: col(LEVEL_COLORS[pmLevel(pm)], 0.9),
        scaleByDistance: far, distanceDisplayCondition: vis, disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { kind: 'sensor', label: `Citizen sensor · PM2.5 ${pm} µg/m³ · ${age} min ago (low-cost, uncalibrated)` } as Tag })
    }
    for (const [lat, lon, pm, age] of p.stations) {
      s.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 30), pixelSize: 7, color: col(LEVEL_COLORS[pmLevel(pm)]),
        outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5, scaleByDistance: far, distanceDisplayCondition: vis,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { kind: 'station', label: `Official monitor · PM2.5 ${pm} µg/m³ · ${age} min ago (OpenAQ)` } as Tag })
    }
  }, [p.citizen, p.stations, p.layers.sensors, ready])

  // ---------------------------------------------------------------- hotspots (numbered, always legible)
  useEffect(() => {
    const b = coll.current.hotspots as Cesium.BillboardCollection
    if (!b) return
    b.removeAll()
    if (!p.layers.hotspots) return
    p.hotspots.forEach((h, i) => b.add({
      position: Cesium.Cartesian3.fromDegrees(h.lon, h.lat, 80), image: ringIcon(i + 1), width: 34, height: 34,
      disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new Cesium.NearFarScalar(1e5, 1.3, 1.5e7, 0.7),
      id: { kind: 'hotspot', data: h, label: `#${i + 1} ${h.admin?.district || h.place.label} — ${h.why}` } as Tag,
    }))
  }, [p.hotspots, p.layers.hotspots, ready])

  // ---------------------------------------------------------------- reports
  useEffect(() => {
    const b = coll.current.reports as Cesium.BillboardCollection
    if (!b) return
    b.removeAll()
    if (!p.layers.reports) return
    for (const r of p.reports) b.add({
      position: Cesium.Cartesian3.fromDegrees(r.lon, r.lat, 60), image: reportIcon(r.verification.status),
      width: r.id === p.selectedReport ? 34 : 26, height: r.id === p.selectedReport ? 34 : 26,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      id: { kind: 'report', id: r.id, label: `Citizen report · ${r.analysis.source_label} · ${r.verification.status}` } as Tag,
    })
  }, [p.reports, p.selectedReport, p.layers.reports, ready])

  // ---------------------------------------------------------------- polylines: corridors, trajectories, plume, arcs, clusters
  useEffect(() => {
    const cor = coll.current.corridors as Cesium.PolylineCollection
    if (!cor) return
    cor.removeAll()
    if (!p.layers.corridors) return
    for (const c of p.corridors) cor.add({
      positions: Cesium.Cartesian3.fromDegreesArray(c.path.flat()), width: 5,
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
        t.add({ positions: Cesium.Cartesian3.fromDegreesArrayHeights(path.flatMap((q) => [q[0], q[1], 300 + q[2] * 40])), width: 4,
          material: Cesium.Material.fromType('PolylineGlow', { color: col(color, 0.55), glowPower: 0.12 }) })
      }
    }
    add(p.trajectories, '#ffb35c'); add(p.plume, '#f1e6c8')
    for (const c of p.clusters) cl.add({
      position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 80), image: ringIcon(Math.round(c.share * 100), '#ffb35c'),
      width: 26 + c.share * 30, height: 26 + c.share * 30, disableDepthTestDistance: Number.POSITIVE_INFINITY,
      id: { kind: 'fire', label: `${c.place.label}: ${c.fires} detections, ${Math.round(c.share * 100)}% of incoming fire smoke, ~${c.transport_h} h transport` } as Tag,
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

  // ---------------------------------------------------------------- camera
  useEffect(() => {
    const v = viewer.current, f = p.flyTo
    if (!v || !f) return
    idle.current = false
    v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(f.lon, f.lat, 0), 1), {
      offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(f.heading ?? 0), Cesium.Math.toRadians(f.pitch ?? -50), f.range),
      duration: f.duration ?? 2.4,
    })
  }, [p.flyTo])

  useEffect(() => { sampler.current = makeSampler(p.wind); particles.current = [] }, [p.wind])

  // ---------------------------------------------------------------- overlay renderer
  function drawOverlay() {
    const v = viewer.current, cv = overlay.current
    if (!v || !cv) return
    const w = v.canvas.clientWidth, h = v.canvas.clientHeight
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
    const g = cv.getContext('2d')!
    const S = P.current, cam = v.camera
    const hgt = cam.positionCartographic.height
    const camPos = cam.positionWC
    const scratch = new Cesium.Cartesian3(), toCam = new Cesium.Cartesian3()
    const proj = (lon: number, lat: number, alt = 0) => {
      const c = Cesium.Cartesian3.fromDegrees(lon, lat, alt, undefined, scratch)
      // horizon test: visible when the camera is on the outward side of the point
      if (Cesium.Cartesian3.dot(c, Cesium.Cartesian3.subtract(camPos, c, toCam)) < 0) return null
      return Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, c)
    }
    const t = performance.now()
    // fade previous frame for trails
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = 'rgba(0,0,0,0.86)'; g.fillRect(0, 0, w, h)
    g.globalCompositeOperation = 'source-over'

    // wind particles (hidden at street level, where they'd be meaningless)
    const smp = sampler.current
    if (S.layers.wind && smp && hgt > 4e4) {
      const rect = cam.computeViewRectangle()
      const W = rect ? Cesium.Math.toDegrees(rect.west) : -180, E = rect ? Cesium.Math.toDegrees(rect.east) : 180
      const So = rect ? Math.max(-75, Cesium.Math.toDegrees(rect.south)) : -75, N = rect ? Math.min(75, Cesium.Math.toDegrees(rect.north)) : 75
      const span = E >= W ? E - W : E + 360 - W
      const spawn = (): Particle => { const x = W + Math.random() * span, y = So + Math.random() * (N - So); return { x: x > 180 ? x - 360 : x, y, age: 0, life: 50 + Math.random() * 90, trail: [] } }
      const n = hgt > 6e6 ? 2600 : 1600
      while (particles.current.length < n) particles.current.push({ ...spawn(), age: Math.random() * 60 })
      particles.current.length = n
      const k = 0.0016 * Math.min(1.6, Math.max(0.04, hgt / 6e6))
      g.lineWidth = 1.2; g.strokeStyle = 'rgba(140,232,255,0.55)'
      g.beginPath()
      for (let i = 0; i < particles.current.length; i++) {
        const q = particles.current[i]
        const [u, vv] = smp(q.y, q.x)
        q.x += (u * k) / Math.max(0.2, Math.cos((q.y * Math.PI) / 180)); q.y += vv * k; q.age++
        if (q.x > 180) q.x -= 360; if (q.x < -180) q.x += 360
        if (q.age > q.life || q.y > 78 || q.y < -78) { particles.current[i] = spawn(); continue }
        const a = proj(q.x, q.y), prev = q.trail[q.trail.length - 1]
        if (a && prev) { g.moveTo(prev[0], prev[1]); g.lineTo(a.x, a.y) }
        q.trail = a ? [[a.x, a.y]] : []
      }
      g.stroke()
    }

    // clear a crisp layer for rings/comets on top of the faded trail layer
    // spike rings
    if (S.layers.cities) {
      for (const c of S.cities) {
        if (!c.spike) continue
        const a = proj(c.lon, c.lat); if (!a) continue
        const ph = ((t / 1400) + c.lat) % 1
        g.beginPath(); g.arc(a.x, a.y, 8 + ph * 26, 0, Math.PI * 2)
        g.strokeStyle = `rgba(240,138,36,${0.8 * (1 - ph)})`; g.lineWidth = 1.6; g.stroke()
      }
    }
    // animated comets along trajectories / plume (flow toward the receptor)
    const comet = (paths: [number, number, number][][] | null, rgb: string, dirToEnd: boolean) => {
      for (const path of paths ?? []) {
        if (path.length < 4) continue
        const L = path.length, ph = (t / 2600) % 1
        const head = Math.floor((dirToEnd ? ph : 1 - ph) * (L - 1))
        for (let s = 0; s < 10; s++) {
          const idx = dirToEnd ? head - s : head + s
          if (idx < 0 || idx >= L) break
          const q = path[idx], a = proj(q[0], q[1], 300 + q[2] * 40); if (!a) continue
          g.beginPath(); g.arc(a.x, a.y, 3.2 - s * 0.25, 0, Math.PI * 2); g.fillStyle = `rgba(${rgb},${0.95 - s * 0.09})`; g.fill()
        }
      }
    }
    comet(S.trajectories, '255,179,92', false)
    comet(S.plume, '241,230,200', true)
    // federated packets
    if (S.network) {
      const ph = (t / 1800) % 1
      for (const n of S.network) {
        const a = proj(n.lon + (HUB.lon - n.lon) * ph, n.lat + (HUB.lat - n.lat) * ph,
          Math.sin(Math.PI * ph) * 3.5e5 * Math.min(1, Math.hypot(HUB.lon - n.lon, HUB.lat - n.lat) / 20))
        if (a) { g.beginPath(); g.arc(a.x, a.y, 3, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill() }
      }
    }
    // pick marker
    if (S.pick) {
      const a = proj(S.pick.lon, S.pick.lat)
      if (a) {
        const ph = (t / 1200) % 1
        g.beginPath(); g.arc(a.x, a.y, 6, 0, Math.PI * 2); g.fillStyle = '#f1e6c8'; g.fill()
        g.beginPath(); g.arc(a.x, a.y, 8 + ph * 20, 0, Math.PI * 2); g.strokeStyle = `rgba(241,230,200,${1 - ph})`; g.lineWidth = 2; g.stroke()
      }
    }
  }

  return (
    <div className="globe-wrap">
      <div ref={el} className="globe-canvas" />
      <canvas ref={overlay} className="globe-overlay" />
      <div ref={credits} className="globe-credits" />
      {tip && <div className="globe-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.text}</div>}
    </div>
  )
}
