import { useEffect, useRef, useState } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

import DashboardLayout from "../components/pagecomponents/historicalMap/DashboardLayout"

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim()
const MAPBOX_STYLE = "mapbox://styles/mapbox/streets-v12"
const DEFAULT_CENTER = [103.8198, 1.3521]
const DEFAULT_ZOOM = 11

const PLANNING_SOURCE_ID = "planning-area"
const PLANNING_FILL_LAYER_ID = "planning-area-fill"
const PLANNING_OUTLINE_LAYER_ID = "planning-area-outline"
const PLANNING_HIGHLIGHT_LAYER_ID = "planning-area-highlight"
const SUBZONE_SOURCE_ID = "subzone-area"
const SUBZONE_FILL_LAYER_ID = "subzone-fill"
const SUBZONE_OUTLINE_LAYER_ID = "subzone-outline"
const SUBZONE_HIGHLIGHT_LAYER_ID = "subzone-highlight"
const ROAD_SOURCE_ID = "road-network"
const ROAD_LAYER_ID = "road-network-line"

const EMPTY_PLANNING_FILTER = ["==", ["get", "PLN_AREA_N"], "__none__"]
const EMPTY_PA_FILTER = ["==", ["get", "PA_ID"], "__none__"]
const EMPTY_SUBZONE_HIGHLIGHT = ["==", ["get", "SZ_ID"], "__none__"]

mapboxgl.accessToken = MAPBOX_TOKEN
if (typeof mapboxgl.setTelemetryEnabled === "function") {
  mapboxgl.setTelemetryEnabled(false)
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")

const buildPopupMarkup = (properties) => {
  const area = escapeHtml(properties?.PLN_AREA_N ?? "Unknown planning area")
  const subzone = escapeHtml(properties?.SUBZONE_N ?? "Unknown subzone")
  const code = escapeHtml(properties?.SZ_ID ?? "-")

  return `
    <div class="space-y-2">
      <div class="text-xs font-semibold uppercase tracking-wide text-slate-200">Subzone</div>
      <div class="text-base font-semibold text-white">${subzone}</div>
      <div class="text-xs text-slate-300">Planning area: ${area}</div>
      <div class="text-xs text-slate-300">SZ_ID: ${code}</div>
    </div>
  `
}

const buildSelectionPayload = (feature, lngLat) => {
  const properties = feature?.properties ? { ...feature.properties } : null
  if (!properties) return null
  return {
    properties,
    lngLat: [lngLat.lng, lngLat.lat],
    id: properties.SZ_ID ?? feature?.id ?? null,
  }
}

const buildMatchFilter = (field, values) => {
  if (!values?.length) {
    return ["==", ["get", field], "__none__"]
  }
  return ["match", ["get", field], values, true, false]
}

const computeFeatureBounds = (geometry) => {
  if (!geometry) return null
  const points = []
  const collect = (coords) => {
    if (!coords) return
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      points.push([coords[0], coords[1]])
      return
    }
    for (const entry of coords) {
      collect(entry)
    }
  }
  collect(geometry.coordinates)
  if (!points.length) return null
  let minLng = points[0][0]
  let maxLng = points[0][0]
  let minLat = points[0][1]
  let maxLat = points[0][1]
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ]
}

const mergeBounds = (base, next) => {
  if (!next) return base ?? null
  if (!base) {
    return [
      [next[0][0], next[0][1]],
      [next[1][0], next[1][1]],
    ]
  }
  const minLng = Math.min(base[0][0], next[0][0])
  const minLat = Math.min(base[0][1], next[0][1])
  const maxLng = Math.max(base[1][0], next[1][0])
  const maxLat = Math.max(base[1][1], next[1][1])
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ]
}

