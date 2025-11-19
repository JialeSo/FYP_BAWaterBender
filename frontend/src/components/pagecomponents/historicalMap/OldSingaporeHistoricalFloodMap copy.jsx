// components/map/singaporehistoricalfloodmap.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import ReactDOM from "react-dom/client";
import PopupContent from "./PopupContent";
import { useMapData } from "@/context/mapDataContext";

import {
  buildMatchFilter,
  computeFeatureBounds,
  mergeBounds,
  buildChoroplethExpression,
  buildLineWidthExpression,
  aggregateAmenityStats,
} from "../../../utils/map/helpers";

/* ===== mapbox base config ===== */
const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const MAPBOX_STYLE = "mapbox://styles/mapbox/streets-v12";
const DEFAULT_CENTER = [103.8198, 1.3521];
const DEFAULT_ZOOM = 11;

mapboxgl.accessToken = MAPBOX_TOKEN;
if (typeof mapboxgl.setTelemetryEnabled === "function") mapboxgl.setTelemetryEnabled(false);

/* ===== ids ===== */
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

/* hover outlines */
const PA_HOVER_OUTLINE_ID = "planning-area-hover-outline";
const PA_HOVER_OUTLINE_INNER_ID = "planning-area-hover-outline-inner";
const SZ_HOVER_OUTLINE_ID = "subzone-hover-outline";
/* filters / styling constants */
const EMPTY_PLANNING_FILTER = ["==", ["get", "PLN_AREA_N"], "__none__"];
const EMPTY_PA_FILTER = ["==", ["get", "PA_ID"], "__none__"];
const EMPTY_SUBZONE_HIGHLIGHT = ["==", ["get", "SZ_ID"], "__none__"];

