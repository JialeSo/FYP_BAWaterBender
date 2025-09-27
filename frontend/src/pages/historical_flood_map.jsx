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

// amenities (csv backed)
const AMENITY_SOURCE_ID = "amenities"
const AMENITY_LAYER_ID = "amenities-layer"

// hover outlines
const PA_HOVER_OUTLINE_ID = "planning-area-hover-outline"
const PA_HOVER_OUTLINE_INNER_ID = "planning-area-hover-outline-inner"
const SZ_HOVER_OUTLINE_ID = "subzone-hover-outline"

const EMPTY_PLANNING_FILTER = ["==", ["get", "PLN_AREA_N"], "__none__"]
const EMPTY_PA_FILTER = ["==", ["get", "PA_ID"], "__none__"]
const EMPTY_SUBZONE_HIGHLIGHT = ["==", ["get", "SZ_ID"], "__none__"]

const PLANNING_COLORS = ["#e0f2fe", "#bae6fd", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8"]
const SUBZONE_COLORS = ["#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626"]
const DEFAULT_PLANNING_COLOR = "#e2e8f0"
const DEFAULT_SUBZONE_COLOR = "rgba(37, 99, 235, 0.18)"
const DEFAULT_ROAD_WIDTH = 1.2
const HOVER_FILL_COLOR = "#fef08a"

// NEW palette: color by amenity_category (fallback to amenity_type)
const AMENITY_COLOR_EXPRESSION = [
  "match",
  ["coalesce", ["get", "amenity_category"], ["get", "amenity_type"]],
  "transport_services", "#7c3aed",   // purple
  "education", "#10b981",            // emerald
  "healthcare", "#ef4444",           // red
  "recreation", "#06b6d4",           // cyan
  "government", "#f59e0b",           // amber
  "commercial", "#8b5cf6",           // violet
  "community", "#22c55e",            // green
  "infrastructure", "#0ea5e9",       // sky
  // type-specific fallbacks if category missing:
  "bus_depots", "#fb923c",           // orange
  "mrt_stations", "#6366f1",         // indigo
  "schools", "#34d399",              // mint
  "hospitals", "#f87171",            // salmon
  /* default */ "#a3a3a3"            // neutral
]

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

const buildHoverMarkupPlanning = (props) => {
  const area = escapeHtml(props?.PLN_AREA_N ?? "unknown planning area")
  const paId = escapeHtml(String(props?.PA_ID ?? "-"))
  return `
    <div class="text-xs leading-5">
      <div class="font-semibold text-white">${area}</div>
      <div class="text-slate-300">pa_id: ${paId}</div>
    </div>
  `
}

const buildHoverMarkupSubzone = (props) => {
  const sub = escapeHtml(props?.SUBZONE_N ?? "unknown subzone")
  const area = escapeHtml(props?.PLN_AREA_N ?? "-")
  const code = escapeHtml(props?.SZ_ID ?? "-")
  return `
    <div class="text-xs leading-5">
      <div class="font-semibold text-white">${sub}</div>
      <div class="text-slate-300">planning area: ${area}</div>
      <div class="text-slate-300">sz_id: ${code}</div>
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
    for (const entry of coords) collect(entry)
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

const buildChoroplethExpression = (field, countMap, maxCount, palette, fallbackColor) => {
  const entries = Object.entries(countMap || {})
  if (!entries.length || !maxCount) return fallbackColor
  const safeMax = maxCount || 1
  const expression = Array.isArray(field) ? ["match", field] : ["match", ["get", field]]
  entries.forEach(([label, value]) => {
    const ratio = Math.max(0, Math.min(1, value / safeMax))
    const index = Math.min(palette.length - 1, Math.floor(ratio * (palette.length - 1)))
    expression.push(label, palette[index])
  })
  expression.push(fallbackColor)
  return expression
}

const buildLineWidthExpression = (field, countMap, maxCount, minWidth = 1.2, maxWidth = 6, fallback = DEFAULT_ROAD_WIDTH) => {
  const entries = Object.entries(countMap || {})
  if (!entries.length || !maxCount) return fallback
  const safeMax = maxCount || 1
  const expression = Array.isArray(field) ? ["match", field] : ["match", ["get", field]]
  entries.forEach(([label, value]) => {
    const ratio = Math.max(0, Math.min(1, value / safeMax))
    const width = minWidth + ratio * (maxWidth - minWidth)
    expression.push(label, Number.isFinite(width) ? width : minWidth)
  })
  expression.push(fallback)
  return expression
}

/* robust csv parser (handles quotes, commas, escaped quotes) -> array of objects */
function parseCsv(text) {
  const rows = []
  let field = ""
  let row = []
  let inQuotes = false

  const pushField = () => { row.push(field); field = "" }
  const pushRow = () => { if (row.length && !(row.length === 1 && row[0].trim() === "")) rows.push(row); row = [] }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === "\"") {
        const peek = text[i + 1]
        if (peek === "\"") { field += "\""; i += 1 } else { inQuotes = false }
      } else { field += ch }
      continue
    }
    if (ch === "\"") inQuotes = true
    else if (ch === ",") pushField()
    else if (ch === "\r") {}
    else if (ch === "\n") { pushField(); pushRow() }
    else field += ch
  }
  if (field.length > 0) { pushField(); pushRow() }

  if (rows.length === 0) return []
  const headers = rows[0].map(h => h.trim())
  const out = []
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i]; if (!r || r.length === 0) continue
    const obj = {}
    for (let j = 0; j < headers.length; j += 1) obj[headers[j]] = r[j] ?? ""
    out.push(obj)
  }
  return out
}

/* convert amenities csv rows → geojson features using lon/lat columns */
function amenitiesCsvToGeoJSON(rows) {
  const features = []
  for (const r of rows) {
    const lon = Number(r.lon ?? r.LON ?? r.longitude ?? r.LONGITUDE)
    const lat = Number(r.lat ?? r.LAT ?? r.latitude ?? r.LATITUDE)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const properties = { ...r }
    ;["amenity_priority", "amenity_weight", "importance_score", "flood_count"].forEach((k) => {
      if (properties[k] != null && properties[k] !== "") {
        const num = Number(properties[k])
        if (Number.isFinite(num)) properties[k] = num
      }
    })
    // normalize commonly used string fields
    if (properties.amenity_category) properties.amenity_category = String(properties.amenity_category).trim()
    if (properties.amenity_type) properties.amenity_type = String(properties.amenity_type).trim()
    if (properties.planning_area) properties.planning_area = String(properties.planning_area).trim()
    if (properties.subzone) properties.subzone = String(properties.subzone).trim()

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties,
    })
  }
  return { type: "FeatureCollection", features }
}

function SingaporeHistoricalFloodMap({
  resizeSignal,
  selectedPlanningAreas = [],
  selectedSubzone,
  floodStats = {},
  onPlanningAreaToggle,
  onPlanningAreasLoaded,
  onSubzoneSelect,
}) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null) // click popup (existing)
  const hoverPopupRef = useRef(null) // hover popup
  const hasLoadedRef = useRef(false)
  const planningAreaFeatureRef = useRef({})
  const planningAreaIdRef = useRef({})
  const hoveredPlanningIdRef = useRef(null)
  const hoveredSubzoneIdRef = useRef(null)
  const [error, setError] = useState(null)

  const {
    planningCountMap = {},
    subzoneCountMap = {},              // expected: keyed by subzone name
    roadCountMap = {},
    overallPlanningCountMap = {},
    maxPlanningCount = 0,
    maxSubzoneCount = 0,
    maxRoadCount = 0,
    overallMaxPlanningCount = 0,
    amenityFloodCountMap = {},        // OPTIONAL: { amenity_id -> floodCount }
  } = floodStats ?? {}

  // helper to show a popup
  const showHoverPopup = (map, lngLat, html) => {
    if (!hoverPopupRef.current) {
      hoverPopupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        closeOnMove: false,
        offset: [0, -12],
        className: "map-hover-popup",
      })
    }
    hoverPopupRef.current.setLngLat(lngLat).setHTML(html).addTo(map)
  }

  // amenity hover builder that **includes flood count**
  const buildAmenityHoverHtml = (props) => {
    const name = escapeHtml(props?.amenity_name ?? "Unknown amenity")
    const category = escapeHtml(props?.amenity_category ?? (props?.amenity_type ?? "-"))
    const type = escapeHtml(props?.amenity_type ?? "-")
    const pa = escapeHtml(props?.planning_area ?? "-")
    const sub = escapeHtml(props?.subzone ?? "-")

    // flood count priority: CSV column -> amenityFloodCountMap by id -> subzone aggregate -> "-"
    let floodCount = "-"
    if (props?.flood_count != null && props.flood_count !== "") {
      const n = Number(props.flood_count)
      if (Number.isFinite(n)) floodCount = String(n)
    } else if (props?.amenity_id && amenityFloodCountMap && amenityFloodCountMap[props.amenity_id] != null) {
      floodCount = String(amenityFloodCountMap[props.amenity_id])
    } else if (sub && subzoneCountMap && subzoneCountMap[sub] != null) {
      floodCount = String(subzoneCountMap[sub])
    }

    return `
      <div class="text-xs leading-5">
        <div class="font-semibold text-white">${name}</div>
        <div class="text-slate-300">category: ${category} <span class="text-slate-500">(type: ${type})</span></div>
        <div class="text-slate-300">flood count: <span class="font-semibold text-white">${floodCount}</span></div>
        <div class="text-slate-300">planning area: ${pa}</div>
        <div class="text-slate-300">subzone: ${sub}</div>
      </div>
    `
  }

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

    const handleBackgroundClick = (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: [PLANNING_FILL_LAYER_ID, SUBZONE_FILL_LAYER_ID],
      })
      if (!features.length) onPlanningAreaToggle?.(null)
    }

    const handleLoad = async () => {
      try {
        const [planningRes, subzoneRes, roadRes, amenityCsvRes] = await Promise.all([
          fetch("/map/planning_area.geojson"),
          fetch("/map/subzone_area.geojson"),
          fetch("/map/road_network.geojson"),
          fetch("/map/amenities_3layers.csv"),
        ])

        if (!planningRes.ok) throw new Error(`Failed to fetch planning_area.geojson (status ${planningRes.status})`)
        if (!subzoneRes.ok) throw new Error(`Failed to fetch subzone_area.geojson (status ${subzoneRes.status})`)
        if (!roadRes.ok) throw new Error(`Failed to fetch road_network.geojson (status ${roadRes.status})`)
        if (!amenityCsvRes.ok) throw new Error(`Failed to fetch amenities_3layers.csv (status ${amenityCsvRes.status})`)

        const [planningData, subzoneData, roadData, amenityCsvText] = await Promise.all([
          planningRes.json(),
          subzoneRes.json(),
          roadRes.json(),
          amenityCsvRes.text(),
        ])

        // CSV -> rows -> GeoJSON
        const amenityRows = parseCsv(amenityCsvText)
        const amenityData = amenitiesCsvToGeoJSON(amenityRows)

        // collect planning areas for external ui
        const planningAreas = []
        const featureMap = {}
        const idMap = {}
        for (const feature of planningData.features ?? []) {
          const name = feature?.properties?.PLN_AREA_N?.trim()
          if (!name) continue
          planningAreas.push(name)
          featureMap[name] = feature
          const paId = feature?.properties?.PA_ID
          if (paId) idMap[name] = String(paId)
        }
        planningAreaFeatureRef.current = featureMap
        planningAreaIdRef.current = idMap
        if (planningAreas.length) onPlanningAreasLoaded?.(planningAreas)

        // sources
        map.addSource(PLANNING_SOURCE_ID, { type: "geojson", data: planningData, generateId: true })
        map.addSource(SUBZONE_SOURCE_ID, { type: "geojson", data: subzoneData, generateId: true })
        map.addSource(ROAD_SOURCE_ID, { type: "geojson", data: roadData })
        map.addSource(AMENITY_SOURCE_ID, { type: "geojson", data: amenityData, generateId: true })

        // base layers
        map.addLayer({
          id: PLANNING_FILL_LAYER_ID,
          type: "fill",
          source: PLANNING_SOURCE_ID,
          paint: { "fill-color": DEFAULT_PLANNING_COLOR, "fill-opacity": 0.75 },
        })
        map.addLayer({
          id: PLANNING_OUTLINE_LAYER_ID,
          type: "line",
          source: PLANNING_SOURCE_ID,
          paint: { "line-color": "#1d4ed8", "line-width": 1.25, "line-opacity": 0.4 },
        })
        map.addLayer({
          id: PLANNING_HIGHLIGHT_LAYER_ID,
          type: "line",
          source: PLANNING_SOURCE_ID,
          paint: { "line-color": "#f97316", "line-width": 3, "line-opacity": 0.9 },
          filter: EMPTY_PLANNING_FILTER,
        })
        map.addLayer({
          id: SUBZONE_FILL_LAYER_ID,
          type: "fill",
          source: SUBZONE_SOURCE_ID,
          layout: { visibility: "none" },
          paint: { "fill-color": DEFAULT_SUBZONE_COLOR, "fill-opacity": 0.55 },
        })
        map.addLayer({
          id: SUBZONE_OUTLINE_LAYER_ID,
          type: "line",
          source: SUBZONE_SOURCE_ID,
          layout: { visibility: "none" },
          paint: { "line-color": "#1d4ed8", "line-width": 0.8, "line-opacity": 0.7 },
        })
        map.addLayer({
          id: SUBZONE_HIGHLIGHT_LAYER_ID,
          type: "line",
          source: SUBZONE_SOURCE_ID,
          layout: { visibility: "none" },
          paint: { "line-color": "#fbbf24", "line-width": 3, "line-opacity": 0.9 },
          filter: EMPTY_SUBZONE_HIGHLIGHT,
        })
        map.addLayer({
          id: ROAD_LAYER_ID,
          type: "line",
          source: ROAD_SOURCE_ID,
          layout: { visibility: "none" },
          paint: { "line-color": "#f97316", "line-width": DEFAULT_ROAD_WIDTH, "line-opacity": 0.85 },
          filter: EMPTY_PA_FILTER,
        })

        // amenities: hidden by default; filtered/toggled with planning selection
        map.addLayer({
          id: AMENITY_LAYER_ID,
          type: "circle",
          source: AMENITY_SOURCE_ID,
          layout: { visibility: "none" },
          paint: {
            "circle-color": AMENITY_COLOR_EXPRESSION,
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8, 3.5,
              12, 6,
              16, 9
            ],
            "circle-opacity": 0.95,
            "circle-stroke-width": 1.2,
            "circle-stroke-color": "#0b1220" // dark halo to read on any basemap
          },
        })

        // hover outlines
        map.addLayer({
          id: PA_HOVER_OUTLINE_ID,
          type: "line",
          source: PLANNING_SOURCE_ID,
          paint: {
            "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ffffff", "rgba(0,0,0,0)"],
            "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 5, 0],
            "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
          },
        })
        map.addLayer({
          id: PA_HOVER_OUTLINE_INNER_ID,
          type: "line",
          source: PLANNING_SOURCE_ID,
          paint: {
            "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#60a5fa", "rgba(0,0,0,0)"],
            "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 0],
            "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
          },
        })
        map.addLayer({
          id: SZ_HOVER_OUTLINE_ID,
          type: "line",
          source: SUBZONE_SOURCE_ID,
          layout: { visibility: "none" },
          paint: {
            "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ffffff", "rgba(0,0,0,0)"],
            "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 4, 0],
            "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
          },
        })

        // cursor affordances
        map.on("mouseenter", PLANNING_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"))
        map.on("mouseleave", PLANNING_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = ""))
        map.on("mouseenter", SUBZONE_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"))
        map.on("mouseleave", SUBZONE_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = ""))
        map.on("mouseenter", AMENITY_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"))
        map.on("mouseleave", AMENITY_LAYER_ID, () => (map.getCanvas().style.cursor = ""))

        // clicks
        map.on("click", PLANNING_FILL_LAYER_ID, (event) => {
          const feature = event.features?.[0]
          const name = feature?.properties?.PLN_AREA_N?.trim()
          if (!name) return
          const bounds = computeFeatureBounds(feature.geometry)
          if (bounds) map.fitBounds(bounds, { padding: 48, duration: 800, maxZoom: 13 })
          onPlanningAreaToggle?.(name)
        })
        map.on("click", SUBZONE_FILL_LAYER_ID, (event) => {
          const feature = event.features?.[0]
          if (!feature) return
          const payload = buildSelectionPayload(feature, event.lngLat)
          if (!payload) return
          map.flyTo({ center: event.lngLat, zoom: Math.max(map.getZoom(), 12), essential: true, speed: 0.9, curve: 1.2 })
          onSubzoneSelect?.(payload)
        })
        map.on("click", handleBackgroundClick)

        // hovers (planning/subzone)
        map.on("mousemove", PLANNING_FILL_LAYER_ID, (e) => {
          const f = e.features?.[0]; if (!f) return
          const id = f.id
          if (hoveredPlanningIdRef.current !== null && hoveredPlanningIdRef.current !== id) {
            map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false })
          }
          hoveredPlanningIdRef.current = id
          map.setFeatureState({ source: PLANNING_SOURCE_ID, id }, { hover: true })
          showHoverPopup(map, e.lngLat, buildHoverMarkupPlanning(f.properties))
        })
        map.on("mouseleave", PLANNING_FILL_LAYER_ID, () => {
          if (hoveredPlanningIdRef.current !== null) {
            map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false })
            hoveredPlanningIdRef.current = null
          }
          if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null }
        })
        map.on("mousemove", SUBZONE_FILL_LAYER_ID, (e) => {
          const f = e.features?.[0]; if (!f) return
          const id = f.id
          if (hoveredSubzoneIdRef.current !== null && hoveredSubzoneIdRef.current !== id) {
            map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false })
          }
          hoveredSubzoneIdRef.current = id
          map.setFeatureState({ source: SUBZONE_SOURCE_ID, id }, { hover: true })
          showHoverPopup(map, e.lngLat, buildHoverMarkupSubzone(f.properties))
        })
        map.on("mouseleave", SUBZONE_FILL_LAYER_ID, () => {
          if (hoveredSubzoneIdRef.current !== null) {
            map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false })
            hoveredSubzoneIdRef.current = null
          }
          if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null }
        })

        // amenity hover (includes category + flood count)
        map.on("mousemove", AMENITY_LAYER_ID, (e) => {
          const f = e.features?.[0]; if (!f) return
          showHoverPopup(map, e.lngLat, buildAmenityHoverHtml(f.properties))
        })
        map.on("mouseleave", AMENITY_LAYER_ID, () => {
          if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null }
        })

        hasLoadedRef.current = true
        setError(null)
      } catch (err) {
        console.error(err)
        setError("Unable to load map data. Ensure GeoJSON files and amenities_3layers.csv exist in /public/map/.")
      }
    }

    map.on("load", handleLoad)

    map.on("error", (evt) => {
      console.error("Mapbox GL error:", evt?.error)
      setError("The map failed to load. Check your token or network connection.")
    })

    return () => {
      map.off("load", handleLoad)
      map.off("click", handleBackgroundClick)
      try {
        if (hoveredPlanningIdRef.current !== null) {
          map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false })
        }
        if (hoveredSubzoneIdRef.current !== null) {
          map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false })
        }
      } catch {}
      if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null }
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
      hasLoadedRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, [onPlanningAreaToggle, onPlanningAreasLoaded, onSubzoneSelect])

  // external resize signal
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasLoadedRef.current) return
    map.resize()
    const frame = requestAnimationFrame(() => {
      map.resize()
      if (typeof map.triggerRepaint === "function") map.triggerRepaint()
    })
    return () => cancelAnimationFrame(frame)
  }, [resizeSignal])

  // respond to planning area selection (filters + camera + subzone/amenities visibility)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasLoadedRef.current) return
    if (!map.getLayer(SUBZONE_FILL_LAYER_ID) || !map.getLayer(ROAD_LAYER_ID) || !map.getLayer(PLANNING_HIGHLIGHT_LAYER_ID)) return

    const hasSelection = selectedPlanningAreas?.length > 0
    const subzoneFilter = buildMatchFilter("PLN_AREA_N", selectedPlanningAreas)
    map.setFilter(SUBZONE_FILL_LAYER_ID, subzoneFilter)
    map.setFilter(SUBZONE_OUTLINE_LAYER_ID, subzoneFilter)
    map.setFilter(PLANNING_HIGHLIGHT_LAYER_ID, hasSelection ? subzoneFilter : EMPTY_PLANNING_FILTER)

    const paIds = (selectedPlanningAreas || []).map((name) => planningAreaIdRef.current[name]).filter(Boolean)
    map.setFilter(ROAD_LAYER_ID, buildMatchFilter("PA_ID", paIds))

    const visibility = hasSelection ? "visible" : "none"
    map.setLayoutProperty(SUBZONE_FILL_LAYER_ID, "visibility", visibility)
    map.setLayoutProperty(SUBZONE_OUTLINE_LAYER_ID, "visibility", visibility)
    map.setLayoutProperty(SUBZONE_HIGHLIGHT_LAYER_ID, "visibility", visibility)
    map.setLayoutProperty(ROAD_LAYER_ID, "visibility", visibility)
    if (map.getLayer(SZ_HOVER_OUTLINE_ID)) map.setLayoutProperty(SZ_HOVER_OUTLINE_ID, "visibility", visibility)

    // amenities follow subzones: filter by planning_area, toggle visibility
    if (map.getLayer(AMENITY_LAYER_ID)) {
      const amenityFilter = hasSelection
        ? buildMatchFilter("planning_area", selectedPlanningAreas)
        : ["==", ["get", "planning_area"], "__none__"]
      map.setFilter(AMENITY_LAYER_ID, amenityFilter)
      map.setLayoutProperty(AMENITY_LAYER_ID, "visibility", visibility)
    }

    if (!hasSelection) {
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
      if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null }
      if (selectedSubzone) onSubzoneSelect?.(null)
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

  // respond to subzone selection (click highlight + click popup)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasLoadedRef.current) return
    if (!map.getLayer(SUBZONE_HIGHLIGHT_LAYER_ID)) return

    if (!selectedSubzone?.properties) {
      map.setFilter(SUBZONE_HIGHLIGHT_LAYER_ID, EMPTY_SUBZONE_HIGHLIGHT)
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
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

  // paints: choropleths + hover overrides + road widths
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasLoadedRef.current) return
    if (!map.getLayer(PLANNING_FILL_LAYER_ID)) return

    const hasSelection = selectedPlanningAreas.length > 0
    const planningExpression = buildChoroplethExpression(
      "PLN_AREA_N",
      hasSelection ? (floodStats.planningCountMap ?? {}) : (floodStats.overallPlanningCountMap ?? {}),
      hasSelection ? (floodStats.maxPlanningCount ?? 0) : (floodStats.overallMaxPlanningCount ?? 0),
      PLANNING_COLORS,
      DEFAULT_PLANNING_COLOR,
    )

    map.setPaintProperty(
      PLANNING_FILL_LAYER_ID,
      "fill-color",
      ["case", ["boolean", ["feature-state", "hover"], false], HOVER_FILL_COLOR, planningExpression],
    )
    map.setPaintProperty(
      PLANNING_FILL_LAYER_ID,
      "fill-opacity",
      ["case", ["boolean", ["feature-state", "hover"], false], 0.95, 0.75],
    )

    if (map.getLayer(SUBZONE_FILL_LAYER_ID)) {
      if (hasSelection) {
        const subzoneExpression = buildChoroplethExpression(
          "SUBZONE_N",
          floodStats.subzoneCountMap ?? {},
          floodStats.maxSubzoneCount ?? 0,
          SUBZONE_COLORS,
          DEFAULT_SUBZONE_COLOR,
        )
        map.setPaintProperty(
          SUBZONE_FILL_LAYER_ID,
          "fill-color",
          ["case", ["boolean", ["feature-state", "hover"], false], HOVER_FILL_COLOR, subzoneExpression],
        )
        map.setPaintProperty(
          SUBZONE_FILL_LAYER_ID,
          "fill-opacity",
          ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0.6],
        )
      } else {
        map.setPaintProperty(SUBZONE_FILL_LAYER_ID, "fill-color", DEFAULT_SUBZONE_COLOR)
        map.setPaintProperty(SUBZONE_FILL_LAYER_ID, "fill-opacity", 0.0)
      }
    }

    if (map.getLayer(ROAD_LAYER_ID)) {
      const roadWidthExpression = hasSelection
        ? buildLineWidthExpression(["coalesce", ["get", "RN_ID"], ["get", "RD_NAME"]],
            floodStats.roadCountMap ?? {}, floodStats.maxRoadCount ?? 0)
        : DEFAULT_ROAD_WIDTH
      map.setPaintProperty(ROAD_LAYER_ID, "line-width", roadWidthExpression)
    }
  }, [floodStats, selectedPlanningAreas])

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
