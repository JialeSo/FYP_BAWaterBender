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

/* PA flood bubbles (planning-level aggregation) */
const PA_FLOOD_SOURCE_ID = "pa-flood-bubbles-source";
const PA_FLOOD_BUBBLE_LAYER_ID = "pa-flood-bubbles";
const PA_FLOOD_COUNT_LAYER_ID = "pa-flood-counts";

/* Flood inside PA (stacked by exact/snap coordinates) */
const FLOOD_STACKED_SOURCE_ID = "flood-stacked";
const FLOOD_STACK_BUBBLE_LAYER_ID = "flood-stack-bubbles";
const FLOOD_STACK_COUNT_LAYER_ID = "flood-stack-counts";
const FLOOD_SINGLE_LAYER_ID = "flood-single";

/* Spiderfy */
const FLOOD_SPIDER_SOURCE_ID = "flood-spider-source";
const FLOOD_SPIDER_EDGES_SOURCE_ID = "flood-spider-edges-source";
const FLOOD_SPIDER_EDGES_LAYER_ID = "flood-spider-edges";
const FLOOD_SPIDER_POINTS_LAYER_ID = "flood-spider-points";

/* hover outlines */
const PA_HOVER_OUTLINE_ID = "planning-area-hover-outline";
const PA_HOVER_OUTLINE_INNER_ID = "planning-area-hover-outline-inner";
const SZ_HOVER_OUTLINE_ID = "subzone-hover-outline";

/* filters / styling constants */
const EMPTY_PA_FILTER = ["==", ["get", "PA_ID"], "__none__"];
const EMPTY_SUBZONE_HIGHLIGHT = ["==", ["get", "SZ_ID"], "__none__"];

const PLANNING_COLORS = ["#e0f2fe", "#bae6fd", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8"];
const SUBZONE_COLORS = ["#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626"];
const DEFAULT_PLANNING_COLOR = "#e2e8f0";
const DEFAULT_SUBZONE_COLOR = "rgba(37, 99, 235, 0.18)";
const DEFAULT_ROAD_WIDTH = 2.0;
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
const floodSlug = (s) => (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
const floodIconId = (type) => `flood_${floodSlug(type)}`;
const floodIconUrl = (type) => `/map/markers/${floodSlug(type)}.png`;
const FLOOD_ICON_DEFAULT_ID = "flood_default";
const FLOOD_ICON_DEFAULT_URL = "/map/markers/default.png";

const buildFloodIconExpression = (types) => {
  const safe = (types || []).map((t) => String(t).trim()).filter(Boolean);
  if (safe.length === 0) return FLOOD_ICON_DEFAULT_ID;
  return [
    "match",
    ["downcase", ["to-string", ["coalesce", ["get", "event"], ["get", "flood_type"], ""]]],
    ...safe.flatMap((t) => [t.toLowerCase(), floodIconId(t)]),
    FLOOD_ICON_DEFAULT_ID,
  ];
};

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

/* ===== helpers for reading props safely ===== */
const S = (v) => (v == null ? "" : String(v).trim());
const lower = (v) => S(v).toLowerCase();
const getFloodType = (props) => lower(props?.event ?? props?.flood_type ?? "");
const getEventDate = (props) => S(props?.event_date ?? props?.date ?? "");

/* prefer ids for PA / SZ / Road on flood points (with safe fallbacks) */
const getFloodPlanningId = (p, nameToIdMap) =>
  S(p.pa_id ?? p.start_planning_area_id ?? p.end_planning_area_id ?? nameToIdMap[S(p.planning_area ?? p.PLN_AREA_N)] ?? "");
const getFloodSubzoneId = (p, nameToIdMap) =>
  S(p.sz_id ?? p.start_subzone_id ?? p.end_subzone_id ?? nameToIdMap[S(p.subzone ?? p.SUBZONE_N)] ?? "");
const getFloodRoadId = (p) =>
  S(p.rn_id ?? p.start_street_id ?? p.end_street_id ?? p.RN_ID ?? p.UNIQUE_ID ?? p.nearest_road_1_rn_id ?? p.nearest_road_1_id);

/* date range helper */
const isWithinDateRange = (value, fromDate, toDate) => {
  if (!fromDate && !toDate) return true;
  if (!value) return false;
  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) return false;
  if (fromDate && candidate < fromDate) return false;
  if (toDate && candidate > toDate) return false;
  return true;
};

/* ===== pretty hover builders ===== */
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
  const rnId = S(props?.RN_ID ?? props?.rn_id ?? props?.rd_id);
  const name = S(props?.RD_NAME ?? props?.road_name ?? rnId ?? "unknown road");
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

/* ===== per-road counts ===== */
const inc = (obj, key, by = 1) => {
  const k = S(key);
  if (!k) return;
  obj[k] = (obj[k] ?? 0) + by;
};

const computeRoadAmenityCounts = (fc) => {
  const m = {};
  for (const f of fc?.features ?? []) {
    const p = f.properties || {};
    const key = S(p.nearest_road_1_rn_id) || S(p.rn_id) || S(p.nearest_road_1_id) || S(p.nearest_road_1_name);
    if (!key) continue;
    inc(m, key, 1);
  }
  return m;
};

const computeRoadFloodCounts = (fc) => {
  const m = {};
  for (const f of fc?.features ?? []) {
    const p = f.properties || {};
    const key = getFloodRoadId(p) || S(p.parent_road) || S(p.start_street_name) || S(p.end_street_name);
    if (!key) continue;
    inc(m, key, 1);
  }
  return m;
};

/* ===== flood aggregates by ID ===== */
const computeFloodCountsById = (floodFc, paNameToId, szNameToId) => {
  const by_pa_id = {};
  const by_sz_id = {};
  for (const ft of floodFc?.features ?? []) {
    const p = ft.properties || {};
    const paId = getFloodPlanningId(p, paNameToId);
    const szId = getFloodSubzoneId(p, szNameToId);
    if (paId) inc(by_pa_id, paId, 1);
    if (szId) inc(by_sz_id, szId, 1);
  }
  return { by_pa_id, by_sz_id };
};

const computeFloodBreakdownsById = (floodFc, paNameToId, szNameToId) => {
  const byPaId = {};
  const bySzId = {};
  for (const ft of floodFc?.features ?? []) {
    const p = ft.properties || {};
    const paId = getFloodPlanningId(p, paNameToId);
    const szId = getFloodSubzoneId(p, szNameToId);
    const ev = S(p.event || p.flood_type) || "unspecified";
    if (paId) {
      byPaId[paId] = byPaId[paId] || { total: 0, by_category: {} };
      byPaId[paId].total += 1;
      byPaId[paId].by_category[ev] = (byPaId[paId].by_category[ev] ?? 0) + 1;
    }
    if (szId) {
      bySzId[szId] = bySzId[szId] || { total: 0, by_category: {} };
      bySzId[szId].total += 1;
      bySzId[szId].by_category[ev] = (bySzId[szId].by_category[ev] ?? 0) + 1;
    }
  }
  return { byPaId, bySzId };
};

/* ===== grouping helpers (same-location stacks inside PA) ===== */
const coordKey = (coords) => {
  if (!coords) return "";
  const [lng, lat] = coords;
  const r = (v, n = 5) => Math.round(Number(v) * 10 ** n) / 10 ** n;
  return `${r(lng)},${r(lat)}`;
};

const buildStackedFromFiltered = (filteredFc) => {
  const map = new Map();
  for (const f of filteredFc.features || []) {
    const g = f.geometry;
    if (!g || g.type !== "Point") continue;
    const k = coordKey(g.coordinates);
    if (!map.has(k)) map.set(k, { center: g.coordinates, members: [] });
    map.get(k).members.push(f);
  }
  const stackedFeatures = [];
  for (const [k, group] of map.entries()) {
    const count = group.members.length;
    stackedFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: group.center },
      properties: { stack_key: k, count },
    });
  }
  return {
    stackedFc: { type: "FeatureCollection", features: stackedFeatures },
    stackMap: map,
  };
};

