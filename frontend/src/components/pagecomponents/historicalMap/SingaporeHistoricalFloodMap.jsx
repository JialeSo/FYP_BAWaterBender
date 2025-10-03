// singaporehistoricalfloodmap.jsx
// notes:
// - keep your marker pngs at: /public/map/markers/<category_slug>.png (e.g. transport_services.png)
// - add /public/map/markers/default.png as a fallback (optional but recommended)

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import {
  buildMatchFilter,
  computeFeatureBounds,
  mergeBounds,
  buildChoroplethExpression,
  buildLineWidthExpression,
  aggregateAmenityStats,
} from "../../../utils/map/helpers";

import {
  parseCsv,
  amenitiesCsvToGeoJSON,
  floodsCsvToGeoJSON,
} from "../../../utils/map/parsers";

import {
  buildFloodHoverHtml,
  buildHoverMarkupPlanning,
  buildHoverMarkupSubzone,
  buildAmenityHoverHtml,
  buildHoverMarkupRoad,
} from "../../../utils/map/htmlBuilders";

// ===== mapbox base config =====
const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const MAPBOX_STYLE = "mapbox://styles/mapbox/streets-v12";
const DEFAULT_CENTER = [103.8198, 1.3521];
const DEFAULT_ZOOM = 11;

mapboxgl.accessToken = MAPBOX_TOKEN;
if (typeof mapboxgl.setTelemetryEnabled === "function") mapboxgl.setTelemetryEnabled(false);

// ===== ids =====
const PLANNING_SOURCE_ID = "planning-area";
const PLANNING_FILL_LAYER_ID = "planning-area-fill";
const PLANNING_OUTLINE_LAYER_ID = "planning-area-outline";
const PLANNING_HIGHLIGHT_LAYER_ID = "planning-area-highlight";
const SUBZONE_SOURCE_ID = "subzone-area";
const SUBZONE_FILL_LAYER_ID = "subzone-fill";
const SUBZONE_OUTLINE_LAYER_ID = "subzone-outline";
const SUBZONE_HIGHLIGHT_LAYER_ID = "subzone-highlight";
const ROAD_SOURCE_ID = "road-network";
const ROAD_LAYER_ID = "road-network-line";
const AMENITY_SOURCE_ID = "amenities";
const AMENITY_ICON_LAYER_ID = "amenities-icons";
const FLOOD_SOURCE_ID = "flood-events";
const FLOOD_LAYER_ID = "flood-events-layer";

// hover outlines
const PA_HOVER_OUTLINE_ID = "planning-area-hover-outline";
const PA_HOVER_OUTLINE_INNER_ID = "planning-area-hover-outline-inner";
const SZ_HOVER_OUTLINE_ID = "subzone-hover-outline";

// ===== filters / styling constants =====
const EMPTY_PLANNING_FILTER = ["==", ["get", "PLN_AREA_N"], "__none__"];
const EMPTY_PA_FILTER = ["==", ["get", "PA_ID"], "__none__"];
const EMPTY_SUBZONE_HIGHLIGHT = ["==", ["get", "SZ_ID"], "__none__"];

