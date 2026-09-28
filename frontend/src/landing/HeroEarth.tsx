import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { api } from '../lib/api'

/* The hero's real Earth: Esri satellite imagery, real sunlight, and today's
   NASA heat detections as faint embers — slowly turning, not interactive. */
export default function HeroEarth({ onReady }: { onReady?: () => void }) {
  const el = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!el.current) return
    const v = new Cesium.Viewer(el.current, {
      baseLayer: false, animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      creditContainer: document.createElement('div'), msaaSamples: 4, requestRenderMode: false,
    })
    v.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maximumLevel: 8,
      credit: 'Imagery © Esri, Maxar, Earthstar Geographics' }))
    const sc = v.scene
    sc.backgroundColor = Cesium.Color.TRANSPARENT
    sc.globe.enableLighting = true
    sc.globe.dynamicAtmosphereLighting = true
    sc.globe.showGroundAtmosphere = true
    if (sc.skyBox) sc.skyBox.show = false
    if (sc.sun) sc.sun.show = false
    if (sc.moon) sc.moon.show = false
    sc.screenSpaceCameraController.enableInputs = false
    v.clock.currentTime = Cesium.JulianDate.now()
    v.clock.shouldAnimate = true
    v.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(72, 16, 13_500_000) })
    v.clock.onTick.addEventListener(() => v.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.00055))
    const embers = sc.primitives.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection
    api.fires().then((f) => {
      for (const [lat, lon, n] of f.bins ?? []) {
        embers.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 2000), pixelSize: 1.5 + Math.min(4, Math.sqrt(n) * 0.45),
          color: Cesium.Color.fromCssColorString('#ffb35c').withAlpha(0.8) })
      }
    }).catch(() => {})
    let frames = 0
    const onRender = () => { if (++frames === 20) { setShown(true); onReady?.() } }
    sc.postRender.addEventListener(onRender)
    return () => { v.destroy() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={el} className={`hero-earth ${shown ? 'on' : ''}`} aria-hidden />
}