/* ===== PA bubbles helpers ===== */
const boundsCenter = (b) => {
  if (!b) return null;
  const [[minLng, minLat], [maxLng, maxLat]] = b;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
};

/* tiny helpers for map presence */
const hasSrc = (map, id) => !!map.getSource(id);
const hasLayer = (map, id) => !!map.getLayer(id);

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

  /* lookups & refs */
  const planningAreaFeatureRef = useRef({});
  const planningAreaIdRef = useRef({});
  const paIdToNameRef = useRef({});
  const subzoneNameToIdRef = useRef({});
  const szIdToNameRef = useRef({});

  const paNamesRef = useRef([]);
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

  /* flood aggregates (by ID) */
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

  // stacked points memory (inside selected PA view)
  const floodStackMapRef = useRef(new Map());

  // planning-level PA bubble data in source (badge)
  const [visibleFloodCount, setVisibleFloodCount] = useState(0);
  const [error, setError] = useState(null);
  const blockingError = error || dataError || null;

  /* local ui */
  const [activeSubzoneName, setActiveSubzoneName] = useState(null);
  const [viewMode, setViewMode] = useState("planning"); // 'planning' | 'subzone'

  // spiderfy on/off guard
  const spiderActiveRef = useRef(false);

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

    const name = S(selectedSubzone?.properties?.SUBZONE_N);
    if (!name) return;

    const feat = (subzoneData?.features || []).find((f) => S(f?.properties?.SUBZONE_N) === name);
    if (!feat) return;

    const b = computeFeatureBounds(feat.geometry);
    if (b) {
      map.fitBounds(b, { padding: 48, duration: 800, maxZoom: 14 });
      setViewMode("subzone");
      setShowAmenities?.(true);
    }
  }, [selectedSubzone]);

  const [colorMetric, setColorMetric] = useState("floods");
  const [panelOpen, setPanelOpen] = useState(true);

  /* flood filters (display list separate from parent’s selectedFloodTypes) */
  const [displayFloodTypes, setDisplayFloodTypes] = useState(floodTypes || []);
  useEffect(() => {
    if ((floodTypes || []).length) {
      setDisplayFloodTypes((cur) => (cur.length ? cur : floodTypes.map((v) => S(v))));
    }
  }, [floodTypes]);
  const { roadCountMap = {}, maxRoadCount = 0 } = floodStats ?? {};

  // filters from parent
  const amenityCategoryFilter = useMemo(
    () => (selectedAmenityCategories || []).map(S).filter(Boolean),
    [selectedAmenityCategories]
  );
  const amenityTypeFilter = useMemo(
    () => (selectedAmenityTypes || []).map(S).filter(Boolean),
    [selectedAmenityTypes]
  );
  const floodTypeFilter = useMemo(
    () => (selectedFloodTypes || []).map(S).filter(Boolean),
    [selectedFloodTypes]
  );
  const floodTypeFilterLowerList = useMemo(() => floodTypeFilter.map((v) => v.toLowerCase()), [floodTypeFilter]);
  const displayFloodTypesLowerList = useMemo(
    () => (displayFloodTypes || []).map(S).filter(Boolean).map((v) => v.toLowerCase()),
    [displayFloodTypes]
  );

  const globalAmenityCategories = useMemo(() => {
    if ((amenityTypes || []).length) return amenityTypes.map(S).filter(Boolean).sort();
    const cats = new Set();
    for (const f of amenityData?.features ?? []) {
      const c = S(f?.properties?.amenity_category);
      if (c) cats.add(c);
    }
    return Array.from(cats).sort();
  }, [amenityTypes, amenityData]);

  const availableAmenityCategories = useMemo(() => {
    if (!amenityData) return [];
    const paSet = new Set((selectedPlanningAreas || []).map(S).filter(Boolean));
    const typeSet = new Set((selectedAmenityTypes || []).map(S).filter(Boolean));
    const catFilterSet = new Set((selectedAmenityCategories || []).map(S).filter(Boolean));

    const effectiveSubzoneName = S(selectedSubzone?.properties?.SUBZONE_N) || (activeSubzoneName || "");
    const cats = new Set();

    for (const f of amenityData.features || []) {
      const p = f.properties || {};
      const cat = S(p.amenity_category);
      const typ = S(p.amenity_type);
      if (!cat) continue;

      if (catFilterSet.size && !catFilterSet.has(cat)) continue;
      if (typeSet.size && !typeSet.has(typ)) continue;

      if (paSet.size) {
        const pa = S(p.planning_area);
        if (!paSet.has(pa)) continue;
      }
      if (effectiveSubzoneName) {
        const sz = S(p.subzone);
        if (sz !== S(effectiveSubzoneName)) continue;
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

  const [displayAmenityCategories, setDisplayAmenityCategories] = useState([]);
  const displayAmenityCategoriesNorm = useMemo(
    () => (displayAmenityCategories || []).map(S).filter(Boolean),
    [displayAmenityCategories]
  );

  const handleFloodTypesSelectAll = () => setDisplayFloodTypes(floodTypes || []);
  const handleFloodTypesClear = () => setDisplayFloodTypes([]);
  const handleFloodTypeDisplayToggle = (type, shouldEnable) => {
    const normalized = S(type);
    if (!normalized) return;
    setDisplayFloodTypes((prev) => {
      const next = new Set(prev);
      if (shouldEnable) next.add(normalized);
      else next.delete(normalized);
      return Array.from(next);
    });
  };

  const [displayAmenityTypes, setDisplayAmenityTypes] = useState(amenityTypes || []);
  const displayAmenityTypesNorm = useMemo(
    () => (displayAmenityTypes || []).map(S).filter(Boolean),
    [displayAmenityTypes]
  );
  const handleAmenityTypesSelectAll = () => setDisplayAmenityTypes(amenityTypes || []);
  const handleAmenityTypesClear = () => setDisplayAmenityTypes([]);
  const handleAmenityTypeDisplayToggle = (type, shouldEnable) => {
    const normalized = S(type);
    if (!normalized) return;
    setDisplayAmenityTypes((prev) => {
      const next = new Set(prev);
      if (shouldEnable) next.add(normalized);
      else next.delete(normalized);
      return Array.from(next);
    });
  };

  // react popup helpers (hover for polygons)
  const hoverReactRootRef = useRef(null);
  const hoverReactContainerRef = useRef(null);
  const popupCssInjectedRef = useRef(false);

  const loadAmenityIcons = async (map, categories) => {
    if (AMENITY_ICON_DEFAULT_URL && !map.hasImage(AMENITY_ICON_DEFAULT_ID)) {
      try {
        const defImg = await loadImageAsync(map, AMENITY_ICON_DEFAULT_URL);
        map.addImage(AMENITY_ICON_DEFAULT_ID, defImg, { pixelRatio: 2 });
      } catch {}
    }
    await Promise.allSettled(
      (categories || []).map(async (cat) => {
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

  /* ------------- map bootstrap ------------- */
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

    const clearSpiderfy = () => {
      try {
        if (map.getLayer(FLOOD_SPIDER_POINTS_LAYER_ID)) map.removeLayer(FLOOD_SPIDER_POINTS_LAYER_ID);
        if (map.getLayer(FLOOD_SPIDER_EDGES_LAYER_ID)) map.removeLayer(FLOOD_SPIDER_EDGES_LAYER_ID);
        if (map.getSource(FLOOD_SPIDER_SOURCE_ID)) map.removeSource(FLOOD_SPIDER_SOURCE_ID);
        if (map.getSource(FLOOD_SPIDER_EDGES_SOURCE_ID)) map.removeSource(FLOOD_SPIDER_EDGES_SOURCE_ID);
      } catch {}
      spiderActiveRef.current = false;
    };

    const handleBackgroundClick = (event) => {
      if (spiderActiveRef.current) {
        clearSpiderfy();
        return;
      }
      const features = map.queryRenderedFeatures(event.point, {
        layers: [PLANNING_FILL_LAYER_ID, SUBZONE_FILL_LAYER_ID],
      });
      if (!features.length) {
        onPlanningAreaToggle?.(null);
        setViewMode("planning");
        setActiveSubzoneName(null);
        setShowAmenities?.(false);
        clearSpiderfy();
      }
    };

    map.on("click", handleBackgroundClick);
    map.on("load", () => {
      hasLoadedRef.current = true;
      console.info("[map] loaded. waiting for datasets…");
      setError(null);
    });
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
      try { if (map && map.remove) map.remove(); } catch {}
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------- attach sources/layers when data becomes ready ------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current) return;

    const datasetsReady =
      !!planningData && !!subzoneData && !!roadData && !!amenityData && !!floodData &&
      (planningData.features?.length ?? 0) > 0 &&
      (subzoneData.features?.length ?? 0) > 0;

    if (!datasetsReady) {
      console.info("[map] datasets not ready (yet).");
      return;
    }

    // initial PA/SZ lookups (only once)
    if (Object.keys(planningAreaIdRef.current).length === 0) {
      const paNames = [];
      const featureMap = {};
      const paNameToId = {};
      const paIdToName = {};
      for (const feature of planningData.features ?? []) {
        const name = S(feature?.properties?.PLN_AREA_N);
        if (!name) continue;
        paNames.push(name);
        featureMap[name] = feature;
        const paId = feature?.properties?.PA_ID ?? feature?.properties?.pa_id;
        if (paId != null) {
          paNameToId[name] = S(paId);
          paIdToName[S(paId)] = name;
        }
      }
      planningAreaFeatureRef.current = featureMap;
      planningAreaIdRef.current = paNameToId;
      paIdToNameRef.current = paIdToName;
      paNamesRef.current = paNames;
      if (paNames.length) onPlanningAreasLoaded?.(paNames);

      const szNameToId = {};
      const szIdToName = {};
      for (const f of subzoneData.features ?? []) {
        const nm = S(f?.properties?.SUBZONE_N);
        const id = f?.properties?.SZ_ID ?? f?.properties?.sz_id;
        if (!nm || id == null) continue;
        szNameToId[nm] = S(id);
        szIdToName[S(id)] = nm;
      }
      subzoneNameToIdRef.current = szNameToId;
      szIdToNameRef.current = szIdToName;

      /* amenity aggregates (base) */
      const { byPA, bySZ } = aggregateAmenityStats(amenityData);
      amenityStatsByPARef.current = byPA;
      amenityStatsBySZRef.current = bySZ;
      amenityStatsByPAAllRef.current = byPA;
      amenityStatsBySZAllRef.current = bySZ;

      /* subzone -> PA map */
      const szToPA = new Map();
      for (const f of subzoneData.features ?? []) {
        const sz = S(f?.properties?.SUBZONE_N);
        const pa = S(f?.properties?.PLN_AREA_N);
        if (!sz || !pa) continue;
        if (!szToPA.has(sz)) szToPA.set(sz, new Set());
        szToPA.get(sz).add(pa);
      }
      subzoneToPARef.current = szToPA;
    }

    /* 1) sources (create once, update later via setData) */
    if (!hasSrc(map, PLANNING_SOURCE_ID)) map.addSource(PLANNING_SOURCE_ID, { type: "geojson", data: planningData, generateId: true });
    else map.getSource(PLANNING_SOURCE_ID).setData(planningData);

    if (!hasSrc(map, SUBZONE_SOURCE_ID)) map.addSource(SUBZONE_SOURCE_ID, { type: "geojson", data: subzoneData, generateId: true });
    else map.getSource(SUBZONE_SOURCE_ID).setData(subzoneData);

    if (!hasSrc(map, ROAD_SOURCE_ID)) map.addSource(ROAD_SOURCE_ID, { type: "geojson", data: roadData, generateId: true });
    else map.getSource(ROAD_SOURCE_ID).setData(roadData);

    if (!hasSrc(map, AMENITY_SOURCE_ID)) map.addSource(AMENITY_SOURCE_ID, { type: "geojson", data: amenityData, generateId: true });
    else map.getSource(AMENITY_SOURCE_ID).setData(amenityData);

    if (!hasSrc(map, PA_FLOOD_SOURCE_ID)) map.addSource(PA_FLOOD_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    if (!hasSrc(map, FLOOD_STACKED_SOURCE_ID)) map.addSource(FLOOD_STACKED_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

    /* 2) icons */
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
    loadFloodIcons(map, derivedFloodTypes);

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
    loadAmenityIcons(map, derivedAmenityCats);

    /* 3) base layers (idempotent) */
    if (!hasLayer(map, PLANNING_FILL_LAYER_ID)) {
      map.addLayer({
        id: PLANNING_FILL_LAYER_ID,
        type: "fill",
        source: PLANNING_SOURCE_ID,
        paint: { "fill-color": DEFAULT_PLANNING_COLOR, "fill-opacity": 0.75 },
      });
    }
    if (!hasLayer(map, PLANNING_OUTLINE_LAYER_ID)) {
      map.addLayer({
        id: PLANNING_OUTLINE_LAYER_ID,
        type: "line",
        source: PLANNING_SOURCE_ID,
        paint: { "line-color": "#1d4ed8", "line-width": 1.25, "line-opacity": 0.4 },
      });
    }
    if (!hasLayer(map, PLANNING_HIGHLIGHT_LAYER_ID)) {
      map.addLayer({
        id: PLANNING_HIGHLIGHT_LAYER_ID,
        type: "line",
        source: PLANNING_SOURCE_ID,
        paint: { "line-color": "#f97316", "line-width": 3, "line-opacity": 0.9 },
        filter: ["==", ["get", "PLN_AREA_N"], "__none__"],
      });
    }

    if (!hasLayer(map, SUBZONE_FILL_LAYER_ID)) {
      map.addLayer({
        id: SUBZONE_FILL_LAYER_ID,
        type: "fill",
        source: SUBZONE_SOURCE_ID,
        layout: { visibility: "none" },
        paint: { "fill-color": DEFAULT_SUBZONE_COLOR, "fill-opacity": 0.55 },
      });
    }
    if (!hasLayer(map, SUBZONE_OUTLINE_LAYER_ID)) {
      map.addLayer({
        id: SUBZONE_OUTLINE_LAYER_ID,
        type: "line",
        source: SUBZONE_SOURCE_ID,
        layout: { visibility: "none" },
        paint: { "line-color": "#1d4ed8", "line-width": 0.8, "line-opacity": 0.7 },
      });
    }
    if (!hasLayer(map, SUBZONE_HIGHLIGHT_LAYER_ID)) {
      map.addLayer({
        id: SUBZONE_HIGHLIGHT_LAYER_ID,
        type: "line",
        source: SUBZONE_SOURCE_ID,
        layout: { visibility: "none" },
        paint: { "line-color": "#fbbf24", "line-width": 3, "line-opacity": 0.9 },
        filter: EMPTY_SUBZONE_HIGHLIGHT,
      });
    }

    if (!hasLayer(map, ROAD_LAYER_ID)) {
      map.addLayer({
        id: ROAD_LAYER_ID,
        type: "line",
        source: ROAD_SOURCE_ID,
        layout: { visibility: "none" },
        paint: { "line-color": "#f97316", "line-width": DEFAULT_ROAD_WIDTH, "line-opacity": 0.95 },
        filter: EMPTY_PA_FILTER,
      });
    }

    if (!hasLayer(map, AMENITY_ICON_LAYER_ID)) {
      map.addLayer({
        id: AMENITY_ICON_LAYER_ID,
        type: "symbol",
        source: AMENITY_SOURCE_ID,
        layout: {
          visibility: "none",
          "icon-image":
            derivedAmenityCats.length > 0
              ? [
                  "match",
                  ["to-string", ["get", "amenity_category"]],
                  ...derivedAmenityCats.flatMap((c) => [c, amenityIconId(c)]),
                  AMENITY_ICON_DEFAULT_ID,
                ]
              : AMENITY_ICON_DEFAULT_ID,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "bottom",
          "icon-size": 0.05,
        },
      });
    }

    if (!hasLayer(map, PA_FLOOD_BUBBLE_LAYER_ID)) {
      map.addLayer({
        id: PA_FLOOD_BUBBLE_LAYER_ID,
        type: "circle",
        source: PA_FLOOD_SOURCE_ID,
        layout: { visibility: "visible" },
        paint: {
          "circle-color": [
            "step",
            ["get", "count"],
            "#86efac", 10,
            "#22c55e", 50,
            "#16a34a", 100,
            "#15803d"
          ],
          "circle-radius": [
            "step",
            ["get", "count"],
            10, 10,
            14, 50,
            18, 100,
            22
          ],
          "circle-stroke-color": "#0b1220",
          "circle-stroke-width": 2,
          "circle-opacity": 0.88,
        },
      });
    }
    if (!hasLayer(map, PA_FLOOD_COUNT_LAYER_ID)) {
      map.addLayer({
        id: PA_FLOOD_COUNT_LAYER_ID,
        type: "symbol",
        source: PA_FLOOD_SOURCE_ID,
        layout: {
          "text-field": ["to-string", ["get", "count"]],
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 12,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      });
    }

    if (!hasLayer(map, FLOOD_STACK_BUBBLE_LAYER_ID)) {
      map.addLayer({
        id: FLOOD_STACK_BUBBLE_LAYER_ID,
        type: "circle",
        source: FLOOD_STACKED_SOURCE_ID,
        layout: { visibility: "none" },
        filter: [">", ["get", "count"], 1],
        paint: {
          "circle-color": ["step", ["get", "count"], "#38bdf8", 5, "#0ea5e9", 10, "#0284c7"],
          "circle-radius": ["step", ["get", "count"], 12, 5, 16, 10, 20],
          "circle-stroke-color": "#0b1220",
          "circle-stroke-width": 2,
          "circle-opacity": 0.9,
        },
      });
    }
    if (!hasLayer(map, FLOOD_STACK_COUNT_LAYER_ID)) {
      map.addLayer({
        id: FLOOD_STACK_COUNT_LAYER_ID,
        type: "symbol",
        source: FLOOD_STACKED_SOURCE_ID,
        layout: {
          visibility: "none",
          "text-field": ["to-string", ["get", "count"]],
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 12,
          "text-allow-overlap": true,
        },
        filter: [">", ["get", "count"], 1],
        paint: { "text-color": "#ffffff" },
      });
    }
    if (!hasLayer(map, FLOOD_SINGLE_LAYER_ID)) {
      map.addLayer({
        id: FLOOD_SINGLE_LAYER_ID,
        type: "symbol",
        source: FLOOD_STACKED_SOURCE_ID,
        layout: {
          visibility: "none",
          "icon-image": buildFloodIconExpression(derivedFloodTypes),
          "icon-size": 0.1,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "bottom",
        },
        filter: ["==", ["get", "count"], 1],
      });
    }

    /* cursors (bind once safely) */
    const onEnter = (id) => map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    const onLeave = (id) => map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    [PLANNING_FILL_LAYER_ID, SUBZONE_FILL_LAYER_ID, AMENITY_ICON_LAYER_ID, ROAD_LAYER_ID, PA_FLOOD_BUBBLE_LAYER_ID, FLOOD_STACK_BUBBLE_LAYER_ID, FLOOD_SINGLE_LAYER_ID]
      .forEach((id) => { if (hasLayer(map, id)) { onEnter(id); onLeave(id); }});

    /* clicks on polygons (bind once) */
    if (!map.__paClickBound) {
      map.__paClickBound = true;
      map.on("click", PLANNING_FILL_LAYER_ID, (event) => {
        if (spiderActiveRef.current) { tryClearSpiderfy(); return; }
        const feature = event.features?.[0];
        const name = S(feature?.properties?.PLN_AREA_N);
        if (!name) return;
        const fullFeature = planningAreaFeatureRef.current[name] || feature;
        const bounds = computeFeatureBounds(fullFeature.geometry);
        if (bounds) map.fitBounds(bounds, { padding: 48, duration: 800, maxZoom: 13 });
        onPlanningAreaToggle?.(name);
        setViewMode("subzone");
        setActiveSubzoneName(null);
        setShowAmenities?.(true);
        tryClearSpiderfy();
      });
    }
    if (!map.__szClickBound) {
      map.__szClickBound = true;
      map.on("click", SUBZONE_FILL_LAYER_ID, (event) => {
        if (spiderActiveRef.current) { tryClearSpiderfy(); return; }
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
        setActiveSubzoneName(S(properties.SUBZONE_N));
        setShowAmenities?.(true);
        tryClearSpiderfy();
      });
    }
    if (!map.__pabubbleClickBound) {
      map.__pabubbleClickBound = true;
      map.on("click", PA_FLOOD_BUBBLE_LAYER_ID, (e) => {
        if (spiderActiveRef.current) return;
        const f = e.features?.[0];
        const paName = S(f?.properties?.PLN_AREA_N);
        if (!paName) return;
        onPlanningAreaToggle?.(paName);
        setViewMode("subzone");
        setActiveSubzoneName(null);
        setShowAmenities?.(true);
        const fullFeature = planningAreaFeatureRef.current[paName];
        const bounds = fullFeature ? computeFeatureBounds(fullFeature.geometry) : null;
        if (bounds) map.fitBounds(bounds, { padding: 48, duration: 800, maxZoom: 13 });
      });
    }

    /* hover handlers */
    if (!map.__hoverBound) {
      map.__hoverBound = true;
      // amenity hover (html)
      map.on("mousemove", AMENITY_ICON_LAYER_ID, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const html = buildNiceAmenityHtml(f.properties || {});
        showHoverPopup(map, e.lngLat, html);
      });
      map.on("mouseleave", AMENITY_ICON_LAYER_ID, clearHoverPopup);

      // road hover (html)
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
      map.on("mouseleave", ROAD_LAYER_ID, clearHoverPopup);

      // singles hover (html) in PA view
      map.on("mousemove", FLOOD_SINGLE_LAYER_ID, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const html = buildNiceFloodHtml(f.properties || {});
        showHoverPopup(map, e.lngLat, html);
      });
      map.on("mouseleave", FLOOD_SINGLE_LAYER_ID, clearHoverPopup);
    }

    /* spiderfy click (bind once) */
    const tryClearSpiderfy = () => {
      try {
        if (map.getLayer(FLOOD_SPIDER_POINTS_LAYER_ID)) map.removeLayer(FLOOD_SPIDER_POINTS_LAYER_ID);
        if (map.getLayer(FLOOD_SPIDER_EDGES_LAYER_ID)) map.removeLayer(FLOOD_SPIDER_EDGES_LAYER_ID);
        if (map.getSource(FLOOD_SPIDER_SOURCE_ID)) map.removeSource(FLOOD_SPIDER_SOURCE_ID);
        if (map.getSource(FLOOD_SPIDER_EDGES_SOURCE_ID)) map.removeSource(FLOOD_SPIDER_EDGES_SOURCE_ID);
      } catch {}
      spiderActiveRef.current = false;
    };

    if (!map.__stackClickBound) {
      map.__stackClickBound = true;
      map.on("click", FLOOD_STACK_BUBBLE_LAYER_ID, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        e.originalEvent?.stopPropagation?.();
        e.originalEvent && (e.originalEvent.cancelBubble = true);

        const stackKey = S(f.properties?.stack_key);
        const group = floodStackMapRef.current.get(stackKey);
        if (!group || (group.members || []).length <= 1) return;

        const centerLngLat = { lng: group.center[0], lat: group.center[1] };
        const centerPx = map.project(centerLngLat);
        const n = group.members.length;
        const radius = 36;
        const angleStep = (2 * Math.PI) / n;
        const points = [];
        const edges = [];
        for (let i = 0; i < n; i++) {
          const a = i * angleStep;
          const ptPx = { x: centerPx.x + radius * Math.cos(a), y: centerPx.y + radius * Math.sin(a) };
          const ptLngLat = map.unproject(ptPx);
          points.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [ptLngLat.lng, ptLngLat.lat] },
            properties: { ...group.members[i].properties, __spider__: true, __idx__: i },
          });
          edges.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: [[centerLngLat.lng, centerLngLat.lat], [ptLngLat.lng, ptLngLat.lat]] },
            properties: { __edge__: true },
          });
        }

        if (!hasSrc(map, FLOOD_SPIDER_SOURCE_ID)) {
          map.addSource(FLOOD_SPIDER_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: points } });
        } else {
          map.getSource(FLOOD_SPIDER_SOURCE_ID).setData({ type: "FeatureCollection", features: points });
        }
        if (!hasSrc(map, FLOOD_SPIDER_EDGES_SOURCE_ID)) {
          map.addSource(FLOOD_SPIDER_EDGES_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: edges } });
        } else {
          map.getSource(FLOOD_SPIDER_EDGES_SOURCE_ID).setData({ type: "FeatureCollection", features: edges });
        }

        if (!hasLayer(map, FLOOD_SPIDER_EDGES_LAYER_ID)) {
          map.addLayer({
            id: FLOOD_SPIDER_EDGES_LAYER_ID,
            type: "line",
            source: FLOOD_SPIDER_EDGES_SOURCE_ID,
            paint: { "line-color": "#67e8f9", "line-width": 1.5, "line-opacity": 0.6 },
          });
        }
        if (!hasLayer(map, FLOOD_SPIDER_POINTS_LAYER_ID)) {
          map.addLayer({
            id: FLOOD_SPIDER_POINTS_LAYER_ID,
            type: "symbol",
            source: FLOOD_SPIDER_SOURCE_ID,
            layout: {
              "icon-image": buildFloodIconExpression(floodTypes?.length ? floodTypes : []),
              "icon-size": 0.1,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "icon-anchor": "bottom",
            },
          });
        }

        spiderActiveRef.current = true;
        map.once("movestart", () => { tryClearSpiderfy(); });
      });

      map.on("click", FLOOD_SPIDER_POINTS_LAYER_ID, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const html = buildNiceFloodHtml(f.properties || {});
        showClickPopup(map, e.lngLat, html);
        e.originalEvent?.stopPropagation?.();
        e.originalEvent && (e.originalEvent.cancelBubble = true);
      });
    }

    console.info("[map] sources/layers ensured & datasets bound.");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planningData, subzoneData, roadData, amenityData, floodData, amenityTypes, floodTypes]);

  /* resize */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current) return;
    try { map.resize(); } catch {}
  }, [resizeSignal]);

  /* amenity aggregates update on filter change */
  useEffect(() => {
    if (!amenityData) return;
    const categorySet = new Set(amenityCategoryFilter);
    const typeSet = new Set(amenityTypeFilter);
    const features =
      (amenityData.features || []).filter((feature) => {
        const props = feature?.properties || {};
        if (categorySet.size) {
          const category = S(props?.amenity_category);
          if (!categorySet.has(category)) return false;
        }
        if (typeSet.size) {
          const type = S(props?.amenity_type);
          if (!typeSet.has(type)) return false;
        }
        return true;
      }) || [];
    const filtered = { type: "FeatureCollection", features };
    const { byPA, bySZ } = aggregateAmenityStats(filtered);
    amenityStatsByPARef.current = byPA;
    amenityStatsBySZRef.current = bySZ;
  }, [amenityData, amenityCategoryFilter, amenityTypeFilter]);

  /* flood aggregates + PA bubbles + inside-PA stacks */
  useEffect(() => {
    if (!floodData || !planningData || !mapRef.current || !hasLoadedRef.current) return;

    const map = mapRef.current;

    const planningSet = new Set((selectedPlanningAreas || []).map(S));
    const typeSet = new Set(floodTypeFilterLowerList);
    const fromDateRaw = floodDateFrom ? new Date(floodDateFrom) : null;
    const toDateRaw = floodDateTo ? new Date(floodDateTo) : null;
    const fromDate = fromDateRaw && !Number.isNaN(fromDateRaw.getTime()) ? fromDateRaw : null;
    const toDate = toDateRaw && !Number.isNaN(toDateRaw.getTime()) ? toDateRaw : null;

    const featuresFilteredByTypeDate = (floodData.features || []).filter((feature) => {
      const props = feature?.properties || {};
      if (typeSet.size) {
        const type = getFloodType(props);
        if (!typeSet.has(type)) return false;
      }
      if ((fromDate || toDate) && !isWithinDateRange(getEventDate(props), fromDate, toDate)) return false;
      return true;
    });

    const filteredFcTypeDate = { type: "FeatureCollection", features: featuresFilteredByTypeDate };

    const { by_pa_id, by_sz_id } = computeFloodCountsById(
      filteredFcTypeDate,
      planningAreaIdRef.current,
      subzoneNameToIdRef.current
    );
    floodByPaRef.current = by_pa_id;
    floodBySzRef.current = by_sz_id;

    const { byPaId, bySzId } = computeFloodBreakdownsById(
      filteredFcTypeDate,
      planningAreaIdRef.current,
      subzoneNameToIdRef.current
    );
    floodCatsByPARef.current = byPaId;
    floodCatsBySZRef.current = bySzId;

    // PA bubble features
    const paBubbleFeatures = [];
    for (const f of (planningData.features || [])) {
      const props = f.properties || {};
      const paId = S(props.PA_ID ?? props.pa_id);
      const paName = S(props.PLN_AREA_N);
      const count = Number(by_pa_id?.[paId] || 0);
      const b = computeFeatureBounds(f.geometry);
      const c = boundsCenter(b);
      if (!c) continue;
      paBubbleFeatures.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: c },
        properties: { PA_ID: paId, PLN_AREA_N: paName, count },
      });
    }
    const paBubbleFc = { type: "FeatureCollection", features: paBubbleFeatures };

    if (hasSrc(map, PA_FLOOD_SOURCE_ID)) {
      map.getSource(PA_FLOOD_SOURCE_ID).setData(paBubbleFc);
    }

    // inside-PA stacked data (if PA selected)
    const featuresScopedToPA = (floodData.features || []).filter((feature) => {
      const props = feature?.properties || {};
      if (planningSet.size) {
        const paName = S(
          props.planning_area ?? props.PLN_AREA_N ?? props.planning ?? props.start_planning_area ?? props.end_planning_area
        );
        if (!planningSet.has(paName)) return false;
      }
      if (typeSet.size) {
        const type = getFloodType(props);
        if (!typeSet.has(type)) return false;
      }
      if ((fromDate || toDate) && !isWithinDateRange(getEventDate(props), fromDate, toDate)) return false;
      return true;
    });
    const filteredInsidePAFc = { type: "FeatureCollection", features: featuresScopedToPA };

    const { stackedFc, stackMap } = buildStackedFromFiltered(filteredInsidePAFc);
    floodStackMapRef.current = stackMap;

    if (hasSrc(map, FLOOD_STACKED_SOURCE_ID)) {
      map.getSource(FLOOD_STACKED_SOURCE_ID).setData(stackedFc);
      // clear spiderfy when membership changes
      try {
        if (map.getLayer(FLOOD_SPIDER_POINTS_LAYER_ID)) map.removeLayer(FLOOD_SPIDER_POINTS_LAYER_ID);
        if (map.getLayer(FLOOD_SPIDER_EDGES_LAYER_ID)) map.removeLayer(FLOOD_SPIDER_EDGES_LAYER_ID);
        if (map.getSource(FLOOD_SPIDER_SOURCE_ID)) map.removeSource(FLOOD_SPIDER_SOURCE_ID);
        if (map.getSource(FLOOD_SPIDER_EDGES_SOURCE_ID)) map.removeSource(FLOOD_SPIDER_EDGES_SOURCE_ID);
      } catch {}
      spiderActiveRef.current = false;
    }

    setVisibleFloodCount(featuresScopedToPA.length || featuresFilteredByTypeDate.length);

    // recompute per-road aggregates for hover (amenities & floods)
    roadAmenityCountRef.current = computeRoadAmenityCounts(amenityData);
    roadFloodCountRef.current = computeRoadFloodCounts(floodData);
    console.info("[map] aggregates updated:", {
      pa_bubbles: paBubbleFeatures.length,
      floods_scoped: featuresScopedToPA.length,
      road_amen_counts: Object.keys(roadAmenityCountRef.current).length,
      road_flood_counts: Object.keys(roadFloodCountRef.current).length,
    });
  }, [
    floodData,
    planningData,
    selectedPlanningAreas,
    floodTypeFilterLowerList,
    floodDateFrom,
    floodDateTo,
    amenityData,
  ]);

  /* layer visibility + other toggles */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current) return;
    if (!hasLayer(map, SUBZONE_FILL_LAYER_ID) || !hasLayer(map, ROAD_LAYER_ID) || !hasLayer(map, PLANNING_HIGHLIGHT_LAYER_ID)) {
      return;
    }

    const hasSelectionLocal = selectedPlanningAreas?.length > 0;

    // subzones & highlight: selection is by pa name
    const subzoneFilterExpr = buildMatchFilter("PLN_AREA_N", selectedPlanningAreas);
    map.setFilter(SUBZONE_FILL_LAYER_ID, subzoneFilterExpr);
    map.setFilter(SUBZONE_OUTLINE_LAYER_ID, subzoneFilterExpr);
    map.setFilter(PLANNING_HIGHLIGHT_LAYER_ID, hasSelectionLocal ? subzoneFilterExpr : ["==", ["get", "PLN_AREA_N"], "__none__"]);

    // roads: filter by pa_id list
    const paIds = (selectedPlanningAreas || []).map((name) => planningAreaIdRef.current[name]).filter(Boolean);
    const roadPAFilter = buildMatchFilter("PA_ID", paIds);
    map.setFilter(ROAD_LAYER_ID, roadPAFilter);
    map.setLayoutProperty(ROAD_LAYER_ID, "visibility", hasSelectionLocal && paIds.length > 0 ? "visible" : "none");

    // subzone visibility
    const subzoneVisible = viewMode === "subzone" && hasSelectionLocal ? "visible" : "none";
    map.setLayoutProperty(SUBZONE_FILL_LAYER_ID, "visibility", subzoneVisible);
    map.setLayoutProperty(SUBZONE_OUTLINE_LAYER_ID, "visibility", subzoneVisible);
    map.setLayoutProperty(SUBZONE_HIGHLIGHT_LAYER_ID, "visibility", subzoneVisible);
    if (hasLayer(map, SZ_HOVER_OUTLINE_ID)) {
      map.setLayoutProperty(SZ_HOVER_OUTLINE_ID, "visibility", subzoneVisible);
    }

    // PA bubbles visible only in planning mode
    const planningBubblesVisible = viewMode === "planning" ? "visible" : "none";
    [PA_FLOOD_BUBBLE_LAYER_ID, PA_FLOOD_COUNT_LAYER_ID].forEach((id) => {
      if (hasLayer(map, id)) map.setLayoutProperty(id, "visibility", planningBubblesVisible);
    });

    // inside-PA flood markers/stack visible only in subzone mode
    const insidePAVisible = viewMode === "subzone" && hasSelectionLocal && showFloods ? "visible" : "none";
    [FLOOD_STACK_BUBBLE_LAYER_ID, FLOOD_STACK_COUNT_LAYER_ID, FLOOD_SINGLE_LAYER_ID].forEach((id) => {
      if (hasLayer(map, id)) map.setLayoutProperty(id, "visibility", insidePAVisible);
    });

    // amenity markers
    if (hasLayer(map, AMENITY_ICON_LAYER_ID)) {
      const subzoneName = S(selectedSubzone?.properties?.SUBZONE_N) || (activeSubzoneName ?? "");
      const amenityClauses = ["all"];

      if (hasSelectionLocal) amenityClauses.push(buildMatchFilter("planning_area", selectedPlanningAreas));
      if (subzoneName) amenityClauses.push(["==", ["to-string", ["coalesce", ["get", "subzone"], ""]], subzoneName]);
      if (amenityCategoryFilter.length) {
        amenityClauses.push([
          "in",
          ["to-string", ["coalesce", ["get", "amenity_category"], ""]],
          ["literal", amenityCategoryFilter],
        ]);
      }
      if (amenityTypeFilter.length) {
        amenityClauses.push([
          "in",
          ["to-string", ["coalesce", ["get", "amenity_type"], ""]],
          ["literal", amenityTypeFilter],
        ]);
      }
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
  }, [
    selectedPlanningAreas,
    selectedSubzone,
    activeSubzoneName,
    viewMode,
    showAmenities,
    showFloods,
    displayAmenityCategoriesNorm,
    amenityCategoryFilter,
    amenityTypeFilter,
  ]);

  /* choropleths & road width */
  const getPlanningColoring = () => {
    if (colorMetric === "amenities") {
      const mapm = amenityStatsByPARef.current || {};
      const countMap = Object.fromEntries(Object.entries(mapm).map(([k, v]) => [k, v.total || 0]));
      const maxCount = Math.max(1, ...Object.values(countMap), 1);
      return { countMap, maxCount, keyProp: "PLN_AREA_N" };
    }
    const countMap = floodByPaRef.current || {};
    const vals = Object.values(countMap || {});
    const maxCount = vals.length ? Math.max(...vals, 1) : 1;
    return { countMap, maxCount, keyProp: "PA_ID" };
  };

  const getSubzoneColoring = () => {
    if (colorMetric === "amenities") {
      const base = Object.fromEntries(
        Object.entries(amenityStatsBySZRef.current || {}).map(([k, v]) => [k, v.total || 0])
      );
      const vals = Object.values(base);
      return { countMap: base, maxCount: vals.length ? Math.max(...vals, 1) : 1, keyProp: "SUBZONE_N" };
    }
    const base_map = floodBySzRef.current || {};
    const vals = Object.values(base_map);
    return { countMap: base_map, maxCount: vals.length ? Math.max(...vals, 1) : 1, keyProp: "SZ_ID" };
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLoadedRef.current || !hasLayer(map, PLANNING_FILL_LAYER_ID)) return;

    // planning choropleth
    const { countMap: paCounts, maxCount: paMax, keyProp: paKey } = getPlanningColoring();
    const planningExpr = buildChoroplethExpression(paKey, paCounts, paMax, PLANNING_COLORS, DEFAULT_PLANNING_COLOR);
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
        const { countMap: szCounts, maxCount: szMax, keyProp: szKey } = getSubzoneColoring();
        const subzoneExpr = buildChoroplethExpression(szKey, szCounts, szMax, SUBZONE_COLORS, DEFAULT_SUBZONE_COLOR);
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
    if (hasLayer(map, ROAD_LAYER_ID)) {
      const weightMap = roadWeightMapRef.current && Object.keys(roadWeightMapRef.current).length
        ? roadWeightMapRef.current
        : (floodStats.roadCountMap ?? {});
      const maxW = roadWeightMaxRef.current || floodStats.maxRoadCount || 1;
      const roadWidthExpression =
        selectedPlanningAreas.length > 0
          ? buildLineWidthExpression(
              ["coalesce", ["get", "RN_ID"], ["get", "rn_id"], ["get", "RD_NAME"]],
              weightMap,
              maxW,
              2,
              8,
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
                    const normalized = S(t);
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
              <span>show amenities</span>
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
                    const normalized = S(cat);
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
              <div className="mt-2 text:[11px] text-slate-400">
                click a planning area (or its green bubble) to drill into floods.
              </div>
            )}

            <div className="mt-3 text-[11px] text-slate-300">
              visible floods: <span className="font-semibold text-slate-100">{visibleFloodCount}</span>
            </div>
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
            <span className="inline-block h-3 w-3 rounded-full border border-white" style={{ backgroundColor: "#22c55e" }} />
            <span className="text-slate-300">pa flood count</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full border border-white" style={{ backgroundColor: "#38bdf8" }} />
            <span className="text-slate-300">flood event (inside pa view)</span>
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