const PLANNING_COLORS = ["#e0f2fe", "#bae6fd", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8"];
const SUBZONE_COLORS = ["#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626"];
const DEFAULT_PLANNING_COLOR = "#e2e8f0";
const DEFAULT_SUBZONE_COLOR = "rgba(37, 99, 235, 0.18)";
const DEFAULT_ROAD_WIDTH = 1.2;
const HOVER_FILL_COLOR = "#fef08a";

// ===== amenity icon helpers =====
const slugify = (s) =>
  s.toString().trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

const amenityIconId = (cat) => `amen_${slugify(cat)}`;
const amenityIconUrl = (cat) => `/map/markers/${slugify(cat)}.png`;
const AMENITY_ICON_DEFAULT_ID = "amen_default";
const AMENITY_ICON_DEFAULT_URL = "/map/markers/default.png"; // optional fallback

// wrap map.loadImage in a promise (works for mapbox-gl v2+)
const loadImageAsync = (map, url) =>
  new Promise((resolve, reject) => {
    map.loadImage(url, (err, img) => {
      if (err) reject(err);
      else resolve(img);
    });
  });

// compute flood counts from the same csv that powers the flood layer
const computeFloodCounts = (floodFc) => {
  const by_pa = {};
  const by_sz = {};
  for (const ft of floodFc.features ?? []) {
    const p = ft.properties || {};
    const pa = (p.planning_area || p.PLAN_AREA || p.planning || "").toString().trim();
    const sz = (p.subzone || p.SUBZONE_N || "").toString().trim();
    if (pa) by_pa[pa] = (by_pa[pa] ?? 0) + 1;
    if (sz) by_sz[sz] = (by_sz[sz] ?? 0) + 1;
  }
  return { by_pa, by_sz };
};

// compute flood breakdowns by category (event) for pa and sz
const computeFloodBreakdowns = (floodFc) => {
  const byPa = {};
  const bySz = {};
  for (const ft of floodFc.features ?? []) {
    const p = ft.properties || {};
    const pa = (p.planning_area || p.PLAN_AREA || p.planning || "").toString().trim();
    const sz = (p.subzone || p.SUBZONE_N || "").toString().trim();
    const ev = (p.event || "").toString().trim() || "unspecified";
    if (pa) {
      byPa[pa] = byPa[pa] || { total: 0, by_category: {} };
      byPa[pa].total += 1;
      byPa[pa].by_category[ev] = (byPa[pa].by_category[ev] ?? 0) + 1;
    }
    if (sz) {
      bySz[sz] = bySz[sz] || { total: 0, by_category: {} };
      bySz[sz].total += 1;
      bySz[sz].by_category[ev] = (bySz[sz].by_category[ev] ?? 0) + 1;
    }
  }
  return { byPa, bySz };
};

function SingaporeHistoricalFloodMap({
  resizeSignal,
  selectedPlanningAreas = [],
  selectedSubzone,
  floodStats = {},
  onPlanningAreaToggle,
  onPlanningAreasLoaded,
  onSubzoneSelect,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const hoverPopupRef = useRef(null);
  const hasLoadedRef = useRef(false);

  // lookups
  const planningAreaFeatureRef = useRef({});
  const planningAreaIdRef = useRef({});
  const paIdToNameRef = useRef({});
  const amenityStatsByPARef = useRef({});
  const amenityStatsBySZRef = useRef({});
  const hoveredPlanningIdRef = useRef(null);
  const hoveredSubzoneIdRef = useRef(null);
  const subzoneToPARef = useRef(new Map());
  const lastHadSelectionRef = useRef(false);

  // computed flood counts (from csv)
  const floodByPaOverallRef = useRef({});
  const floodByPaRef = useRef({});
  const floodBySzRef = useRef({});

  // NEW: flood breakdowns by category (event)
  const floodCatsByPARef = useRef({});
  const floodCatsBySZRef = useRef({});

  const [error, setError] = useState(null);

  // local ui state
  const [activeSubzoneName, setActiveSubzoneName] = useState(null);
  const [viewMode, setViewMode] = useState("planning"); // 'planning' | 'subzone'
  const [colorMetric, setColorMetric] = useState("floods"); // 'floods' | 'amenities'
  const [panelOpen, setPanelOpen] = useState(true);

  // layer toggles
  const [showFloods, setShowFloods] = useState(true);
  const [showAmenities, setShowAmenities] = useState(false);

  // amenity categories
  const [amenityTypes, setAmenityTypes] = useState([]);
  const [enabledAmenityTypes, setEnabledAmenityTypes] = useState(new Set());

  // flood types (from floodsv2.csv `event`)
  const [floodTypes, setFloodTypes] = useState([]);
  const [enabledFloodTypes, setEnabledFloodTypes] = useState(new Set());

  // live count of visible floods on screen
  const [visibleFloodCount, setVisibleFloodCount] = useState(0);

  const hasSelection = selectedPlanningAreas?.length > 0;

  const {
    roadCountMap = {},
    maxRoadCount = 0,
  } = floodStats ?? {};

  // ---------- popup css once ----------
  useEffect(() => {
    const id = "map-hover-popup-style";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.innerHTML = `
        .map-hover-popup .mapboxgl-popup-content {
          background: #0b1220; color: #e2e8f0;
          border: 1px solid rgba(148,163,184,0.3);
          border-radius: 10px; padding: 10px 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        }
        .map-hover-popup .mapboxgl-popup-tip {
          border-top-color: #0b1220 !important; border-bottom-color: #0b1220 !important;
        }
        .map-hover-popup .section-title {
          font-weight: 700; color: #fff; text-transform: none; letter-spacing: .2px; margin-bottom: 4px;
        }
        .map-hover-popup .kv { color:#cbd5e1 }
        .map-hover-popup .kv strong { color:#fff }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // ---------- helpers to show popups ----------
  const showHoverPopup = (map, lngLat, html) => {
    if (!hoverPopupRef.current) {
      hoverPopupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        closeOnMove: false,
        offset: [0, -12],
        className: "map-hover-popup",
      });
    }
    hoverPopupRef.current.setLngLat(lngLat).setHTML(html).addTo(map);
  };
  const showClickPopup = (map, lngLat, html) => {
    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: [0, -12],
        className: "map-hover-popup",
      });
    }
    popupRef.current.setLngLat(lngLat).setHTML(html).addTo(map);
  };

  // ---------- recompute visible flood count ----------
  const recomputeVisibleFloods = () => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current || !map.getLayer(FLOOD_LAYER_ID) || !showFloods) {
      setVisibleFloodCount(0);
      return;
    }
    const features = map.queryRenderedFeatures({ layers: [FLOOD_LAYER_ID] }) || [];
    setVisibleFloodCount(features.length);
  };

  // ---------- amenity icons loader + styleimagemissing ----------
  const loadAmenityIcons = async (map, categories) => {
    // ensure default (optional)
    if (AMENITY_ICON_DEFAULT_URL && !map.hasImage(AMENITY_ICON_DEFAULT_ID)) {
      try {
        const defImg = await loadImageAsync(map, AMENITY_ICON_DEFAULT_URL);
        // pixelRatio 2 to keep icons crisp; source PNGs are 32×32
        map.addImage(AMENITY_ICON_DEFAULT_ID, defImg, { pixelRatio: 2 });
      } catch {}
    }

    // preload discovered categories
    await Promise.allSettled(
      categories.map(async (cat) => {
        const id = amenityIconId(cat);
        if (map.hasImage(id)) return;
        const url = amenityIconUrl(cat);
        try {
          const img = await loadImageAsync(map, url);
          map.addImage(id, img, { pixelRatio: 2 });
        } catch {
          // silently ignore; styleimagemissing will try again lazily
        }
      })
    );

    // lazy-load any missing amenity icon that the style requests later
    map.on("styleimagemissing", async (e) => {
      const id = e?.id || "";
      if (!id.startsWith("amen_")) return;
      if (map.hasImage(id)) return;

      const slug = id.replace(/^amen_/, "");
      const url = `/map/markers/${slug}.png`;
      try {
        const img = await loadImageAsync(map, url);
        map.addImage(id, img, { pixelRatio: 2 });
        map.triggerRepaint();
      } catch {
        if (AMENITY_ICON_DEFAULT_URL && !map.hasImage(AMENITY_ICON_DEFAULT_ID)) {
          try {
            const defImg = await loadImageAsync(map, AMENITY_ICON_DEFAULT_URL);
            map.addImage(AMENITY_ICON_DEFAULT_ID, defImg, { pixelRatio: 2 });
            map.triggerRepaint();
          } catch {}
        }
      }
    });
  };

  const buildAmenityIconExpression = (cats) => {
    const expr = ["match", ["to-string", ["get", "amenity_category"]]];
    for (const c of cats) expr.push(c, amenityIconId(c));
    expr.push(AMENITY_ICON_DEFAULT_ID);
    return expr;
  };

  // ---------- map init / data load ----------
  useEffect(() => {
    if (mapRef.current) return;
    if (!mapboxgl.supported()) {
      setError("webgl is not supported in this browser or device.");
      return;
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAPBOX_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: true,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

    const handleBackgroundClick = (event) => {
      const features = map.queryRenderedFeatures(event.point, { layers: [PLANNING_FILL_LAYER_ID, SUBZONE_FILL_LAYER_ID] });
      if (!features.length) {
        onPlanningAreaToggle?.(null);
        setViewMode("planning");
        setShowAmenities(false);
        setActiveSubzoneName(null);
      }
    };

    const handleLoad = async () => {
      try {
        const [planningRes, subzoneRes, roadRes, amenityCsvRes, floodCsvRes] = await Promise.all([
          fetch("/map/planning_area.geojson"),
          fetch("/map/subzone_area.geojson"),
          fetch("/map/road_network.geojson"),
          fetch("/map/amenities_3layers.csv"),
          fetch("/map/floodsv2.csv"),
        ]);

        if (!planningRes.ok) throw new Error(`failed to fetch planning_area.geojson (status ${planningRes.status})`);
        if (!subzoneRes.ok) throw new Error(`failed to fetch subzone_area.geojson (status ${subzoneRes.status})`);
        if (!roadRes.ok) throw new Error(`failed to fetch road_network.geojson (status ${roadRes.status})`);
        if (!amenityCsvRes.ok) throw new Error(`failed to fetch amenities_3layers.csv (status ${amenityCsvRes.status})`);
        if (!floodCsvRes.ok) throw new Error(`failed to fetch floodsv2.csv (status ${floodCsvRes.status})`);

        const [planningData, subzoneData, roadData, amenityCsvText, floodCsvText] = await Promise.all([
          planningRes.json(),
          subzoneRes.json(),
          roadRes.json(),
          amenityCsvRes.text(),
          floodCsvRes.text(),
        ]);

        const amenityRows = parseCsv(amenityCsvText);
        const amenityData = amenitiesCsvToGeoJSON(amenityRows);
        const floodRows = parseCsv(floodCsvText);
        const floodData = floodsCsvToGeoJSON(floodRows);

        // amenity aggregates for hover + "amenities count" metric
        const { byPA, bySZ } = aggregateAmenityStats(amenityData);
        amenityStatsByPARef.current = byPA;
        amenityStatsBySZRef.current = bySZ;

        // collect planning areas + id map
        const planningAreas = [];
        const featureMap = {};
        const idMap = {};
        for (const feature of planningData.features ?? []) {
          const name = feature?.properties?.PLN_AREA_N?.trim();
          if (!name) continue;
          planningAreas.push(name);
          featureMap[name] = feature;
          const paId = feature?.properties?.PA_ID;
          if (paId != null) idMap[name] = String(paId);
        }
        planningAreaFeatureRef.current = featureMap;
        planningAreaIdRef.current = idMap;
        paIdToNameRef.current = Object.fromEntries(Object.entries(idMap).map(([k, v]) => [v, k]));
        if (planningAreas.length) onPlanningAreasLoaded?.(planningAreas);

        // subzone -> PA map
        const szToPA = new Map();
        for (const f of subzoneData.features ?? []) {
          const sz = (f?.properties?.SUBZONE_N ?? "").toString().trim();
          const pa = (f?.properties?.PLN_AREA_N ?? "").toString().trim();
          if (!sz || !pa) continue;
          if (!szToPA.has(sz)) szToPA.set(sz, new Set());
          szToPA.get(sz).add(pa);
        }
        subzoneToPARef.current = szToPA;

        // flood counts & breakdowns from csv (source of truth for choropleths)
        const { by_pa, by_sz } = computeFloodCounts(floodData);
        floodByPaOverallRef.current = by_pa;
        floodByPaRef.current = by_pa; // same totals; scope later if needed
        floodBySzRef.current = by_sz;

        const { byPa: floodCatsPa, bySz: floodCatsSz } = computeFloodBreakdowns(floodData);
        floodCatsByPARef.current = floodCatsPa;
        floodCatsBySZRef.current = floodCatsSz;

        // sources
        map.addSource(PLANNING_SOURCE_ID, { type: "geojson", data: planningData, generateId: true });
        map.addSource(SUBZONE_SOURCE_ID, { type: "geojson", data: subzoneData, generateId: true });
        map.addSource(ROAD_SOURCE_ID, { type: "geojson", data: roadData });
        map.addSource(AMENITY_SOURCE_ID, { type: "geojson", data: amenityData, generateId: true });
        map.addSource(FLOOD_SOURCE_ID, { type: "geojson", data: floodData, generateId: true });

        // base layers
        map.addLayer({ id: PLANNING_FILL_LAYER_ID, type: "fill", source: PLANNING_SOURCE_ID, paint: { "fill-color": DEFAULT_PLANNING_COLOR, "fill-opacity": 0.75 } });
        map.addLayer({ id: PLANNING_OUTLINE_LAYER_ID, type: "line", source: PLANNING_SOURCE_ID, paint: { "line-color": "#1d4ed8", "line-width": 1.25, "line-opacity": 0.4 } });
        map.addLayer({ id: PLANNING_HIGHLIGHT_LAYER_ID, type: "line", source: PLANNING_SOURCE_ID, paint: { "line-color": "#f97316", "line-width": 3, "line-opacity": 0.9 }, filter: EMPTY_PLANNING_FILTER });
        map.addLayer({ id: SUBZONE_FILL_LAYER_ID, type: "fill", source: SUBZONE_SOURCE_ID, layout: { visibility: "none" }, paint: { "fill-color": DEFAULT_SUBZONE_COLOR, "fill-opacity": 0.55 } });
        map.addLayer({ id: SUBZONE_OUTLINE_LAYER_ID, type: "line", source: SUBZONE_SOURCE_ID, layout: { visibility: "none" }, paint: { "line-color": "#1d4ed8", "line-width": 0.8, "line-opacity": 0.7 } });
        map.addLayer({ id: SUBZONE_HIGHLIGHT_LAYER_ID, type: "line", source: SUBZONE_SOURCE_ID, layout: { visibility: "none" }, paint: { "line-color": "#fbbf24", "line-width": 3, "line-opacity": 0.9 }, filter: EMPTY_SUBZONE_HIGHLIGHT });
        map.addLayer({ id: ROAD_LAYER_ID, type: "line", source: ROAD_SOURCE_ID, layout: { visibility: "none" }, paint: { "line-color": "#f97316", "line-width": DEFAULT_ROAD_WIDTH, "line-opacity": 0.85 }, filter: EMPTY_PA_FILTER });

        // amenities as SYMBOL icons (hidden by default)
        const types = Array.from(new Set(
          (amenityData.features ?? [])
            .map(f => (f.properties?.amenity_category ?? "").toString().trim())
            .filter(Boolean)
        )).sort();

        setAmenityTypes(types);
        setEnabledAmenityTypes(new Set(types));
        await loadAmenityIcons(map, types);

        map.addLayer({
          id: AMENITY_ICON_LAYER_ID,
          type: "symbol",
          source: AMENITY_SOURCE_ID,
          layout: {
            visibility: "none",
            "icon-image": buildAmenityIconExpression(types),
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-anchor": "bottom",
            // fixed 32×32: keep your pngs at 32×32 and set size=1
            "icon-size": 1
          },
        });

        // flood event markers — circles
        map.addLayer({
          id: FLOOD_LAYER_ID,
          type: "circle",
          source: FLOOD_SOURCE_ID,
          layout: { visibility: "visible" },
          paint: {
            "circle-color": "#38bdf8",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 12, 5, 16, 7],
            "circle-stroke-width": 1.2,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 0.95,
          },
        });

        // discover unique flood types using `event`
        const fTypes = Array.from(new Set(
          (floodData.features ?? [])
            .map(f => (f.properties?.event ?? "").toString().trim())
            .filter(Boolean)
        )).sort();
        setFloodTypes(fTypes);
        setEnabledFloodTypes(new Set(fTypes));

        // hover outlines
        map.addLayer({ id: PA_HOVER_OUTLINE_ID, type: "line", source: PLANNING_SOURCE_ID, paint: {
          "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ffffff", "rgba(0,0,0,0)"],
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 5, 0],
          "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
        }});
        map.addLayer({ id: PA_HOVER_OUTLINE_INNER_ID, type: "line", source: PLANNING_SOURCE_ID, paint: {
          "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#60a5fa", "rgba(0,0,0,0)"],
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 0],
          "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
        }});
        map.addLayer({ id: SZ_HOVER_OUTLINE_ID, type: "line", source: SUBZONE_SOURCE_ID, layout: { visibility: "none" }, paint: {
          "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ffffff", "rgba(0,0,0,0)"],
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 4, 0],
          "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
        }});

        // cursors
        map.on("mouseenter", PLANNING_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", PLANNING_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
        map.on("mouseenter", SUBZONE_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", SUBZONE_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
        map.on("mouseenter", AMENITY_ICON_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", AMENITY_ICON_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
        map.on("mouseenter", ROAD_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", ROAD_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
        map.on("mouseenter", FLOOD_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", FLOOD_LAYER_ID, () => (map.getCanvas().style.cursor = ""));

        // clicks
        map.on("click", PLANNING_FILL_LAYER_ID, (event) => {
          const feature = event.features?.[0];
          const name = feature?.properties?.PLN_AREA_N?.trim();
          if (!name) return;
          const bounds = computeFeatureBounds(feature.geometry);
          if (bounds) map.fitBounds(bounds, { padding: 48, duration: 800, maxZoom: 13 });
          onPlanningAreaToggle?.(name);
          setViewMode("subzone");
          setActiveSubzoneName(null);
          setShowAmenities(true);
        });

        map.on("click", SUBZONE_FILL_LAYER_ID, (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          const properties = feature?.properties ? { ...feature.properties } : null;
          if (!properties) return;
          const payload = { properties, lngLat: [event.lngLat.lng, event.lngLat.lat], id: properties.SZ_ID ?? feature?.id ?? null };
          map.flyTo({ center: event.lngLat, zoom: Math.max(map.getZoom(), 12), essential: true, speed: 0.9, curve: 1.2 });
          onSubzoneSelect?.(payload);
          setActiveSubzoneName((properties.SUBZONE_N ?? "").toString().trim());
          setShowAmenities(true);
        });

        map.on("click", handleBackgroundClick);

        // planning hover
        map.on("mousemove", PLANNING_FILL_LAYER_ID, (e) => {
          const f = e.features?.[0]; if (!f) return;
          const id = f.id;
          if (hoveredPlanningIdRef.current !== null && hoveredPlanningIdRef.current !== id) {
            map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false });
          }
          hoveredPlanningIdRef.current = id;
          map.setFeatureState({ source: PLANNING_SOURCE_ID, id }, { hover: true });
          showHoverPopup(
            map,
            e.lngLat,
            buildHoverMarkupPlanning(
              f.properties,
              floodByPaOverallRef.current,
              floodByPaRef.current,
              amenityStatsByPARef,
              floodCatsByPARef
            )
          );
        });
        map.on("mouseleave", PLANNING_FILL_LAYER_ID, () => {
          if (hoveredPlanningIdRef.current !== null) {
            map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false });
            hoveredPlanningIdRef.current = null;
          }
          if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
        });

        // subzone hover
        map.on("mousemove", SUBZONE_FILL_LAYER_ID, (e) => {
          const f = e.features?.[0]; if (!f) return;
          const id = f.id;
          if (hoveredSubzoneIdRef.current !== null && hoveredSubzoneIdRef.current !== id) {
            map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false });
          }
          hoveredSubzoneIdRef.current = id;
          map.setFeatureState({ source: SUBZONE_SOURCE_ID, id }, { hover: true });
          showHoverPopup(
            map,
            e.lngLat,
            buildHoverMarkupSubzone(
              f.properties,
              floodBySzRef.current,
              amenityStatsBySZRef,
              floodCatsBySZRef
            )
          );
        });
        map.on("mouseleave", SUBZONE_FILL_LAYER_ID, () => {
          if (hoveredSubzoneIdRef.current !== null) {
            map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false });
            hoveredSubzoneIdRef.current = null;
          }
          if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
        });

        // amenity hover
        map.on("mousemove", AMENITY_ICON_LAYER_ID, (e) => {
          const f = e.features?.[0]; if (!f) return;
          const html = buildAmenityHoverHtml(f.properties);
          const enabledList = Array.from(enabledAmenityTypes);
          const extras = `
            <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(148,163,184,0.25)">
              <div style="font-size:11px; color:#94a3b8">
                active amenity categories: <span style="color:#e2e8f0">${enabledList.length ? enabledList.join(", ") : "none"}</span>
              </div>
            </div>`;
          showHoverPopup(map, e.lngLat, html + extras);
        });
        map.on("mouseleave", AMENITY_ICON_LAYER_ID, () => {
          if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
        });

        // road hover
        map.on("mousemove", ROAD_LAYER_ID, (e) => {
          const f = e.features?.[0]; if (!f) return;
          showHoverPopup(map, e.lngLat, buildHoverMarkupRoad(f.properties, roadCountMap, paIdToNameRef, amenityStatsByPARef));
        });
        map.on("mouseleave", ROAD_LAYER_ID, () => {
          if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
        });

        // flood popups + hover footer with active flood types
        map.on("mousemove", FLOOD_LAYER_ID, (e) => {
          const f = e.features?.[0]; if (!f) return;
          const html = buildFloodHoverHtml(f.properties);
          const enabledFloodList = Array.from(enabledFloodTypes);
          const extras = `
            <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(148,163,184,0.25)">
              <div style="font-size:11px; color:#94a3b8">
                active flood types: <span style="color:#e2e8f0">${enabledFloodList.length ? enabledFloodList.join(", ") : "none"}</span>
              </div>
            </div>`;
          showHoverPopup(map, e.lngLat, html + extras);
        });
        map.on("mouseleave", FLOOD_LAYER_ID, () => {
          if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
        });
        map.on("click", FLOOD_LAYER_ID, (e) => {
          const f = e.features?.[0]; if (!f) return;
          showClickPopup(map, e.lngLat, buildFloodHoverHtml(f.properties));
        });

        // recompute visible floods on nav changes
        map.on("moveend", recomputeVisibleFloods);
        map.on("idle", recomputeVisibleFloods);

        hasLoadedRef.current = true;
        setError(null);
      } catch (err) {
        console.error(err);
        setError("unable to load map data. ensure geojson/csv files exist in /public/map/.");
      }
    };

    map.on("load", handleLoad);
    map.on("error", (evt) => {
      console.error("mapbox gl error:", evt?.error);
      setError("the map failed to load. check your token or network connection.");
    });

    return () => {
      map.off("load", handleLoad);
      map.off("click", handleBackgroundClick);
      try {
        if (hoveredPlanningIdRef.current !== null)
          map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false });
        if (hoveredSubzoneIdRef.current !== null)
          map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false });
      } catch {}
      if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      hasLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [onPlanningAreaToggle, onPlanningAreasLoaded, onSubzoneSelect]);

  // ---------- external resize ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current) return;
    map.resize();
    const frame = requestAnimationFrame(() => {
      map.resize();
      if (typeof map.triggerRepaint === "function") map.triggerRepaint();
    });
    return () => cancelAnimationFrame(frame);
  }, [resizeSignal]);

  // ---------- selection + toggles (filters + visibility) ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current) return;
    if (!map.getLayer(SUBZONE_FILL_LAYER_ID) || !map.getLayer(ROAD_LAYER_ID) || !map.getLayer(PLANNING_HIGHLIGHT_LAYER_ID)) return;

    const hasSelectionLocal = selectedPlanningAreas?.length > 0;

    // subzone filters + planning highlight
    const subzoneFilter = buildMatchFilter("PLN_AREA_N", selectedPlanningAreas);
    map.setFilter(SUBZONE_FILL_LAYER_ID, subzoneFilter);
    map.setFilter(SUBZONE_OUTLINE_LAYER_ID, subzoneFilter);
    map.setFilter(PLANNING_HIGHLIGHT_LAYER_ID, hasSelectionLocal ? subzoneFilter : EMPTY_PLANNING_FILTER);

    // roads filter
    const paIds = (selectedPlanningAreas || []).map((name) => planningAreaIdRef.current[name]).filter(Boolean);
    map.setFilter(ROAD_LAYER_ID, buildMatchFilter("PA_ID", paIds));
    map.setLayoutProperty(ROAD_LAYER_ID, "visibility", hasSelectionLocal && paIds.length > 0 ? "visible" : "none");

    // subzone layers visibility
    const subzoneVisible = viewMode === "subzone" && hasSelectionLocal ? "visible" : "none";
    map.setLayoutProperty(SUBZONE_FILL_LAYER_ID, "visibility", subzoneVisible);
    map.setLayoutProperty(SUBZONE_OUTLINE_LAYER_ID, "visibility", subzoneVisible);
    map.setLayoutProperty(SUBZONE_HIGHLIGHT_LAYER_ID, "visibility", subzoneVisible);
    if (map.getLayer(SZ_HOVER_OUTLINE_ID)) map.setLayoutProperty(SZ_HOVER_OUTLINE_ID, "visibility", subzoneVisible);

    // amenities (symbol) + per-category filter
    if (map.getLayer(AMENITY_ICON_LAYER_ID)) {
      const subzoneName =
        (selectedSubzone?.properties?.SUBZONE_N ?? "").toString().trim() ||
        (activeSubzoneName ?? "");

      const enabledTypesArray = Array.from(enabledAmenityTypes).filter(v => v != null && v !== "").map(String);
      const typeMatch =
        enabledTypesArray.length > 0
          ? ["in", ["to-string", ["get", "amenity_category"]], ["literal", enabledTypesArray]]
          : ["==", ["to-string", ["get", "amenity_category"]], "__none__"];

      const baseClause = hasSelectionLocal
        ? buildMatchFilter("planning_area", selectedPlanningAreas)
        : ["all"];

      const subzoneClause = subzoneName
        ? ["==", ["to-string", ["get", "subzone"]], subzoneName]
        : ["all"];

      const amenityFilter = ["all", baseClause, subzoneClause, typeMatch];
      map.setFilter(AMENITY_ICON_LAYER_ID, amenityFilter);
      map.setLayoutProperty(AMENITY_ICON_LAYER_ID, "visibility", showAmenities ? "visible" : "none");
    }

    // floods + per-type filter
    if (map.getLayer(FLOOD_LAYER_ID)) {
      const enabledFloodsArray = Array.from(enabledFloodTypes).filter(v => v != null && v !== "").map(String);
      const floodTypeMatch =
        enabledFloodsArray.length > 0
          ? ["in", ["to-string", ["get", "event"]], ["literal", enabledFloodsArray]]
          : ["==", ["to-string", ["get", "event"]], "__none__"];

      const floodBase = hasSelectionLocal
        ? buildMatchFilter("planning_area", selectedPlanningAreas)
        : ["all"];

      const floodFilter = ["all", floodBase, floodTypeMatch];
      map.setFilter(FLOOD_LAYER_ID, floodFilter);
      map.setLayoutProperty(FLOOD_LAYER_ID, "visibility", showFloods ? "visible" : "none");
    }

    // visible count after filter changes
    const onceIdle = () => recomputeVisibleFloods();
    map.once("idle", onceIdle);

    // only reset camera when transitioning from selection -> none
    if (!hasSelectionLocal && lastHadSelectionRef.current) {
      setViewMode("planning");
      setShowAmenities(false);
      setActiveSubzoneName(null);
      if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
      map.easeTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 800 });
    }
    lastHadSelectionRef.current = hasSelectionLocal;

    // fit to selected planning areas
    if (hasSelectionLocal) {
      let combinedBounds = null;
      for (const areaName of selectedPlanningAreas) {
        const feature = planningAreaFeatureRef.current[areaName];
        if (!feature) continue;
        const bounds = computeFeatureBounds(feature.geometry);
        combinedBounds = mergeBounds(combinedBounds, bounds);
      }
      if (combinedBounds) map.fitBounds(combinedBounds, { padding: 48, duration: 800, maxZoom: 13 });
    }

    return () => {
      try { map.off("idle", onceIdle); } catch {}
    };
  }, [
    selectedPlanningAreas,
    selectedSubzone,
    activeSubzoneName,
    viewMode,
    showAmenities,
    showFloods,
    enabledAmenityTypes,
    enabledFloodTypes,
  ]);

  // ---------- recompute visible flood count also when resizing ----------
  useEffect(() => {
    recomputeVisibleFloods();
  }, [resizeSignal]);

  // ---------- choropleths & road width ----------
  const getPlanningColoring = () => {
    if (colorMetric === "amenities") {
      const mapm = amenityStatsByPARef.current || {};
      const countMap = Object.fromEntries(Object.entries(mapm).map(([k, v]) => [k, v.total || 0]));
      const maxCount = Math.max(1, ...Object.values(countMap), 1);
      return { countMap, maxCount };
    }
    const countMap = hasSelection ? (floodByPaRef.current || {}) : (floodByPaOverallRef.current || {});
    const vals = Object.values(countMap || {});
    const maxCount = vals.length ? Math.max(...vals, 1) : 1;
    return { countMap, maxCount };
  };

  const getSubzoneColoring = () => {
    if (colorMetric === "amenities") {
      const base = Object.fromEntries(
        Object.entries(amenityStatsBySZRef.current || {}).map(([k, v]) => [k, v.total || 0])
      );
      const vals = Object.values(base);
      return { countMap: base, maxCount: vals.length ? Math.max(...vals, 1) : 1 };
    }
    const base_map = floodBySzRef.current || {};
    if (!selectedPlanningAreas?.length) {
      const vals = Object.values(base_map);
      return { countMap: base_map, maxCount: vals.length ? Math.max(...vals, 1) : 1 };
    }
    const scoped = {};
    for (const [sz, val] of Object.entries(base_map)) {
      const pa_set = subzoneToPARef.current.get(sz);
      if (!pa_set) continue;
      for (const pa of pa_set) {
        if (selectedPlanningAreas.includes(pa)) {
          scoped[sz] = (scoped[sz] ?? 0) + Number(val || 0);
          break;
        }
      }
    }
    const vals = Object.values(scoped);
    return { countMap: scoped, maxCount: vals.length ? Math.max(...vals, 1) : 1 };
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current) return;
    if (!map.getLayer(PLANNING_FILL_LAYER_ID)) return;

    // planning choropleth
    const { countMap: paCounts, maxCount: paMax } = getPlanningColoring();
    const planningExpr = buildChoroplethExpression("PLN_AREA_N", paCounts, paMax, PLANNING_COLORS, DEFAULT_PLANNING_COLOR);
    map.setPaintProperty(PLANNING_FILL_LAYER_ID, "fill-color", [
      "case",
      ["boolean", ["feature-state", "hover"], false],
      HOVER_FILL_COLOR,
      planningExpr,
    ]);
    map.setPaintProperty(
      PLANNING_FILL_LAYER_ID,
      "fill-opacity",
      viewMode === "subzone" ? 0.15 : ["case", ["boolean", ["feature-state", "hover"], false], 0.95, 0.75]
    );

    // subzone choropleth
    if (map.getLayer(SUBZONE_FILL_LAYER_ID)) {
      if (viewMode === "subzone" && selectedPlanningAreas.length > 0) {
        const { countMap: szCounts, maxCount: szMax } = getSubzoneColoring();
        const subzoneExpr = buildChoroplethExpression("SUBZONE_N", szCounts, szMax, SUBZONE_COLORS, DEFAULT_SUBZONE_COLOR);
        map.setPaintProperty(SUBZONE_FILL_LAYER_ID, "fill-color", [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          HOVER_FILL_COLOR,
          subzoneExpr,
        ]);
        map.setPaintProperty(SUBZONE_FILL_LAYER_ID, "fill-opacity", [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          0.9,
          0.6,
        ]);
      } else {
        map.setPaintProperty(SUBZONE_FILL_LAYER_ID, "fill-color", DEFAULT_SUBZONE_COLOR);
        map.setPaintProperty(SUBZONE_FILL_LAYER_ID, "fill-opacity", 0.0);
      }
    }

    // roads width
    if (map.getLayer(ROAD_LAYER_ID)) {
      const roadWidthExpression =
        selectedPlanningAreas.length > 0
          ? buildLineWidthExpression(["coalesce", ["get", "RN_ID"], ["get", "RD_NAME"]], roadCountMap ?? {}, maxRoadCount ?? 0, 1.2, 6, DEFAULT_ROAD_WIDTH)
          : DEFAULT_ROAD_WIDTH;
      map.setPaintProperty(ROAD_LAYER_ID, "line-width", roadWidthExpression);
    }
  }, [selectedPlanningAreas, viewMode, colorMetric, floodStats]);

  // ---------- ui ----------
  const legendTitle =
    viewMode === "subzone"
      ? colorMetric === "amenities"
        ? "subzone amenities (count)"
        : "subzone flood choropleth"
      : colorMetric === "amenities"
        ? "planning area amenities (count)"
        : "planning area flood choropleth";

  const legendMax = (() => {
    if (viewMode === "subzone") {
      const { maxCount } = getSubzoneColoring();
      return maxCount || 0;
    }
    const { maxCount } = getPlanningColoring();
    return maxCount || 0;
  })();

  return (
    <div className="relative h-full min-h-[24rem] w-full">
      <div ref={mapContainerRef} className="absolute inset-0 map-container" />

      {/* collapse/expand fab */}
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        className="absolute right-3 top-3 sm:right-4 sm:top-4 z-10 rounded-full bg-slate-900/90 border border-white/10 px-3 py-1.5 text-xs text-slate-200 shadow-lg hover:bg-slate-800"
        aria-label={panelOpen ? "collapse controls" : "expand controls"}
      >
        {panelOpen ? "hide controls" : "show controls"}
      </button>

      {/* controls (collapsible) */}
      {panelOpen && (
        <div className="pointer-events-none absolute right-3 top-12 sm:right-4 sm:top-14 flex flex-col items-end gap-3">
          <div className="pointer-events-auto rounded-xl bg-slate-900/90 border border-white/10 shadow-lg p-3 text-xs text-slate-200 w-[300px]">
            <div className="font-semibold text-slate-100 mb-2">display</div>

            {/* choropleth metric */}
            <label className="block mb-2">
              <span className="text-slate-300">color by</span>
              <select
                className="mt-1 w-full rounded bg-slate-800 border border-slate-600 p-1.5"
                value={colorMetric}
                onChange={(e) => setColorMetric(e.target.value)}
              >
                <option value="floods">flood events</option>
                <option value="amenities">amenities (count)</option>
              </select>
            </label>

            {/* flood toggle */}
            <label className="inline-flex items-center gap-2 mt-1">
              <input type="checkbox" checked={showFloods} onChange={(e) => setShowFloods(e.target.checked)} />
              <span>
                show flood markers {showFloods ? <span className="text-slate-400">({visibleFloodCount} shown)</span> : null}
              </span>
            </label>

            {/* flood types */}
            {showFloods ? (
              <div className="mt-2">
                <div className="mb-1 text-[11px] text-slate-300">flood types (from “event”)</div>
                <div className="flex gap-2 mb-2">
                  <button
                    className="pointer-events-auto rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                    onClick={() => setEnabledFloodTypes(new Set(floodTypes))}
                    type="button"
                  >
                    select all
                  </button>
                  <button
                    className="pointer-events-auto rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                    onClick={() => setEnabledFloodTypes(new Set())}
                    type="button"
                  >
                    clear
                  </button>
                </div>
                <div className="max-h-40 overflow-auto pr-1 space-y-1">
                  {floodTypes.map((t) => {
                    const checked = enabledFloodTypes.has(t);
                    return (
                      <label key={t} className="flex items-center gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setEnabledFloodTypes(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(t); else next.delete(t);
                              return next;
                            });
                          }}
                        />
                        <span className="truncate">{t}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* amenities toggle */}
            <label className="inline-flex items-center gap-2 mt-3">
              <input
                type="checkbox"
                checked={showAmenities}
                onChange={(e) => setShowAmenities(e.target.checked)}
              />
              <span>
                show amenities {(selectedSubzone?.properties?.SUBZONE_N || activeSubzoneName) ? " (subzone)" : (hasSelection ? " (planning area)" : " (all)")}
              </span>
            </label>

            {/* amenity categories list */}
            {showAmenities ? (
              <div className="mt-2">
                <div className="mb-1 text-[11px] text-slate-300">amenity categories</div>
                <div className="flex gap-2 mb-2">
                  <button
                    className="pointer-events-auto rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                    onClick={() => setEnabledAmenityTypes(new Set(amenityTypes))}
                    type="button"
                  >
                    select all
                  </button>
                  <button
                    className="pointer-events-auto rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                    onClick={() => setEnabledAmenityTypes(new Set())}
                    type="button"
                  >
                    clear
                  </button>
                </div>

                <div className="max-h-40 overflow-auto pr-1 space-y-1">
                  {amenityTypes.map((t) => {
                    const checked = enabledAmenityTypes.has(t);
                    return (
                      <label key={t} className="flex items-center gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setEnabledAmenityTypes(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(t); else next.delete(t);
                              return next;
                            });
                          }}
                        />
                          <span className="truncate">{t}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {viewMode === "planning" && (
              <div className="mt-2 text-[11px] text-slate-400">click a planning area to drill into subzones.</div>
            )}
          </div>
        </div>
      )}

      {/* legend */}
      <div className="pointer-events-none absolute left-3 bottom-3 sm:left-4 sm:bottom-4">
        <div className="pointer-events-auto rounded-xl bg-slate-900/90 border border-white/10 shadow-lg p-3 text-xs text-slate-200 min-w-[220px]">
          <div className="font-semibold text-slate-100">{legendTitle}</div>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex h-2 flex-1 overflow-hidden rounded">
              {(viewMode === "subzone" ? SUBZONE_COLORS : PLANNING_COLORS).map((c, i) => (
                <span key={i} style={{ backgroundColor: c }} className="h-full flex-1" />
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-300">0</span>
              <span className="text-slate-500">→</span>
              <span className="text-slate-100 font-semibold">{legendMax}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full border border-white" style={{ backgroundColor: "#38bdf8" }} />
            <span className="text-slate-300">flood event</span>
          </div>

          {selectedPlanningAreas?.length > 0 && (
            <div className="mt-2 text-[11px] text-slate-400">
              filtering to: <span className="ml-1 font-medium text-slate-200">{selectedPlanningAreas.join(", ")}</span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900/70 p-6 text-white">
          <div className="w-full max-w-sm rounded-xl bg-slate-900/90 p-5 text-center shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">map unavailable</p>
            <p className="mt-2 text-sm text-slate-100">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default SingaporeHistoricalFloodMap;