const PLANNING_COLORS = ["#e0f2fe", "#bae6fd", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8"];
const SUBZONE_COLORS = ["#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626"];
const DEFAULT_PLANNING_COLOR = "#e2e8f0";
const DEFAULT_SUBZONE_COLOR = "rgba(37, 99, 235, 0.18)";
const DEFAULT_ROAD_WIDTH = 2.0; // thicker baseline
const HOVER_FILL_COLOR = "#fef08a";

/* amenity icon helpers */
const slugify = (s) => s.toString().trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
const amenityIconId = (s) => `amen_${slugify(s)}`;
const amenityIconUrl = (s) => `/map/markers/${slugify(s)}.png`;
const AMENITY_ICON_DEFAULT_ID = "amen_default";
const AMENITY_ICON_DEFAULT_URL = "/map/markers/default.png";

/* wrap map.loadImage in a promise */
const loadImageAsync = (map, url) =>
  new Promise((resolve, reject) => {
    map.loadImage(url, (err, img) => (err ? reject(err) : resolve(img)));
  });

/* flood icon helpers */
const floodSlug = (s) =>
  (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
const floodIconId = (type) => `flood_${floodSlug(type)}`;
const floodIconUrl = (type) => `/map/markers/${floodSlug(type)}.png`;
const FLOOD_ICON_DEFAULT_ID = "flood_default";
const FLOOD_ICON_DEFAULT_URL = "/map/markers/default.png";

const buildFloodIconExpression = (types) => [
  "match",
  ["coalesce", ["to-string", ["downcase", ["get", "event"]]], ["to-string", ["downcase", ["get", "flood_type"]]], ""],
  ...types.flatMap((t) => [t.toLowerCase(), floodIconId(t)]),
  FLOOD_ICON_DEFAULT_ID,
];

async function loadFloodIcons(map, typeList) {
  if (FLOOD_ICON_DEFAULT_URL && !map.hasImage(FLOOD_ICON_DEFAULT_ID)) {
    try {
      const defImg = await loadImageAsync(map, FLOOD_ICON_DEFAULT_URL);
      map.addImage(FLOOD_ICON_DEFAULT_ID, defImg, { pixelRatio: 2 });
    } catch {}
  }
  await Promise.allSettled(
    (typeList || []).map(async (t) => {
      const id = floodIconId(t);
      if (map.hasImage(id)) return;
      try {
        const img = await loadImageAsync(map, floodIconUrl(t));
        map.addImage(id, img, { pixelRatio: 2 });
      } catch {}
    })
  );

  map.on("styleimagemissing", async (e) => {
    const id = e?.id || "";
    if (!id.startsWith("flood_") || map.hasImage(id)) return;
    try {
      const img = await loadImageAsync(map, `/map/markers/flood/${id.replace(/^flood_/, "")}.png`);
      map.addImage(id, img, { pixelRatio: 2 });
      map.triggerRepaint();
    } catch {
      if (!map.hasImage(FLOOD_ICON_DEFAULT_ID) && FLOOD_ICON_DEFAULT_URL) {
        try {
          const defImg = await loadImageAsync(map, FLOOD_ICON_DEFAULT_URL);
          map.addImage(FLOOD_ICON_DEFAULT_ID, defImg, { pixelRatio: 2 });
          map.triggerRepaint();
        } catch {}
      }
    }
  });
}

/* compute flood counts from FC for choropleths/hover */
const computeFloodCounts = (floodFc) => {
  const by_pa = {};
  const by_sz = {};
  for (const ft of floodFc?.features ?? []) {
    const p = ft.properties || {};
    const pa = (p.planning_area || p.PLAN_AREA || p.planning || "").toString().trim();
    const sz = (p.subzone || p.SUBZONE_N || "").toString().trim();
    if (pa) by_pa[pa] = (by_pa[pa] ?? 0) + 1;
    if (sz) by_sz[sz] = (by_sz[sz] ?? 0) + 1;
  }
  return { by_pa, by_sz };
};

const computeFloodBreakdowns = (floodFc) => {
  const byPa = {};
  const bySz = {};
  for (const ft of floodFc?.features ?? []) {
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

const normaliseString = (value) => (value ?? "").toString().trim();
const getPlanningArea = (props) =>
  normaliseString(
    props?.planning_area ??
      props?.PLN_AREA_N ??
      props?.planning ??
      props?.start_planning_area ??
      props?.end_planning_area ??
      ""
  );
const getFloodType = (props) => normaliseString(props?.event ?? props?.flood_type ?? "").toLowerCase();
const getEventDate = (props) => normaliseString(props?.event_date ?? props?.date ?? "");
const isWithinDateRange = (value, fromDate, toDate) => {
  if (!fromDate && !toDate) return true;
  if (!value) return false;
  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) return false;
  if (fromDate && candidate < fromDate) return false;
  if (toDate && candidate > toDate) return false;
  return true;
};

/* ===== local pretty hover builders (no meters, just counts) ===== */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
const fmt = (n) => (Number.isFinite(+n) ? Number(n).toLocaleString() : String(n ?? "-"));

function buildNiceAmenityHtml(p) {
  const name = esc(p?.amenity_name || p?.amenity_type || "amenity");
  const cat = esc(p?.amenity_category || "");
  const rd = esc(p?.road_name || p?.nearest_road_1_name || "");
  const pa = esc(p?.planning_area || "");
  const sz = esc(p?.subzone || "");
  return `
    <div class="card">
      <div class="title">⛑ ${name}</div>
      <div class="chips">
        ${cat ? `<span class="chip chip-amen">${cat}</span>` : ""}
        ${rd ? `<span class="chip">${rd}</span>` : ""}
      </div>
      <div class="kv"><strong>planning area:</strong> ${pa || "-"}</div>
      <div class="kv"><strong>subzone:</strong> ${sz || "-"}</div>
    </div>
  `;
}

function buildNiceFloodHtml(p) {
  const event = esc(p?.event || p?.flood_type || "flood");
  const when = esc(p?.event_date || p?.date || "");
  const loc = esc(p?.location || p?.start_street_name || p?.end_street_name || "");
  const pa = esc(p?.start_planning_area || p?.planning_area || "");
  const sz = esc(p?.start_subzone || p?.subzone || "");
  return `
    <div class="card">
      <div class="title">🌧 ${event}</div>
      <div class="chips">
        ${when ? `<span class="chip chip-flood">${when}</span>` : ""}
        ${loc ? `<span class="chip">${loc}</span>` : ""}
      </div>
      <div class="kv"><strong>planning area:</strong> ${pa || "-"}</div>
      <div class="kv"><strong>subzone:</strong> ${sz || "-"}</div>
    </div>
  `;
}

function buildRoadHoverHtml(props, amenMap, floodMap) {
  const rnId = (props?.RN_ID ?? props?.rd_id ?? "").toString().trim();
  const name = ( props?.RD_NAME ?? props?.road_name ?? rnId ?? "Unknown road" )?.toString().trim();
  // favour RN_ID, then name
  const amen = amenMap[rnId] ?? amenMap[name] ?? 0;
  const flood = floodMap[rnId] ?? floodMap[name] ?? 0;

  return `
    <div class="card road-card">
      <div class="title">${esc(name)}</div>
      <div class="chips">
        <span class="chip chip-amen">⛑ amenities: <strong>${fmt(amen)}</strong></span>
        <span class="chip chip-flood">🌧 floods: <strong>${fmt(flood)}</strong></span>
      </div>
      <div class="kv"><strong>rn_id:</strong> ${esc(rnId || "-")}</div>
    </div>
  `;
}

/* ===== per-road counts from your schemas ===== */
const asKey = (v) => (v === undefined || v === null ? "" : String(v).trim());
const inc = (obj, key, by = 1) => {
  if (!key) return;
  obj[key] = (obj[key] ?? 0) + by;
};

const computeRoadAmenityCounts = (fc) => {
  const m = {};
  for (const f of fc?.features ?? []) {
    const p = f.properties || {};
    const key =
      asKey(p.nearest_road_1_rn_id) ||
      asKey(p.nearest_road_1_id) ||
      asKey(p.nearest_road_1_name) ||
      ""; // prefer RN_ID
    if (!key) continue;
    inc(m, key, 1);
  }
  return m;
};

const computeRoadFloodCounts = (fc) => {
  const m = {};
  for (const f of fc?.features ?? []) {
    const p = f.properties || {};
    const key =
      asKey(p.nearest_road_1_id) ||
      asKey(p.parent_road) ||
      asKey(p.start_street_name) ||
      asKey(p.end_street_name) ||
      "";
    if (!key) continue;
    inc(m, key, 1);
  }
  return m;
};

function SingaporeHistoricalFloodMap({
  resizeSignal,
  selectedPlanningAreas = [],
  selectedSubzone,
  onPlanningAreaToggle,
  onPlanningAreasLoaded,
  onSubzoneSelect,
  planningData: planningDataProp,
  subzoneData: subzoneDataProp,
  roadData: roadDataProp,
  amenityData: amenityDataProp,
  floodData: floodDataProp,
  amenityTypes: amenityTypesProp = [],
  floodTypes: floodTypesProp = [],
  selectedAmenityCategories = [],
  selectedAmenityTypes = [],
  onAmenityTypesChange,
  selectedFloodTypes = [],
  onFloodTypesChange,
  floodDateFrom = "",
  floodDateTo = "",
  floodStats = {},
  showFloods,
  setShowFloods,
  showAmenities,
  setShowAmenities,
}) {
  const mapData = useMapData();

  const planningData =
    planningDataProp ??
    mapData?.planning_fc_enriched ??
    mapData?.planning_fc_raw ??
    mapData?.planning_fc ??
    mapData?.planning ??
    null;

  const subzoneData =
    subzoneDataProp ??
    mapData?.subzone_fc_enriched ??
    mapData?.subzone_fc_raw ??
    mapData?.subzone_fc ??
    mapData?.subzone ??
    null;

  const roadData =
    roadDataProp ??
    mapData?.road_fc_enriched ??
    mapData?.road_fc ??
    mapData?.road ??
    null;

  const amenityData =
    amenityDataProp ??
    mapData?.amenity_fc_enriched ??
    mapData?.amenity_fc_raw ??
    mapData?.amenity_fc ??
    mapData?.amenities ??
    null;

  const floodData =
    floodDataProp ??
    mapData?.floods_fc_enriched ??
    mapData?.floods_fc_raw ??
    mapData?.floods_fc ??
    mapData?.floods ??
    null;

  const categoryTable = mapData?.category_lookup?.table ?? null;

  const fallbackAmenityTypes = useMemo(() => {
    if (!Array.isArray(categoryTable)) return [];
    return categoryTable.map((row) => row.amenity_category).filter(Boolean);
  }, [categoryTable]);

  const amenityTypes = useMemo(
    () => (amenityTypesProp?.length ? amenityTypesProp : fallbackAmenityTypes),
    [amenityTypesProp, fallbackAmenityTypes]
  );

  const fallbackFloodTypes = useMemo(() => {
    const features = floodData?.features || [];
    const set = new Set();
    for (const feature of features) {
      const type = S(feature?.properties?.event ?? feature?.properties?.flood_type);
      if (type) set.add(type);
    }
    return Array.from(set).sort();
  }, [floodData]);

  const floodTypes = useMemo(
    () => (floodTypesProp?.length ? floodTypesProp : fallbackFloodTypes),
    [floodTypesProp, fallbackFloodTypes]
  );

  const dataError = mapData?.error ?? null;
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const hoverPopupRef = useRef(null);
  const hasLoadedRef = useRef(false);

  /* lookups */
  const planningAreaFeatureRef = useRef({});
  const planningAreaIdRef = useRef({});
  const paIdToNameRef = useRef({});
  const paNamesRef = useRef([]); // keep the PA universe for ranking
  const amenityStatsByPARef = useRef({});
  const amenityStatsBySZRef = useRef({});
  const amenityStatsByPAAllRef = useRef({});
  const amenityStatsBySZAllRef = useRef({});
  const floodCatsByPAOverallRef = useRef({});
  const floodCatsBySZOverallRef = useRef({});
  const hoveredPlanningIdRef = useRef(null);
  const hoveredSubzoneIdRef = useRef(null);
  const subzoneToPARef = useRef(new Map());
  const lastHadSelectionRef = useRef(false);

  /* flood aggregates */
  const floodByPaOverallRef = useRef({});
  const floodByPaRef = useRef({});
  const floodBySzRef = useRef({});
  const floodCatsByPARef = useRef({});
  const floodCatsBySZRef = useRef({});

  // per-road aggregates
  const roadAmenityCountRef = useRef({});
  const roadFloodCountRef = useRef({});
  const roadWeightMapRef = useRef({});
  const roadWeightMaxRef = useRef(0);

  const [error, setError] = useState(null);
  const blockingError = error || dataError || null;

  /* local ui */
  const [activeSubzoneName, setActiveSubzoneName] = useState(null);
  const [viewMode, setViewMode] = useState("planning"); // 'planning' | 'subzone'

  useEffect(() => {
    if (selectedPlanningAreas?.length && viewMode !== "subzone") {
      setViewMode("subzone");
      setShowAmenities?.(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanningAreas?.length]);

  // if a subzone is picked externally, zoom to it
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current) return;

    const name = (selectedSubzone?.properties?.SUBZONE_N ?? "").toString().trim();
    if (!name) return;

    const feat = (subzoneData?.features || []).find(
      (f) => (f?.properties?.SUBZONE_N ?? "").toString().trim() === name
    );
    if (!feat) return;

    const b = computeFeatureBounds(feat.geometry);
    if (b) {
      map.fitBounds(b, { padding: 48, duration: 800, maxZoom: 14 });
      setViewMode("subzone");
      setShowAmenities?.(true);
    }
  }, [selectedSubzone]);


  const [colorMetric, setColorMetric] = useState("floods"); // 'floods' | 'amenities'
  const [panelOpen, setPanelOpen] = useState(true);
  const [displayFloodTypes, setDisplayFloodTypes] = useState(floodTypes || []);
  
  useEffect(() => {
    if ((floodTypes || []).length) {
      setDisplayFloodTypes(cur =>
        cur.length ? cur : floodTypes.map(v => String(v ?? "").trim())
      );
    }
  }, [floodTypes]);


  const [visibleFloodCount, setVisibleFloodCount] = useState(0);

  const { roadCountMap = {}, maxRoadCount = 0 } = floodStats ?? {};

  // filters from parent (not used for marker toggles)
  const amenityCategoryFilter = useMemo(
    () => (selectedAmenityCategories || []).map((v) => normaliseString(v)).filter(Boolean),
    [selectedAmenityCategories]
  );
  const amenityTypeFilter = useMemo(
    () => (selectedAmenityTypes || []).map((v) => normaliseString(v)).filter(Boolean),
    [selectedAmenityTypes]
  );
  const floodTypeFilter = useMemo(
    () => (selectedFloodTypes || []).map((v) => normaliseString(v)).filter(Boolean),
    [selectedFloodTypes]
  );
  const floodTypeFilterLowerList = useMemo(() => floodTypeFilter.map((v) => v.toLowerCase()), [floodTypeFilter]);

  // LOCAL lists (used for marker layers only)
  const displayFloodTypesLowerList = useMemo(
    () => (displayFloodTypes || []).map((v) => normaliseString(v).toLowerCase()).filter(Boolean),
    [displayFloodTypes]
  );
 
  
   // global (catalog) list of amenity categories — independent of PA/subzone
  const globalAmenityCategories = useMemo(() => {
   if ((amenityTypes || []).length) {
     // if you pass the catalog in via props, use it
     return amenityTypes.map((v) => normaliseString(v)).filter(Boolean).sort();
   }
   const cats = new Set();
   for (const f of amenityData?.features ?? []) {
     const c = normaliseString(f?.properties?.amenity_category);
     if (c) cats.add(c);
   }
   return Array.from(cats).sort();
 }, [amenityTypes, amenityData]);


  const availableAmenityCategories = useMemo(() => {
    if (!amenityData) return [];

    const paSet  = new Set((selectedPlanningAreas || []).map((v) => normaliseString(v)).filter(Boolean));
    const typeSet = new Set((selectedAmenityTypes || []).map((v) => normaliseString(v)).filter(Boolean)); // LeftPanel type filter
    const catFilterSet = new Set((selectedAmenityCategories || []).map((v) => normaliseString(v)).filter(Boolean)); // LeftPanel category filter

    const effectiveSubzoneName =
      (selectedSubzone?.properties?.SUBZONE_N ?? "").toString().trim() ||
      (activeSubzoneName || "");

    const cats = new Set();

    for (const f of amenityData.features || []) {
      const p   = f.properties || {};
      const cat = normaliseString(p.amenity_category);
      const typ = normaliseString(p.amenity_type);
      if (!cat) continue;

      // LeftPanel filters (still respected)
      if (catFilterSet.size && !catFilterSet.has(cat)) continue;
      if (typeSet.size && !typeSet.has(typ)) continue;

      if (paSet.size) {
        const pa = normaliseString(p.planning_area);
        if (!paSet.has(pa)) continue;
      }
      if (effectiveSubzoneName) {
        const sz = normaliseString(p.subzone);
        if (sz !== normaliseString(effectiveSubzoneName)) continue;
      }

      cats.add(cat);
    }

    return Array.from(cats).sort();
  }, [
    amenityData,
    selectedPlanningAreas,
    selectedSubzone,
    activeSubzoneName,
    selectedAmenityCategories,
    selectedAmenityTypes,
  ]);

  
  const [displayAmenityCategories, setDisplayAmenityCategories] = useState([]); // start empty; will auto-fill from availability
  const displayAmenityCategoriesNorm = useMemo(
    () => (displayAmenityCategories || []).map((v) => normaliseString(v)).filter(Boolean),
    [displayAmenityCategories]
  );


  const handleFloodTypesSelectAll = () => setDisplayFloodTypes(floodTypes || []);
  const handleFloodTypesClear = () => setDisplayFloodTypes([]);
  const handleFloodTypeDisplayToggle = (type, shouldEnable) => {
    const normalized = normaliseString(type);
    if (!normalized) return;
    setDisplayFloodTypes((prev) => {
      const next = new Set(prev);
      if (shouldEnable) next.add(normalized);
      else next.delete(normalized);
      return Array.from(next);
    });
  };

  const handleAmenityTypesSelectAll = () => setDisplayAmenityTypes(amenityTypes || []);
  const handleAmenityTypesClear = () => setDisplayAmenityTypes([]);
  const handleAmenityTypeDisplayToggle = (type, shouldEnable) => {
    const normalized = normaliseString(type);
    if (!normalized) return;
    setDisplayAmenityTypes((prev) => {
      const next = new Set(prev);
      if (shouldEnable) next.add(normalized);
      else next.delete(normalized);
      return Array.from(next);
    });
  };

  useEffect(() => {
   // If nothing chosen yet, pick ALL global categories.
   if (!displayAmenityCategories.length) {
     setDisplayAmenityCategories(globalAmenityCategories);
     return;
   }
   // Optionally: merge in any *new* categories that appear in the catalog.
   setDisplayAmenityCategories((prev) => {
     const cur = new Set(prev.map(normaliseString));
     for (const c of globalAmenityCategories) cur.add(c);
     return Array.from(cur);
   });
 }, [globalAmenityCategories]);  // note: no PA/subzone dependency here

  const hasSelection = selectedPlanningAreas?.length > 0;

  // React popup helpers (hover for polygons)
  const hoverReactRootRef = useRef(null);
  const hoverReactContainerRef = useRef(null);
  const popupCssInjectedRef = useRef(false);

  function showHoverPopupReact(map, lngLat, jsx) {
    if (!hoverPopupRef.current) {
      hoverReactContainerRef.current = document.createElement("div");
      hoverPopupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        closeOnMove: false,
        offset: [0, -12],
        className: "map-hover-popup",
        maxWidth: "380px",
      })
        .setLngLat(lngLat)
        .setDOMContent(hoverReactContainerRef.current)
        .addTo(map);
      hoverReactRootRef.current = ReactDOM.createRoot(hoverReactContainerRef.current);
    } else {
      hoverPopupRef.current.setLngLat(lngLat);
    }
    hoverReactRootRef.current.render(jsx);
  }
  function clearHoverPopupReact() {
    try { if (hoverReactRootRef.current) hoverReactRootRef.current.render(null); } catch {}
    if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
    hoverReactRootRef.current = null;
    hoverReactContainerRef.current = null;
  }

  /* popup css once */
  useEffect(() => {
    if (popupCssInjectedRef.current) return;
    const id = "map-hover-popup-style";
    if (document.getElementById(id)) {
      popupCssInjectedRef.current = true;
      return;
    }
    const style = document.createElement("style");
    style.id = id;
    style.innerHTML = `
      .map-hover-popup .mapboxgl-popup-content {
        background: #0b1220; color: #e2e8f0;
        border: 1px solid rgba(148,163,184,0.3);
        border-radius: 10px; padding: 10px 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        max-width:none;
      }
      .mapboxgl-popup { z-index: 1000; }
      .map-hover-popup .mapboxgl-popup-tip { border-top-color: #0b1220 !important; border-bottom-color: #0b1220 !important; }

      .card { display:grid; gap:8px; }
      .title { font-weight:700; color:#fff; font-size:13px; }
      .chips { display:flex; gap:6px; flex-wrap:wrap; }
      .chip { padding:2px 6px; border-radius:999px; font-size:11px; line-height:16px; display:inline-flex; align-items:center; gap:6px; background:rgba(148,163,184,.15); border:1px solid rgba(148,163,184,.3); color:#cbd5e1; }
      .chip-amen { background:rgba(34,197,94,.15); border:1px solid rgba(34,197,94,.35); color:#bbf7d0; }
      .chip-flood{ background:rgba(56,189,248,.15); border:1px solid rgba(56,189,248,.35); color:#bae6fd; }
      .kv { color:#cbd5e1; font-size:11px }
    `;
    document.head.appendChild(style);
    popupCssInjectedRef.current = true;
  }, []);

  // simple html hovers
  const showHoverPopup = (map, lngLat, html) => {
    if (!hoverPopupRef.current) {
      hoverPopupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        closeOnMove: false,
        offset: [0, -12],
        className: "map-hover-popup",
        maxWidth: "380px",
      });
    }
    hoverPopupRef.current.setLngLat(lngLat).setHTML(html).addTo(map);
  };
  const clearHoverPopup = () => {
    if (hoverPopupRef.current) {
      hoverPopupRef.current.remove();
      hoverPopupRef.current = null;
    }
  };

  const showClickPopup = (map, lngLat, html) => {
    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: [0, -12],
        className: "map-hover-popup",
        maxWidth: "380px",
      });
    }
    popupRef.current.setLngLat(lngLat).setHTML(html).addTo(map);
  };

  const recomputeVisibleFloods = () => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current || !map.getLayer(FLOOD_LAYER_ID) || !showFloods) {
      setVisibleFloodCount(0);
      return;
    }
    const features = map.queryRenderedFeatures({ layers: [FLOOD_LAYER_ID] }) || [];
    setVisibleFloodCount(features.length);
  };

  const loadAmenityIcons = async (map, categories) => {
    if (AMENITY_ICON_DEFAULT_URL && !map.hasImage(AMENITY_ICON_DEFAULT_ID)) {
      try {
        const defImg = await loadImageAsync(map, AMENITY_ICON_DEFAULT_URL);
        map.addImage(AMENITY_ICON_DEFAULT_ID, defImg, { pixelRatio: 2 });
      } catch {}
    }
    await Promise.allSettled(
      categories.map(async (cat) => {
        const id = amenityIconId(cat);
        if (map.hasImage(id)) return;
        try {
          const img = await loadImageAsync(map, amenityIconUrl(cat));
          map.addImage(id, img, { pixelRatio: 2 });
        } catch {}
      })
    );
    map.on("styleimagemissing", async (e) => {
      const id = e?.id || "";
      if (!id.startsWith("amen_") || map.hasImage(id)) return;
      try {
        const img = await loadImageAsync(map, `/map/markers/${id.replace(/^amen_/, "")}.png`);
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
  const [displayAmenityTypes, setDisplayAmenityTypes] = useState(amenityTypes || []);
  const displayAmenityTypesNorm = useMemo(
    () => (displayAmenityTypes || []).map((v) => normaliseString(v)).filter(Boolean),
    [displayAmenityTypes]
  );

  
  const buildAmenityIconExpression = (cats) => {
    const expr = ["match", ["to-string", ["get", "amenity_category"]]];
    for (const c of cats) expr.push(c, amenityIconId(c));
    expr.push(AMENITY_ICON_DEFAULT_ID);
    return expr;
  };

  /* --------- map init (no fetching) ---------- */
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
      const features = map.queryRenderedFeatures(event.point, {
        layers: [PLANNING_FILL_LAYER_ID, SUBZONE_FILL_LAYER_ID],
      });
      if (!features.length) {
        onPlanningAreaToggle?.(null);
        setViewMode("planning");
        setActiveSubzoneName(null);
        setShowAmenities(false);
      }
    };

    const handleLoad = async () => {
      try {
        if (!planningData || !subzoneData || !roadData || !amenityData || !floodData) {
          setError("datasets not ready yet.");
          return;
        }

        // amenity aggregates (overall + live)
        const { byPA, bySZ } = aggregateAmenityStats(amenityData);
        amenityStatsByPARef.current = byPA; // live (filtered)
        amenityStatsBySZRef.current = bySZ;
        amenityStatsByPAAllRef.current = byPA; // overall (frozen)
        amenityStatsBySZAllRef.current = bySZ;

        // flood counts & breakdowns (overall + live)
        const { by_pa, by_sz } = computeFloodCounts(floodData);
        floodByPaOverallRef.current = by_pa;
        floodByPaRef.current = by_pa; // live
        floodBySzRef.current = by_sz;

        const { byPa: floodCatsPa, bySz: floodCatsSz } = computeFloodBreakdowns(floodData);
        floodCatsByPARef.current = floodCatsPa; // live
        floodCatsBySZRef.current = floodCatsSz;
        floodCatsByPAOverallRef.current = floodCatsPa; // overall (frozen)
        floodCatsBySZOverallRef.current = floodCatsSz;

        /* collect planning areas + id map */
        const paNames = [];
        const featureMap = {};
        const idMap = {};
        for (const feature of planningData.features ?? []) {
          const name = feature?.properties?.PLN_AREA_N?.trim();
          if (!name) continue;
          paNames.push(name);
          featureMap[name] = feature;
          const paId = feature?.properties?.PA_ID;
          if (paId != null) idMap[name] = String(paId);
        }
        planningAreaFeatureRef.current = featureMap;
        planningAreaIdRef.current = idMap;
        paIdToNameRef.current = Object.fromEntries(Object.entries(idMap).map(([k, v]) => [v, k]));
        if (paNames.length) onPlanningAreasLoaded?.(paNames);
        paNamesRef.current = paNames;

        /* subzone -> PA map */
        const szToPA = new Map();
        for (const f of subzoneData.features ?? []) {
          const sz = (f?.properties?.SUBZONE_N ?? "").toString().trim();
          const pa = (f?.properties?.PLN_AREA_N ?? "").toString().trim();
          if (!sz || !pa) continue;
          if (!szToPA.has(sz)) szToPA.set(sz, new Set());
          szToPA.get(sz).add(pa);
        }
        subzoneToPARef.current = szToPA;

        /* sources */
        map.addSource(PLANNING_SOURCE_ID, { type: "geojson", data: planningData, generateId: true });
        map.addSource(SUBZONE_SOURCE_ID, { type: "geojson", data: subzoneData, generateId: true });
        map.addSource(ROAD_SOURCE_ID, { type: "geojson", data: roadData, generateId: true }); // generateId for safety
        map.addSource(AMENITY_SOURCE_ID, { type: "geojson", data: amenityData, generateId: true });
        map.addSource(FLOOD_SOURCE_ID, { type: "geojson", data: floodData, generateId: true });

        const derivedFloodTypes =
          floodTypes && floodTypes.length
            ? floodTypes
            : Array.from(
                new Set(
                  (floodData.features ?? [])
                    .map((f) => (f.properties?.event ?? f.properties?.flood_type ?? "").toString().trim())
                    .filter(Boolean)
                )
              ).sort();

        await loadFloodIcons(map, derivedFloodTypes);

        /* base layers */
        map.addLayer({
          id: PLANNING_FILL_LAYER_ID,
          type: "fill",
          source: PLANNING_SOURCE_ID,
          paint: { "fill-color": DEFAULT_PLANNING_COLOR, "fill-opacity": 0.75 },
        });
        map.addLayer({
          id: PLANNING_OUTLINE_LAYER_ID,
          type: "line",
          source: PLANNING_SOURCE_ID,
          paint: { "line-color": "#1d4ed8", "line-width": 1.25, "line-opacity": 0.4 },
        });
        map.addLayer({
          id: PLANNING_HIGHLIGHT_LAYER_ID,
          type: "line",
          source: PLANNING_SOURCE_ID,
          paint: { "line-color": "#f97316", "line-width": 3, "line-opacity": 0.9 },
          filter: EMPTY_PLANNING_FILTER,
        });

        map.addLayer({
          id: SUBZONE_FILL_LAYER_ID,
          type: "fill",
          source: SUBZONE_SOURCE_ID,
          layout: { visibility: "none" },
          paint: { "fill-color": DEFAULT_SUBZONE_COLOR, "fill-opacity": 0.55 },
        });
        map.addLayer({
          id: SUBZONE_OUTLINE_LAYER_ID,
          type: "line",
          source: SUBZONE_SOURCE_ID,
          layout: { visibility: "none" },
          paint: { "line-color": "#1d4ed8", "line-width": 0.8, "line-opacity": 0.7 },
        });
        map.addLayer({
          id: SUBZONE_HIGHLIGHT_LAYER_ID,
          type: "line",
          source: SUBZONE_SOURCE_ID,
          layout: { visibility: "none" },
          paint: { "line-color": "#fbbf24", "line-width": 3, "line-opacity": 0.9 },
          filter: EMPTY_SUBZONE_HIGHLIGHT,
        });

        map.addLayer({
          id: ROAD_LAYER_ID,
          type: "line",
          source: ROAD_SOURCE_ID,
          layout: { visibility: "none" },
          paint: { "line-color": "#f97316", "line-width": DEFAULT_ROAD_WIDTH, "line-opacity": 0.95 },
          filter: EMPTY_PA_FILTER,
        });

        /* amenities as SYMBOL icons (hidden by default) */
        const derivedAmenityCats =
          amenityTypes && amenityTypes.length
            ? amenityTypes
            : Array.from(
                new Set(
                  (amenityData.features ?? [])
                    .map((f) => (f.properties?.amenity_category ?? "").toString().trim())
                    .filter(Boolean)
                )
              ).sort();

        await loadAmenityIcons(map, derivedAmenityCats);

        map.addLayer({
          id: AMENITY_ICON_LAYER_ID,
          type: "symbol",
          source: AMENITY_SOURCE_ID,
          layout: {
            visibility: "none",
            "icon-image": (() => {
              const expr = ["match", ["to-string", ["get", "amenity_category"]]];
              for (const c of derivedAmenityCats) expr.push(c, amenityIconId(c));
              expr.push(AMENITY_ICON_DEFAULT_ID);
              return expr;
            })(),
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-anchor": "bottom",
            "icon-size": 0.125,
          },
        });

        map.addLayer({
          id: FLOOD_LAYER_ID,
          type: "symbol",
          source: FLOOD_SOURCE_ID,
          layout: {
            visibility: "visible",
            "icon-image": buildFloodIconExpression(derivedFloodTypes),
            "icon-size": 0.125,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-anchor": "bottom",
          },
        });

        /* hover outlines */
        map.addLayer({
          id: PA_HOVER_OUTLINE_ID,
          type: "line",
          source: PLANNING_SOURCE_ID,
          paint: {
            "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ffffff", "rgba(0,0,0,0)"],
            "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 5, 0],
            "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
          },
        });
        map.addLayer({
          id: PA_HOVER_OUTLINE_INNER_ID,
          type: "line",
          source: PLANNING_SOURCE_ID,
          paint: {
            "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#60a5fa", "rgba(0,0,0,0)"],
            "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 0],
            "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
          },
        });
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
        });

        /* cursors */
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

        /* clicks on polygons */
        map.on("click", PLANNING_FILL_LAYER_ID, (event) => {
          const feature = event.features?.[0];
          const name = feature?.properties?.PLN_AREA_N?.trim();
          if (!name) return;
          const fullFeature = planningAreaFeatureRef.current[name] || feature;
          const bounds = computeFeatureBounds(fullFeature.geometry);
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
          const payload = {
            properties,
            lngLat: [event.lngLat.lng, event.lngLat.lat],
            id: properties.SZ_ID ?? feature?.id ?? null,
          };
          map.flyTo({
            center: event.lngLat,
            zoom: Math.max(map.getZoom(), 12),
            essential: true,
            speed: 0.9,
            curve: 1.2,
          });
          onSubzoneSelect?.(payload);
          setActiveSubzoneName((properties.SUBZONE_N ?? "").toString().trim());
          setShowAmenities(true);
        });

        map.on("click", handleBackgroundClick);

        /* ===== HOVERS (React popups for polygons) ===== */
        map.on("mousemove", PLANNING_FILL_LAYER_ID, (e) => {
          const f = e.features?.[0];
          if (!f) return;

          const id = f.id;
          if (hoveredPlanningIdRef.current !== null && hoveredPlanningIdRef.current !== id) {
            map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false });
          }
          hoveredPlanningIdRef.current = id;
          map.setFeatureState({ source: PLANNING_SOURCE_ID, id }, { hover: true });

          const area = (f.properties?.PLN_AREA_N ?? "").toString().trim();

          const floodOverall = floodCatsByPAOverallRef.current?.[area] || { total: 0, by_category: {} };
          const amenOverall = amenityStatsByPAAllRef.current?.[area] || { total: 0, by_category: {} };

          const { paRank: floodRank, paOf: floodOf } = (function () {
            const rows = (paNamesRef.current || []).map((k) => ({
              k,
              v: Number((floodByPaOverallRef.current || {})[k] || 0),
            }));
            rows.sort((a, b) => b.v - a.v);
            const idx = rows.findIndex((x) => x.k === area);
            return { paRank: idx >= 0 ? idx + 1 : rows.length || 1, paOf: rows.length || 1 };
          })();

          const { paRank: amenRank, paOf: amenOf } = (function () {
            const totals = Object.fromEntries(
              Object.entries(amenityStatsByPAAllRef.current || {}).map(([k, obj]) => [k, Number(obj?.total || 0)])
            );
            const rows = (paNamesRef.current || []).map((k) => ({ k, v: Number(totals[k] || 0) }));
            rows.sort((a, b) => b.v - a.v);
            const idx = rows.findIndex((x) => x.k === area);
            return { paRank: idx >= 0 ? idx + 1 : rows.length || 1, paOf: rows.length || 1 };
          })();

          const header = [
            { label: "PLANNING AREA", value: (area || "unknown").toUpperCase() },
            { label: "Flood rank", value: `#${floodRank} of ${floodOf}` },
            { label: "Amenities rank", value: `#${amenRank} of ${amenOf}` },
          ];

          showHoverPopupReact(
            map,
            e.lngLat,
            <PopupContent
              header={header}
              floods={{ total: floodOverall.total, byCategory: floodOverall.by_category }}
              amenities={{ total: amenOverall.total, byCategory: amenOverall.by_category }}
              mode="planning"
            />
          );
        });

        map.on("mouseleave", PLANNING_FILL_LAYER_ID, () => {
          if (hoveredPlanningIdRef.current !== null) {
            map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false });
            hoveredPlanningIdRef.current = null;
          }
          clearHoverPopupReact();
        });

        // SUBZONE HOVER (React)
        map.on("mousemove", SUBZONE_FILL_LAYER_ID, (e) => {
          const f = e.features?.[0];
          if (!f) return;

          const id = f.id;
          if (hoveredSubzoneIdRef.current !== null && hoveredSubzoneIdRef.current !== id) {
            map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false });
          }
          hoveredSubzoneIdRef.current = id;
          map.setFeatureState({ source: SUBZONE_SOURCE_ID, id }, { hover: true });

          const props = f.properties || {};
          const sub = (props.SUBZONE_N ?? "").toString().trim();
          const area = (props.PLN_AREA_N ?? "").toString().trim();

          const floodSZOverall = floodCatsBySZOverallRef.current?.[sub] || { total: 0, by_category: {} };
          const amenSZOverall = amenityStatsBySZAllRef.current?.[sub] || { total: 0, by_category: {} };

          const getSubzoneFloodRankWithinPA = (targetSub, pa) => {
            const rows = [];
            for (const [sz, v] of Object.entries(floodBySzRef.current || {})) {
              const set = subzoneToPARef.current.get(sz);
              if (set && set.has(pa)) rows.push({ sz, v: Number(v || 0) });
            }
            rows.sort((a, b) => b.v - a.v);
            const szOf = rows.length || 1;
            const idx = rows.findIndex((x) => x.sz === targetSub);
            return { szRank: idx >= 0 ? idx + 1 : szOf, szOf };
          };
          const getSubzoneAmenityRankWithinPA = (targetSub, pa) => {
            const rows = [];
            for (const [sz, obj] of Object.entries(amenityStatsBySZAllRef.current || {})) {
              const set = subzoneToPARef.current.get(sz);
              if (set && set.has(pa)) rows.push({ sz, v: Number(obj?.total || 0) });
            }
            rows.sort((a, b) => b.v - a.v);
            const szOf = rows.length || 1;
            const idx = rows.findIndex((x) => x.sz === targetSub);
            return { szRank: idx >= 0 ? idx + 1 : szOf, szOf };
          };

          const { szRank: floodRankInPA, szOf: floodOfInPA } = getSubzoneFloodRankWithinPA(sub, area);
          const { szRank: amenRankInPA, szOf: amenOfInPA } = getSubzoneAmenityRankWithinPA(sub, area);

          const allSZFlood = floodBySzRef.current || {};
          const floodGlobalRows = Object.entries(allSZFlood)
            .map(([k, v]) => ({ k, v: Number(v || 0) }))
            .sort((a, b) => b.v - a.v);
          const floodGlobalOf = floodGlobalRows.length || 1;
          const floodGlobalRank = Math.max(1, floodGlobalRows.findIndex((x) => x.k === sub) + 1);

          const allSZAmen = amenityStatsBySZAllRef.current || {};
          const amenGlobalRows = Object.entries(allSZAmen)
            .map(([k, obj]) => ({ k, v: Number(obj?.total || 0) }))
            .sort((a, b) => b.v - a.v);
          const amenGlobalOf = amenGlobalRows.length || 1;
          const amenGlobalRank = Math.max(1, amenGlobalRows.findIndex((x) => x.k === sub) + 1);

          const header = [
            { label: "SUBZONE", value: (sub || "unknown").toUpperCase() },
            { label: "planning area", value: area || "-" },
            { label: "Flood rank (within PA)", value: `#${floodRankInPA} of ${floodOfInPA}` },
            { label: "Flood rank (all subzones)", value: `#${floodGlobalRank} of ${floodGlobalOf}` },
            { label: "Amenities rank (within PA)", value: `#${amenRankInPA} of ${amenOfInPA}` },
            { label: "Amenities rank (all subzones)", value: `#${amenGlobalRank} of ${amenGlobalOf}` },
          ];

          showHoverPopupReact(
            map,
            e.lngLat,
            <PopupContent
              header={header}
              floods={{ total: floodSZOverall.total, byCategory: floodSZOverall.by_category }}
              amenities={{ total: amenSZOverall.total, byCategory: amenSZOverall.by_category }}
              mode="subzone"
            />
          );
        });

        map.on("mouseleave", SUBZONE_FILL_LAYER_ID, () => {
          if (hoveredSubzoneIdRef.current !== null) {
            map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false });
            hoveredSubzoneIdRef.current = null;
          }
          clearHoverPopupReact();
        });

        // Amenity hover (HTML, nicer)
        map.on("mousemove", AMENITY_ICON_LAYER_ID, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const html = buildNiceAmenityHtml(f.properties || {});
          showHoverPopup(map, e.lngLat, html);
        });
        map.on("mouseleave", AMENITY_ICON_LAYER_ID, () => {
          clearHoverPopup();
        });

        // Road hover (HTML) — show plain counts of nearby amenities & floods
        map.on("mousemove", ROAD_LAYER_ID, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const html = buildRoadHoverHtml(
            f.properties || {},
            roadAmenityCountRef.current,
            roadFloodCountRef.current
          );
          showHoverPopup(map, e.lngLat, html);
        });
        map.on("mouseleave", ROAD_LAYER_ID, () => {
          clearHoverPopup();
        });

        // Flood hover ONLY (HTML) — auto-destroys on mouseleave (no click)
        map.on("mousemove", FLOOD_LAYER_ID, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const html = buildNiceFloodHtml(f.properties || {});
          showHoverPopup(map, e.lngLat, html);
        });
        map.on("mouseleave", FLOOD_LAYER_ID, () => {
          clearHoverPopup();
        });
        // intentionally no: map.on("click", FLOOD_LAYER_ID, ...)

        // Precompute per-road counts from your schemas
        const amenCounts = computeRoadAmenityCounts(amenityData);
        const floodCounts = computeRoadFloodCounts(floodData);
        roadAmenityCountRef.current = amenCounts;
        roadFloodCountRef.current = floodCounts;

        // Combine into a weight map (amenities weighted 0.5, floods 1.0) for line width
        const w = {};
        const keys = new Set([...Object.keys(amenCounts), ...Object.keys(floodCounts), ...Object.keys(roadCountMap || {})]);
        keys.forEach((k) => {
          const base = Number((roadCountMap || {})[k] || 0);
          const a = Number(amenCounts[k] || 0);
          const f = Number(floodCounts[k] || 0);
          w[k] = base + f * 1.0 + a * 0.5;
        });
        roadWeightMapRef.current = w;
        roadWeightMaxRef.current = Math.max(1, ...Object.values(w), maxRoadCount || 1);

        map.on("moveend", recomputeVisibleFloods);
        map.on("idle", recomputeVisibleFloods);

        setError(null);
        hasLoadedRef.current = true;
      } catch (err) {
        console.error(err);
        setError("unable to initialise map.");
      }
    };

    map.on("load", handleLoad);
    map.on("error", (evt) => {
      console.error("mapbox gl error:", evt?.error);
      setError("the map failed to load. check your token or network connection.");
    });

    return () => {
      map.off("click", handleBackgroundClick);
      try {
        if (hoveredPlanningIdRef.current !== null)
          map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false });
        if (hoveredSubzoneIdRef.current !== null)
          map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false });
      } catch {}
      clearHoverPopupReact();
      clearHoverPopup();
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      hasLoadedRef.current = false;
      try {
        if (map && map.remove) map.remove();
      } catch {}
      mapRef.current = null;
    };
  }, [
    planningData,
    subzoneData,
    roadData,
    amenityData,
    floodData,
    amenityTypes,
    floodTypes,
    onPlanningAreaToggle,
    onPlanningAreasLoaded,
    onSubzoneSelect,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current) return;

    // resize now…
    map.resize();

    // …and once again on the next paint (helps right after CSS transitions)
    requestAnimationFrame(() => {
      try { map.resize(); } catch {}
    });
  }, [resizeSignal]);

  /* amenity aggregates update when filters change */
  useEffect(() => {
    if (!amenityData) return;
    const categorySet = new Set(amenityCategoryFilter);
    const typeSet = new Set(amenityTypeFilter);
    const features =
      (amenityData.features || []).filter((feature) => {
        const props = feature?.properties || {};
        if (categorySet.size) {
          const category = normaliseString(props?.amenity_category);
          if (!categorySet.has(category)) return false;
        }
        if (typeSet.size) {
          const type = normaliseString(props?.amenity_type);
          if (!typeSet.has(type)) return false;
        }
        return true;
      }) || [];
    const filtered = { type: "FeatureCollection", features };
    const { byPA, bySZ } = aggregateAmenityStats(filtered);
    amenityStatsByPARef.current = byPA;
    amenityStatsBySZRef.current = bySZ;
  }, [amenityData, amenityCategoryFilter, amenityTypeFilter]);

  /* flood aggregates update when filters change */
  useEffect(() => {
    if (!floodData) return;
    const planningSet = new Set((selectedPlanningAreas || []).map((name) => normaliseString(name)));
    const typeSet = new Set(floodTypeFilterLowerList);
    const fromDateRaw = floodDateFrom ? new Date(floodDateFrom) : null;
       const toDateRaw = floodDateTo ? new Date(floodDateTo) : null;
    const fromDate = fromDateRaw && !Number.isNaN(fromDateRaw.getTime()) ? fromDateRaw : null;
    const toDate = toDateRaw && !Number.isNaN(toDateRaw.getTime()) ? toDateRaw : null;

    const features = (floodData.features || []).filter((feature) => {
      const props = feature?.properties || {};
      if (planningSet.size) {
        const planningArea = getPlanningArea(props);
        if (!planningSet.has(planningArea)) return false;
      }
      if (typeSet.size) {
        const type = getFloodType(props);
        if (!typeSet.has(type)) return false;
      }
      if ((fromDate || toDate) && !isWithinDateRange(getEventDate(props), fromDate, toDate)) {
        return false;
      }
      return true;
    });

    const filteredFc = { type: "FeatureCollection", features };
    const { by_pa, by_sz } = computeFloodCounts(filteredFc);
    floodByPaRef.current = by_pa;
    floodBySzRef.current = by_sz;

    const { byPa, bySz } = computeFloodBreakdowns(filteredFc);
    floodCatsByPARef.current = byPa;
    floodCatsBySZRef.current = bySz;
  }, [floodData, selectedPlanningAreas, floodTypeFilterLowerList, floodDateFrom, floodDateTo]);

  /* layer filters & visibility toggles */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current) return;
    if (!hasLayer(map, SUBZONE_FILL_LAYER_ID) || !hasLayer(map, ROAD_LAYER_ID) || !hasLayer(map, PLANNING_HIGHLIGHT_LAYER_ID)) {
      return;
    }

    const hasSelectionLocal = selectedPlanningAreas?.length > 0;

    const subzoneFilterExpr = buildMatchFilter("PLN_AREA_N", selectedPlanningAreas);
    map.setFilter(SUBZONE_FILL_LAYER_ID, subzoneFilterExpr);
    map.setFilter(SUBZONE_OUTLINE_LAYER_ID, subzoneFilterExpr);
    map.setFilter(PLANNING_HIGHLIGHT_LAYER_ID, hasSelectionLocal ? subzoneFilterExpr : EMPTY_PLANNING_FILTER);

    const paIds = (selectedPlanningAreas || []).map((name) => planningAreaIdRef.current[name]).filter(Boolean);
    const roadPAFilter = buildMatchFilter("PA_ID", paIds);
    map.setFilter(ROAD_LAYER_ID, roadPAFilter);
    map.setLayoutProperty(ROAD_LAYER_ID, "visibility", hasSelectionLocal && paIds.length > 0 ? "visible" : "none");

    const subzoneVisible = viewMode === "subzone" && hasSelectionLocal ? "visible" : "none";
    map.setLayoutProperty(SUBZONE_FILL_LAYER_ID, "visibility", subzoneVisible);
    map.setLayoutProperty(SUBZONE_OUTLINE_LAYER_ID, "visibility", subzoneVisible);
    map.setLayoutProperty(SUBZONE_HIGHLIGHT_LAYER_ID, "visibility", subzoneVisible);
    if (hasLayer(map, SZ_HOVER_OUTLINE_ID)) {
      map.setLayoutProperty(SZ_HOVER_OUTLINE_ID, "visibility", subzoneVisible);
    }

    // AMENITY MARKERS — local toggle/lists
    if (map.getLayer(AMENITY_ICON_LAYER_ID)) {
      const subzoneName =
        (selectedSubzone?.properties?.SUBZONE_N ?? "").toString().trim() || (activeSubzoneName ?? "");

      const amenityClauses = ["all"];

      // PA constraint
      if (hasSelectionLocal) {
        amenityClauses.push(buildMatchFilter("planning_area", selectedPlanningAreas));
      }

      // Subzone constraint
      if (subzoneName) {
        amenityClauses.push(["==", ["to-string", ["coalesce", ["get", "subzone"], ""]], subzoneName]);
      }

      // Category filter from parent (selectedAmenityCategories)
      if (amenityCategoryFilter.length) {
        amenityClauses.push([
          "in",
          ["to-string", ["coalesce", ["get", "amenity_category"], ""]],
          ["literal", amenityCategoryFilter],
        ]);
      }

      // Type filter from LeftPanel (still respected)
      if (amenityTypeFilter.length) {
        amenityClauses.push([
          "in",
          ["to-string", ["coalesce", ["get", "amenity_type"], ""]],
          ["literal", amenityTypeFilter],
        ]);
      }

      // ✅ Local DISPLAY filter by CATEGORY (replaces the old "display types" filter)
      if (displayAmenityCategoriesNorm.length) {
        amenityClauses.push([
          "in",
          ["to-string", ["coalesce", ["get", "amenity_category"], ""]],
          ["literal", displayAmenityCategoriesNorm],
        ]);
      }

      map.setFilter(AMENITY_ICON_LAYER_ID, amenityClauses);
      map.setLayoutProperty(
        AMENITY_ICON_LAYER_ID,
        "visibility",
        showAmenities && displayAmenityCategoriesNorm.length ? "visible" : "none"
      );
    }

    // FLOOD MARKERS — local toggle/lists
    if (map.getLayer(FLOOD_LAYER_ID)) {
      const floodClauses = ["all"];
      if (hasSelectionLocal) {
        floodClauses.push(buildMatchFilter("planning_area", selectedPlanningAreas));
      }
      if (displayFloodTypesLowerList.length) {
        floodClauses.push([
          "in",
          ["downcase", ["to-string", ["coalesce", ["get", "event"], ["get", "flood_type"], ""]]],
          ["literal", displayFloodTypesLowerList],
        ]);
      }
      if (floodDateFrom || floodDateTo) {
        const buildDateExpr = () => ["to-string", ["coalesce", ["get", "event_date"], ["get", "date"], ""]];
        floodClauses.push(["!=", buildDateExpr(), ""]);
        if (floodDateFrom) floodClauses.push([">=", buildDateExpr(), floodDateFrom]);
        if (floodDateTo) floodClauses.push(["<=", buildDateExpr(), floodDateTo]);
      }
      map.setFilter(FLOOD_LAYER_ID, floodClauses);
      map.setLayoutProperty(
        FLOOD_LAYER_ID,
        "visibility",
        showFloods && displayFloodTypesLowerList.length ? "visible" : "none"
      );
    }

    const onceIdle = () => recomputeVisibleFloods();
    map.once("idle", onceIdle);
    recomputeVisibleFloods();

    if (!hasSelectionLocal && lastHadSelectionRef.current) {
      setViewMode("planning");
      setShowAmenities?.(false);
      setActiveSubzoneName(null);
      clearHoverPopupReact();
      clearHoverPopup();
      map.easeTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 800 });
    }
    lastHadSelectionRef.current = hasSelectionLocal;

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
      try {
        map.off("idle", onceIdle);
      } catch {}
    };
  }, [
    selectedPlanningAreas,
    selectedSubzone,
    activeSubzoneName,
    viewMode,
    showAmenities,
    showFloods,
    displayAmenityCategoriesNorm,
    displayFloodTypesLowerList,
    floodDateFrom,
    floodDateTo,
    floodStats,
  ]);

  useEffect(() => {
    recomputeVisibleFloods();
  }, [resizeSignal]);

  /* choropleths & road width */
  const getPlanningColoring = () => {
    if (colorMetric === "amenities") {
      const mapm = amenityStatsByPARef.current || {};
      const countMap = Object.fromEntries(Object.entries(mapm).map(([k, v]) => [k, v.total || 0]));
      const maxCount = Math.max(1, ...Object.values(countMap), 1);
      return { countMap, maxCount };
    }
    const countMap = floodByPaRef.current || {};
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
    if (!map || !hasLoadedRef.current || !hasLayer(map, PLANNING_FILL_LAYER_ID)) return;

    // planning choropleth
    const { countMap: paCounts, maxCount: paMax } = getPlanningColoring();
    const planningExpr = buildChoroplethExpression(
      "PLN_AREA_N",
      paCounts,
      paMax,
      PLANNING_COLORS,
      DEFAULT_PLANNING_COLOR
    );
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
    if (hasLayer(map, SUBZONE_FILL_LAYER_ID)) {
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

    // roads width — use combined weight map (floods + amenities) with thicker max
    if (map.getLayer(ROAD_LAYER_ID)) {
      const weightMap = Object.keys(roadWeightMapRef.current).length ? roadWeightMapRef.current : roadCountMap ?? {};
      const maxW = roadWeightMaxRef.current || maxRoadCount || 1;
      const roadWidthExpression =
        selectedPlanningAreas.length > 0
          ? buildLineWidthExpression(
              ["coalesce", ["get", "RN_ID"], ["get", "rn_id"], ["get", "RD_NAME"]],
              weightMap,
              maxW,
              2,   // min width
              8,   // max width (thicker)
              DEFAULT_ROAD_WIDTH
            )
          : DEFAULT_ROAD_WIDTH;
      map.setPaintProperty(ROAD_LAYER_ID, "line-width", roadWidthExpression);
    }
  }, [
    selectedPlanningAreas,
    viewMode,
    colorMetric,
    floodStats,
  ]);

  /* legend */
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
    <div className="relative w-full h-[95dvh]">
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

      {/* controls (now capped to map height) */}
      {panelOpen && (
        <div className="pointer-events-none absolute right-3 top-12 sm:right-4 sm:top-14 flex flex-col items-end gap-3 max-h-[85vh]">
          <div className="pointer-events-auto rounded-xl bg-slate-900/90 border border-white/10 shadow-lg p-3 text-xs text-slate-200 w-[300px] max-h-[85vh] overflow-y-auto">
            <div className="font-semibold text-slate-100 mb-2">display</div>

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

            <label className="inline-flex items-center gap-2 mt-1">
              <input type="checkbox" checked={showFloods} onChange={(e) => setShowFloods(e.target.checked)} />
              <span>show flood markers</span>
            </label>

            {showFloods ? (
              <div className="mt-2">
                <div className="mb-1 text-[11px] text-slate-300">flood types (from “event”)</div>
                <div className="flex gap-2 mb-2">
                  <button
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                    onClick={handleFloodTypesSelectAll}
                    type="button"
                  >
                    select all
                  </button>
                  <button
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                    onClick={handleFloodTypesClear}
                    type="button"
                  >
                    clear
                  </button>
                </div>
                <div className="max-h-40 overflow-auto pr-1 space-y-1">
                  {floodTypes.map((t) => {
                    const normalized = normaliseString(t);
                    const checked = displayFloodTypes.includes(normalized);
                    return (
                      <label key={t} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => handleFloodTypeDisplayToggle(t, e.target.checked)}
                        />
                        <span className="truncate">{t}</span>
                      </label>
                    );
                  })}
                </div>
                {displayFloodTypes.length === 0 && (
                  <div className="mt-1 text-[11px] text-amber-300/80">none selected — markers hidden</div>
                )}
              </div>
            ) : null}

            <label className="inline-flex items-center gap-2 mt-3">
              <input type="checkbox" checked={showAmenities} onChange={(e) => setShowAmenities(e.target.checked)} />
              <span>
                Show amenities
              </span>
            </label>

            {showAmenities ? (
              <div className="mt-2">
                <div className="mb-1 text-[11px] text-slate-300">amenity categories</div>
                <div className="flex gap-2 mb-2">
                  <button
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                    onClick={() => setDisplayAmenityCategories(availableAmenityCategories)}
                    type="button"
                    disabled={!availableAmenityCategories.length}
                  >
                    select all
                  </button>
                  <button
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                    onClick={() => setDisplayAmenityCategories([])}
                    type="button"
                    disabled={!displayAmenityCategories.length}
                  >
                    clear
                  </button>
                </div>

                <div className="max-h-40 overflow-auto pr-1 space-y-1">
                  {availableAmenityCategories.map((cat) => {
                    const normalized = normaliseString(cat);
                    const checked = displayAmenityCategories.includes(normalized);
                    return (
                      <label key={cat} className="flex items-center gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const shouldEnable = e.target.checked;
                            setDisplayAmenityCategories((prev) => {
                              const next = new Set(prev);
                              if (shouldEnable) next.add(cat);
                              else next.delete(cat);
                              return Array.from(next);
                            });
                          }}
                        />
                        <span className="truncate">{cat}</span>
                      </label>
                    );
                  })}
                </div>

                {!availableAmenityCategories.length && (
                  <div className="mt-1 text-[11px] text-amber-300/80">
                    no amenity categories in the selected scope/filters.
                  </div>
                )}
                {availableAmenityCategories.length > 0 && displayAmenityCategories.length === 0 && (
                  <div className="mt-1 text-[11px] text-amber-300/80">none selected — markers hidden</div>
                )}
              </div>
            ) : null}
            {viewMode === "planning" && (
              <div className="mt-2 text:[11px] text-slate-400">click a planning area to drill into subzones.</div>
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
              <span className="text-slate-500">/</span>
              <span className="text-slate-100 font-semibold">{legendMax}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full border border-white" style={{ backgroundColor: "#38bdf8" }} />
            <span className="text-slate-300">flood event</span>
          </div>
        </div>
      </div>

      {blockingError && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900/70 p-6 text-white">
          <div className="w-full max-w-sm rounded-xl bg-slate-900/90 p-5 text-center shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">map unavailable</p>
            <p className="mt-2 text-sm text-slate-100">{blockingError}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default SingaporeHistoricalFloodMap;
