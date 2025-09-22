import { useEffect, useMemo, useRef, useState } from "react"
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
const SUBZONE_SOURCE_ID = "subzone-area"
const SUBZONE_FILL_LAYER_ID = "subzone-fill"
const SUBZONE_OUTLINE_LAYER_ID = "subzone-outline"
const SUBZONE_HIGHLIGHT_LAYER_ID = "subzone-highlight"
const EMPTY_HIGHLIGHT_FILTER = ["==", ["get", "SZ_ID"], ""]

mapboxgl.accessToken = MAPBOX_TOKEN
if (typeof mapboxgl.setTelemetryEnabled === "function") {
  mapboxgl.setTelemetryEnabled(false)
}

const normalizeFilters = (filters) => ({
  planningArea: (filters?.planningArea ?? "all") || "all",
  searchTerm: (filters?.searchTerm ?? "").toString().trim(),
})

const buildSubzoneFilter = (filters) => {
  const expression = ["all"]
  if (filters.planningArea && filters.planningArea !== "all") {
    expression.push(["==", ["get", "PLN_AREA_N"], filters.planningArea])
  }
  if (filters.searchTerm && filters.searchTerm.length >= 2) {
    expression.push([
      "!=",
      [
        "index-of",
        filters.searchTerm.toLowerCase(),
        ["downcase", ["coalesce", ["get", "SUBZONE_N"], ""]],
      ],
      -1,
    ])
  }
  return expression
}

const featureMatchesFilter = (properties, filters) => {
  if (!properties) return false
  if (filters.planningArea && filters.planningArea !== "all" && properties.PLN_AREA_N !== filters.planningArea) {
    return false
  }
  if (filters.searchTerm && filters.searchTerm.length >= 2) {
    const name = String(properties.SUBZONE_N ?? "").toLowerCase()
    if (!name.includes(filters.searchTerm.toLowerCase())) return false
  }
  return true
}

const extractPlanningAreas = (geojson) => {
  if (!geojson?.features) return []
  const unique = new Set()
  for (const feature of geojson.features) {
    const name = feature?.properties?.PLN_AREA_N
    if (typeof name === "string" && name.trim().length > 0) {
      unique.add(name.trim())
    }
  }
  return [...unique]
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

function SingaporeHistoricalFloodMap({
  resizeSignal,
  filters,
  selectedFeature,
  onFeatureSelect,
  onPlanningAreasLoaded,
}) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const hasLoadedRef = useRef(false)
  const [error, setError] = useState(null)

  const normalizedFilters = useMemo(() => normalizeFilters(filters), [filters])

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
        const [planningRes, subzoneRes] = await Promise.all([
          fetch("/map/planning_area.geojson"),
          fetch("/map/subzone_area.geojson"),
        ])

        if (!planningRes.ok) {
          throw new Error(`Failed to fetch planning_area.geojson (status ${planningRes.status})`)
        }

        if (!subzoneRes.ok) {
          throw new Error(`Failed to fetch subzone_area.geojson (status ${subzoneRes.status})`)
        }

        const [planningData, subzoneData] = await Promise.all([planningRes.json(), subzoneRes.json()])

        map.addSource(PLANNING_SOURCE_ID, { type: "geojson", data: planningData })
        map.addSource(SUBZONE_SOURCE_ID, { type: "geojson", data: subzoneData })

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
          id: SUBZONE_FILL_LAYER_ID,
          type: "fill",
          source: SUBZONE_SOURCE_ID,
          paint: {
            "fill-color": "#1d4ed8",
            "fill-opacity": 0.25,
          },
        })

        map.addLayer({
          id: SUBZONE_OUTLINE_LAYER_ID,
          type: "line",
          source: SUBZONE_SOURCE_ID,
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
          paint: {
            "line-color": "#fbbf24",
            "line-width": 3,
            "line-opacity": 0.9,
          },
          filter: EMPTY_HIGHLIGHT_FILTER,
        })

        const planningAreas = extractPlanningAreas(subzoneData)
        if (planningAreas.length) {
          onPlanningAreasLoaded?.(planningAreas)
        }

        const filterExpression = buildSubzoneFilter(normalizedFilters)
        map.setFilter(SUBZONE_FILL_LAYER_ID, filterExpression)
        map.setFilter(SUBZONE_OUTLINE_LAYER_ID, filterExpression)

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

          onFeatureSelect?.(payload)
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
  }, [normalizedFilters, onFeatureSelect, onPlanningAreasLoaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.resize()
  }, [resizeSignal])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasLoadedRef.current) return
    if (!map.getLayer(SUBZONE_FILL_LAYER_ID)) return

    const filterExpression = buildSubzoneFilter(normalizedFilters)
    map.setFilter(SUBZONE_FILL_LAYER_ID, filterExpression)
    map.setFilter(SUBZONE_OUTLINE_LAYER_ID, filterExpression)

    if (selectedFeature?.properties && !featureMatchesFilter(selectedFeature.properties, normalizedFilters)) {
      onFeatureSelect?.(null)
    }
  }, [normalizedFilters, onFeatureSelect, selectedFeature])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasLoadedRef.current) return
    if (!map.getLayer(SUBZONE_HIGHLIGHT_LAYER_ID)) return

    if (!selectedFeature?.properties) {
      map.setFilter(SUBZONE_HIGHLIGHT_LAYER_ID, EMPTY_HIGHLIGHT_FILTER)
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }
      return
    }

    const highlightId = selectedFeature.id ?? selectedFeature.properties.SZ_ID ?? null
    if (highlightId) {
      map.setFilter(SUBZONE_HIGHLIGHT_LAYER_ID, ["==", ["get", "SZ_ID"], highlightId])
    }

    const coords = Array.isArray(selectedFeature.lngLat) ? selectedFeature.lngLat : null
    if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
      if (!popupRef.current) {
        popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnMove: true, offset: 16 })
      }
      popupRef.current
        .setLngLat(coords)
        .setHTML(buildPopupMarkup(selectedFeature.properties))
        .addTo(map)
    }
  }, [selectedFeature])

  return (
    <div className="relative h-full min-h-[24rem] w-full">
      <div ref={mapContainerRef} className="absolute inset-0" />
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