function SingaporeHistoricalFloodMap({
  resizeSignal,
  selectedPlanningAreas,
  selectedSubzone,
  onPlanningAreaToggle,
  onPlanningAreasLoaded,
  onSubzoneSelect,
}) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const hasLoadedRef = useRef(false)
  const planningAreaFeatureRef = useRef({})
  const planningAreaIdRef = useRef({})
  const [error, setError] = useState(null)

  useEffect(() => {
    if (mapRef.current) return
    if (!mapboxgl.supported()) {
      setError("WebGL is not supported in this browser or device.")
      return
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAPBOX_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: true,
    })

    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right")

    const handleLoad = async () => {
      try {
        const [planningRes, subzoneRes, roadRes] = await Promise.all([
          fetch("/map/planning_area.geojson"),
          fetch("/map/subzone_area.geojson"),
          fetch("/map/road_network.geojson"),
        ])

        if (!planningRes.ok) {
          throw new Error(`Failed to fetch planning_area.geojson (status ${planningRes.status})`)
        }
        if (!subzoneRes.ok) {
          throw new Error(`Failed to fetch subzone_area.geojson (status ${subzoneRes.status})`)
        }
        if (!roadRes.ok) {
          throw new Error(`Failed to fetch road_network.geojson (status ${roadRes.status})`)
        }

        const [planningData, subzoneData, roadData] = await Promise.all([planningRes.json(), subzoneRes.json(), roadRes.json()])

        const planningAreas = []
        const featureMap = {}
        const idMap = {}
        for (const feature of planningData.features ?? []) {
          const name = feature?.properties?.PLN_AREA_N?.trim()
          if (!name) continue
          planningAreas.push(name)
          featureMap[name] = feature
          const paId = feature?.properties?.PA_ID
          if (paId) {
            idMap[name] = String(paId)
          }
        }
        planningAreaFeatureRef.current = featureMap
        planningAreaIdRef.current = idMap
        if (planningAreas.length) {
          onPlanningAreasLoaded?.(planningAreas)
        }

        map.addSource(PLANNING_SOURCE_ID, { type: "geojson", data: planningData })
        map.addSource(SUBZONE_SOURCE_ID, { type: "geojson", data: subzoneData })
        map.addSource(ROAD_SOURCE_ID, { type: "geojson", data: roadData })

        map.addLayer({
          id: PLANNING_FILL_LAYER_ID,
          type: "fill",
          source: PLANNING_SOURCE_ID,
          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.08,
          },
        })

        map.addLayer({
          id: PLANNING_OUTLINE_LAYER_ID,
          type: "line",
          source: PLANNING_SOURCE_ID,
          paint: {
            "line-color": "#1d4ed8",
            "line-width": 1.25,
            "line-opacity": 0.4,
          },
        })

        map.addLayer({
          id: PLANNING_HIGHLIGHT_LAYER_ID,
          type: "line",
          source: PLANNING_SOURCE_ID,
          paint: {
            "line-color": "#f97316",
            "line-width": 3,
            "line-opacity": 0.9,
          },
          filter: EMPTY_PLANNING_FILTER,
        })

        map.addLayer({
          id: SUBZONE_FILL_LAYER_ID,
          type: "fill",
          source: SUBZONE_SOURCE_ID,
          layout: { visibility: "none" },
          paint: {
            "fill-color": "#1d4ed8",
            "fill-opacity": 0.25,
          },
        })

        map.addLayer({
          id: SUBZONE_OUTLINE_LAYER_ID,
          type: "line",
          source: SUBZONE_SOURCE_ID,
          layout: { visibility: "none" },
          paint: {
            "line-color": "#1d4ed8",
            "line-width": 0.8,
            "line-opacity": 0.7,
          },
        })

        map.addLayer({
          id: SUBZONE_HIGHLIGHT_LAYER_ID,
          type: "line",
          source: SUBZONE_SOURCE_ID,
          layout: { visibility: "none" },
          paint: {
            "line-color": "#fbbf24",
            "line-width": 3,
            "line-opacity": 0.9,
          },
          filter: EMPTY_SUBZONE_HIGHLIGHT,
        })

        map.addLayer({
          id: ROAD_LAYER_ID,
          type: "line",
          source: ROAD_SOURCE_ID,
          layout: { visibility: "none" },
          paint: {
            "line-color": "#f97316",
            "line-width": 1.8,
            "line-opacity": 0.85,
          },
          filter: EMPTY_PA_FILTER,
        })

        map.on("mouseenter", PLANNING_FILL_LAYER_ID, () => {
          map.getCanvas().style.cursor = "pointer"
        })

        map.on("mouseleave", PLANNING_FILL_LAYER_ID, () => {
          map.getCanvas().style.cursor = ""
        })

        map.on("click", PLANNING_FILL_LAYER_ID, (event) => {
          const feature = event.features?.[0]
          const name = feature?.properties?.PLN_AREA_N?.trim()
          if (!name) return
          const bounds = computeFeatureBounds(feature.geometry)
          if (bounds) {
            map.fitBounds(bounds, { padding: 48, duration: 800, maxZoom: 13 })
          }
          onPlanningAreaToggle?.(name)
        })

        map.on("mouseenter", SUBZONE_FILL_LAYER_ID, () => {
          map.getCanvas().style.cursor = "pointer"
        })

        map.on("mouseleave", SUBZONE_FILL_LAYER_ID, () => {
          map.getCanvas().style.cursor = ""
        })

        map.on("click", SUBZONE_FILL_LAYER_ID, (event) => {
          const feature = event.features?.[0]
          if (!feature) return
          const payload = buildSelectionPayload(feature, event.lngLat)
          if (!payload) return
          map.flyTo({
            center: event.lngLat,
            zoom: Math.max(map.getZoom(), 12),
            essential: true,
            speed: 0.9,
            curve: 1.2,
          })
          onSubzoneSelect?.(payload)
        })

        hasLoadedRef.current = true
        setError(null)
      } catch (err) {
        console.error(err)
        setError("Unable to load map data. Ensure the GeoJSON files exist in /public/map/.")
      }
    }

    map.on("load", handleLoad)

    map.on("error", (evt) => {
      console.error("Mapbox GL error:", evt?.error)
      setError("The map failed to load. Check your token or network connection.")
    })

    return () => {
      map.off("load", handleLoad)
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }
      hasLoadedRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, [onPlanningAreaToggle, onPlanningAreasLoaded, onSubzoneSelect])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.resize()
    const frame = requestAnimationFrame(() => {
      map.resize()
      if (typeof map.triggerRepaint === "function") {
        map.triggerRepaint()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [resizeSignal])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasLoadedRef.current) return
    if (!map.getLayer(SUBZONE_FILL_LAYER_ID) || !map.getLayer(ROAD_LAYER_ID) || !map.getLayer(PLANNING_HIGHLIGHT_LAYER_ID)) {
      return
    }

    const hasSelection = selectedPlanningAreas?.length > 0
    const subzoneFilter = buildMatchFilter("PLN_AREA_N", selectedPlanningAreas)
    map.setFilter(SUBZONE_FILL_LAYER_ID, subzoneFilter)
    map.setFilter(SUBZONE_OUTLINE_LAYER_ID, subzoneFilter)
    map.setFilter(PLANNING_HIGHLIGHT_LAYER_ID, hasSelection ? subzoneFilter : EMPTY_PLANNING_FILTER)

    const paIds = (selectedPlanningAreas || [])
      .map((name) => planningAreaIdRef.current[name])
      .filter(Boolean)
    map.setFilter(ROAD_LAYER_ID, buildMatchFilter("PA_ID", paIds))

    const visibility = hasSelection ? "visible" : "none"
    map.setLayoutProperty(SUBZONE_FILL_LAYER_ID, "visibility", visibility)
    map.setLayoutProperty(SUBZONE_OUTLINE_LAYER_ID, "visibility", visibility)
    map.setLayoutProperty(SUBZONE_HIGHLIGHT_LAYER_ID, "visibility", visibility)
    map.setLayoutProperty(ROAD_LAYER_ID, "visibility", visibility)

    if (!hasSelection) {
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }
      if (selectedSubzone) {
        onSubzoneSelect?.(null)
      }
      map.easeTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 800 })
      return
    }

    let combinedBounds = null
    for (const areaName of selectedPlanningAreas) {
      const feature = planningAreaFeatureRef.current[areaName]
      if (!feature) continue
      const bounds = computeFeatureBounds(feature.geometry)
      combinedBounds = mergeBounds(combinedBounds, bounds)
    }
    if (combinedBounds) {
      map.fitBounds(combinedBounds, { padding: 48, duration: 800, maxZoom: 13 })
    }
  }, [selectedPlanningAreas, selectedSubzone, onSubzoneSelect])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasLoadedRef.current) return
    if (!map.getLayer(SUBZONE_HIGHLIGHT_LAYER_ID)) return

    if (!selectedSubzone?.properties) {
      map.setFilter(SUBZONE_HIGHLIGHT_LAYER_ID, EMPTY_SUBZONE_HIGHLIGHT)
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }
      return
    }

    const subzoneId = selectedSubzone.id ?? selectedSubzone.properties.SZ_ID ?? null
    if (subzoneId) {
      map.setFilter(SUBZONE_HIGHLIGHT_LAYER_ID, ["==", ["get", "SZ_ID"], subzoneId])
    }

    const coords = Array.isArray(selectedSubzone.lngLat) ? selectedSubzone.lngLat : null
    if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
      if (!popupRef.current) {
        popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnMove: true, offset: 16 })
      }
      popupRef.current.setLngLat(coords).setHTML(buildPopupMarkup(selectedSubzone.properties)).addTo(map)
    }
  }, [selectedSubzone])

  return (
    <div className="relative h-full min-h-[24rem] w-full">
      <div ref={mapContainerRef} className="absolute inset-0 map-container" />
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900/70 p-6 text-white">
          <div className="w-full max-w-sm rounded-xl bg-slate-900/90 p-5 text-center shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">Map unavailable</p>
            <p className="mt-2 text-sm text-slate-100">{error}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function HistoricalMapPage() {
  return <DashboardLayout mapcomponent={SingaporeHistoricalFloodMap} />
}
