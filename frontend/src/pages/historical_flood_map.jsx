import { useEffect, useRef, useState } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

import DashboardLayout from "../components/pagecomponents/historicalMap/DashboardLayout"
const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim()
const MAPBOX_STYLE = "mapbox://styles/mapbox/streets-v12"

mapboxgl.accessToken = MAPBOX_TOKEN
if (typeof mapboxgl.setTelemetryEnabled === "function") {
  mapboxgl.setTelemetryEnabled(false)
}

function SingaporeHistoricalFloodMap({ resizeSignal, onAreaClick }) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (mapRef.current) return
    if (!mapboxgl.supported()) {
      setError("webgl is not supported in this browser/device.")
      return
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAPBOX_STYLE,
      center: [103.8198, 1.3521],
      zoom: 11,
      attributionControl: true,
    })

    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }))

    map.on("load", async () => {
      try {
        const planningRes = await fetch("/map/planning_area.geojson")
        if (!planningRes.ok) throw new Error(`failed to fetch planning_area.geojson (status ${planningRes.status})`)
        const planningData = await planningRes.json()

        map.addSource("planning-area", { type: "geojson", data: planningData })
        map.addLayer({
          id: "planning-area-fill",
          type: "fill",
          source: "planning-area",
          paint: { "fill-color": "#1d4ed8", "fill-opacity": 0.2 },
        })
        map.addLayer({
          id: "planning-area-outline",
          type: "line",
          source: "planning-area",
          paint: { "line-color": "#1d4ed8", "line-width": 1.5 },
        })

        map.on("click", "planning-area-fill", (e) => {
          const feature = e.features?.[0]
          if (!feature) return
          onAreaClick?.(feature.properties || {})
        })

        map.on("mouseenter", "planning-area-fill", () => (map.getCanvas().style.cursor = "pointer"))
        map.on("mouseleave", "planning-area-fill", () => (map.getCanvas().style.cursor = ""))
      } catch (err) {
        console.error(err)
        setError("unable to load planning_area.geojson. ensure the file is in /public/map/.")
      }
    })

    map.on("error", (evt) => {
      console.error("mapbox gl error:", evt?.error)
      setError("map failed to load. check your token or network.")
    })

    return () => {
      map.remove()
    }
  }, [onAreaClick])

  useEffect(() => {
    if (mapRef.current) mapRef.current.resize()
  }, [resizeSignal])

  return (
    <div className="map-shell">
      <div ref={mapContainerRef} className="map-absolute" />
      {error && (
        <div className="map-error">
          <div className="map-error-box">
            <div className="map-error-title">map unavailable</div>
            <div>{error}</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function HistoricalMapPage() {
  return <DashboardLayout mapcomponent={SingaporeHistoricalFloodMap} />
}
