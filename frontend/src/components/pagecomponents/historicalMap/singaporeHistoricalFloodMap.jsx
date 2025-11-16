// components/map/singaporehistoricalfloodmap.jsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import * as turf from "@turf/turf";

/* ===== base config ===== */
const mapbox_token = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const mapbox_style = "mapbox://styles/mapbox/streets-v12";
const default_center = [103.8198, 1.3521];
const default_zoom = 11;

mapboxgl.accessToken = mapbox_token;
if (typeof mapboxgl.setTelemetryEnabled === "function") mapboxgl.setTelemetryEnabled(false);

/* ===== ids ===== */
const PA_SRC = "pa-src";
const PA_FILL = "pa-fill";
const PA_OUTLINE = "pa-outline";

const SZ_SRC = "sz-src";
const SZ_FILL = "sz-fill";
const SZ_OUTLINE = "sz-outline";

const FLOODS_SRC = "floods-src";
const FLOOD_POINTS = "flood-points";
const FLOOD_HEAT = "flood-heat";

const ROAD_SRC = "road-src";
const ROAD_LINE = "road-line";

const AMENITIES_SRC = "amenities-src";
const AMENITY_POINTS = "amenity-points";

const PA_CENTROIDS_SRC = "pa-centroids-src";
const PA_BUBBLE_CIRCLES = "pa-bubble-circles";
const PA_BUBBLE_LABELS = "pa-bubble-labels";

const SZ_CENTROIDS_SRC = "sz-centroids-src";
const SZ_BUBBLE_CIRCLES = "sz-bubble-circles";
const SZ_BUBBLE_LABELS = "sz-bubble-labels";

/* ===== helpers ===== */
const asFC = (d) =>
  d && d.type === "FeatureCollection" && Array.isArray(d.features)
    ? d
    : { type: "FeatureCollection", features: [] };

const toS = (v) => (v == null ? "" : String(v).trim());
const toLC = (v) => toS(v).toLowerCase();
const toTitle = (s) => String(s || "").toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());

const PA_NAME_KEYS = ["PLN_AREA_N", "pln_area_n", "planning_area", "pa_name"];
const SZ_NAME_KEYS = ["SUBZONE_N", "subzone_n", "subzone"];
const FLOOD_PA_NAME_KEYS = ["origin_planning_area", "planning_area", "pa_name", "start_planning_area", "end_planning_area"];
const AMEN_PA_NAME_KEYS = ["planning_area", "PLN_AREA_N", "pa_name"];
const ROAD_PA_NAME_KEYS = ["planning_area", "PLN_AREA_N", "pa_name"];

const getProp = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && v !== "") return v;
  }
  return "";
};

const withinDate = (value, fromISO, toISO) => {
  if (!fromISO && !toISO) return true;
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return false;
  if (fromISO && d < new Date(fromISO)) return false;
  if (toISO && d > new Date(toISO)) return false;
  return true;
};

const computeBounds = (geom) => {
  if (!geom) return null;
  const pts = [];
  const push = (c) => { if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) pts.push(c); };
  const walk = (g) => {
    if (!g) return;
    const type = (g.type || "").toLowerCase();
    const coordinates = g.coordinates;
    if (type === "point") push(coordinates);
    else if (type === "multipoint" || type === "linestring") coordinates.forEach(push);
    else if (type === "multilinestring" || type === "polygon") coordinates.flat(1).forEach(push);
    else if (type === "multipolygon") coordinates.flat(2).forEach(push);
    else if (type === "geometrycollection") (g.geometries || []).forEach(walk);
  };
  walk(geom);
  if (!pts.length) return null;
  let minx = +Infinity, miny = +Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of pts) { if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; }
  return [[minx, miny], [maxx, maxy]];
};

/* palettes */
const CHORO_RAMP = ["#e0f2fe","#bae6fd","#93c5fd","#60a5fa","#3b82f6","#1d4ed8"];
const PA_DEFAULT = "#e2e8f0";
const SZ_DEFAULT = "rgba(37,99,235,0.18)";
const KDE_GRAD = [
  "interpolate", ["linear"], ["heatmap-density"],
  0, "rgba(255,255,255,0)",
  0.2, "#fee2e2",
  0.4, "#fecaca",
  0.6, "#fca5a5",
  0.8, "#ef4444",
  1, "#991b1b"
];

const inc = (obj, key, by = 1) => { const k = toS(key); if (!k) return; obj[k] = (obj[k] || 0) + by; };

const normalizePlanning = (fc) => {
  const src = asFC(fc);
  const features = (src.features || []).map((f) => {
    const p = { ...(f.properties || {}) };
    const name = getProp(p, PA_NAME_KEYS);
    if (name) { p.PLN_AREA_N = name; p.pln_area_n = name; }
    return { ...f, properties: p };
  });
  return { type: "FeatureCollection", features };
};

function computePACounts(floodFC, selectedPAs, selectedTypesLC, fromISO, toISO) {
  const sel = new Set((selectedPAs || []).map(toS).filter(Boolean));
  const m = {};
  const hasType = selectedTypesLC && selectedTypesLC.length > 0;
  for (const f of floodFC?.features || []) {
    const p = f.properties || {};
    const t = toLC(p.event ?? p.flood_type ?? "");
    if (hasType && !selectedTypesLC.includes(t)) continue;
    const dt = p.event_date_iso ?? p.event_date ?? p.start_date ?? p.date ?? p.dt ?? null;
    if (!withinDate(dt, fromISO, toISO)) continue;
    const pa = toS(getProp(p, FLOOD_PA_NAME_KEYS));
    if (sel.size && !sel.has(pa)) continue;
    if (pa) inc(m, pa, 1);
  }
  return m;
}
function computeSZCounts(floodFC, selectedPAs, selectedTypesLC, fromISO, toISO) {
  const sel = new Set((selectedPAs || []).map(toS).filter(Boolean));
  const m = {};
  const hasType = selectedTypesLC && selectedTypesLC.length > 0;
  for (const f of floodFC?.features || []) {
    const p = f.properties || {};
    const t = toLC(p.event ?? p.flood_type ?? "");
    if (hasType && !selectedTypesLC.includes(t)) continue;
    const dt = p.event_date_iso ?? p.event_date ?? p.start_date ?? p.date ?? p.dt ?? null;
    if (!withinDate(dt, fromISO, toISO)) continue;
    const pa = toS(getProp(p, FLOOD_PA_NAME_KEYS));
    if (sel.size && !sel.has(pa)) continue;
    const sz = toS(p.origin_subzone || p.subzone || p.start_subzone || p.end_subzone);
    if (sz) inc(m, sz, 1);
  }
  return m;
}

function computeAmenityCounts({ amenitiesFC, planningFC, subzoneFC, selectedPAs, selectedCats, selectedTypes }) {
  const paCounts = {};
  const szCounts = {};
  const A = asFC(amenitiesFC);
  if (!A.features.length) return { paCounts, szCounts };

  const paAllow = new Set((selectedPAs || []).map(toS).filter(Boolean));
  const catAllow = new Set((selectedCats || []).map(toS).filter(Boolean));
  const typeAllow = new Set((selectedTypes || []).map(toS).filter(Boolean));

  let hasPA = false, hasSZ = false;
  for (const pt of A.features) {
    const p = pt.properties || {};
    if (getProp(p, PA_NAME_KEYS)) hasPA = true;
    if (getProp(p, SZ_NAME_KEYS)) hasSZ = true;
    if (hasPA && hasSZ) break;
  }

  const passCategories = (p) => {
    if (catAllow.size) { const c = toS(p.amenity_category); if (!c || !catAllow.has(c)) return false; }
    if (typeAllow.size) { const t = toS(p.amenity_type); if (!t || !typeAllow.has(t)) return false; }
    return true;
  };

  const passPA = (p) => {
    if (!paAllow.size) return true; // No PA filter = allow all
    const pa = toS(getProp(p, PA_NAME_KEYS));
    if (!pa) return true; // No PA property = needs spatial join, allow it through
    return paAllow.has(pa); // Has PA property = check if it's in allowed set
  };

  if (hasPA || hasSZ) {
    for (const pt of A.features) {
      const p = pt.properties || {};
      if (!passCategories(p)) continue;
      if (!passPA(p)) continue;
      const pa = getProp(p, PA_NAME_KEYS);
      const sz = getProp(p, SZ_NAME_KEYS);
      if (pa) inc(paCounts, pa, 1);
      if (sz) inc(szCounts, sz, 1);
    }
    return { paCounts, szCounts };
  }

  // Filter paIndex and szIndex to only selected planning areas
  const paIndex = (planningFC.features || [])
    .filter((f) => {
      if (!paAllow.size) return true; // No filter = include all
      const paName = toS(getProp(f.properties, PA_NAME_KEYS));
      return paAllow.has(paName); // Only include selected PAs
    })
    .map((f) => ({ name: toS(getProp(f.properties, PA_NAME_KEYS)), geom: f.geometry }));

  const szIndex = (subzoneFC.features || [])
    .filter((f) => {
      if (!paAllow.size) return true; // No filter = include all
      const paName = toS(getProp(f.properties, PA_NAME_KEYS));
      return paAllow.has(paName); // Only include subzones in selected PAs
    })
    .map((f) => ({ name: toS(getProp(f.properties, SZ_NAME_KEYS)), geom: f.geometry }));

  for (const pt of A.features) {
    const p = pt.properties || {};
    if (!passCategories(p)) continue;
    const gpt = turf.point(pt.geometry?.coordinates || []);
    for (const { name, geom } of paIndex) { if (!name) continue; if (turf.booleanPointInPolygon(gpt, geom)) { inc(paCounts, name, 1); break; } }
    for (const { name, geom } of szIndex) { if (!name) continue; if (turf.booleanPointInPolygon(gpt, geom)) { inc(szCounts, name, 1); break; } }
  }
  return { paCounts, szCounts };
}

function buildChoropleth(valueMap, nameField) {
  const entries = Object.entries(valueMap || {});
  if (!entries.length) return { expr: PA_DEFAULT, max: 1 };
  const values = entries.map(([, v]) => +v || 0);
  const max = Math.max(...values, 1);
  return {
    expr: [
      "case",
      ["==", ["coalesce", ["get", nameField], ""], ""],
      PA_DEFAULT,
      [
        "interpolate",
        ["linear"],
        [
          "to-number",
          [
            "coalesce",
            [
              "match",
              ["to-string", ["get", nameField]],
              ...entries.flatMap(([k, v]) => [String(k), Number(v) || 0]),
              0,
            ],
            0,
          ],
        ],
        0, CHORO_RAMP[0],
        max * 0.2, CHORO_RAMP[1],
        max * 0.4, CHORO_RAMP[2],
        max * 0.6, CHORO_RAMP[3],
        max * 0.8, CHORO_RAMP[4],
        max, CHORO_RAMP[5],
      ],
    ],
    max,
  };
}

const buildCentroids = (polyFC, nameField, countsMap, extraPropsFn) => {
  const feats = (polyFC?.features || []).map((f) => {
    const name = toS(f?.properties?.[nameField]);
    const b = computeBounds(f?.geometry);
    if (!name || !b) return null;
    const [[minx, miny], [maxx, maxy]] = b;
    const center = [(minx + maxx) / 2, (miny + maxy) / 2];
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: center },
      properties: { name, count: Number(countsMap?.[name] || 0), ...(extraPropsFn?.(f) || {}) },
    };
  }).filter(Boolean);
  return { type: "FeatureCollection", features: feats };
};

const matchFilter = (prop, values) => {
  const list = (values || []).map(toS).filter(Boolean);
  if (!list.length) return ["boolean", true];
  return ["in", ["to-string", ["coalesce", ["get", prop], ""]], ["literal", list]];
};
const anyKeyEqualsFilter = (keys, values) => {
  const list = (values || []).map(toS).filter(Boolean);
  if (!list.length) return ["boolean", false];
  const parts = keys.map((k) => ["in", ["to-string", ["coalesce", ["get", k], ""]], ["literal", list]]);
  return ["any", ...parts];
};

const legendBreaks = (max) => {
  const m = Math.max(1e-9, +max || 1);
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => Math.round(m * t * 10) / 10);
  for (let i = 1; i < ticks.length; i++) if (ticks[i] < ticks[i - 1]) ticks[i] = ticks[i - 1];
  return ticks;
};

const rankComplete = (names, map, desc = true) => {
  const entries = (names || []).map((n) => [n, +map[n] || 0]).sort((a,b)=> (desc ? b[1]-a[1] : a[1]-b[1]));
  const ranks = {};
  entries.forEach(([k], i) => (ranks[k] = i + 1));
  return { ranks, total: entries.length };
};

export default function singaporehistoricalfloodmap({
  planningData,
  subzoneData,
  roadData,
  amenityData,
  floodData,
  resizeSignal,
  selectedPlanningAreas = [],
  selectedSubzone = null,
  selectedAmenityCategories = [],
  selectedAmenityTypes = [],
  selectedSubzones = [],
  selectedFloodTypes = [],
  floodDateFrom = "",
  floodDateTo = "",
  onPlanningAreaToggle,
  onSubzoneSelect,
}) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const loadedRef = useRef(false);

  const paPopupRef = useRef(null);
  const szPopupRef = useRef(null);
  const markerPopupRef = useRef(null);

  const [metric, setMetric] = useState("flood_count");
  const [showChoropleth, setShowChoropleth] = useState(true);
  const [showFloodMarkers, setShowFloodMarkers] = useState(false);
  const [showAmenityMarkers, setShowAmenityMarkers] = useState(false);
  const [showKDE, setShowKDE] = useState(false);
  const [kdeRadius, setKdeRadius] = useState(22);
  const [kdeIntensity, setKdeIntensity] = useState(0.9);

  const planningFC = useMemo(() => normalizePlanning(planningData), [planningData]);
  const subzoneFC  = useMemo(() => asFC(subzoneData), [subzoneData]);
  const floodFC    = useMemo(() => asFC(floodData), [floodData]);
  const amenitiesFC = useMemo(() => asFC(amenityData), [amenityData]);
  const roadFC     = useMemo(() => asFC(roadData), [roadData]);

  const paUniverse = useMemo(() => (planningFC.features || []).map(f => toS(getProp(f.properties, PA_NAME_KEYS))), [planningFC]);
  const szUniverse = useMemo(() => (subzoneFC.features || []).map(f => toS(getProp(f.properties, SZ_NAME_KEYS))), [subzoneFC]);

  // Filtered PA universe for rankings (respects selectedPlanningAreas filter)
  const paUniverseFiltered = useMemo(() => {
    const selected = new Set((selectedPlanningAreas || []).map(toS).filter(Boolean));
    if (selected.size === 0) return paUniverse; // No filter = all PAs
    return paUniverse.filter(pa => selected.has(pa)); // Only selected PAs
  }, [paUniverse, selectedPlanningAreas]);

  // Filtered SZ universe for rankings (respects selectedPlanningAreas filter)
  const szUniverseFiltered = useMemo(() => {
    const selected = new Set((selectedPlanningAreas || []).map(toS).filter(Boolean));
    if (selected.size === 0) return szUniverse; // No filter = all SZs
    // Filter subzones that belong to selected planning areas
    return (subzoneFC.features || [])
      .filter(f => {
        const pa = toS(getProp(f.properties, PA_NAME_KEYS));
        return selected.has(pa);
      })
      .map(f => toS(getProp(f.properties, SZ_NAME_KEYS)));
  }, [szUniverse, subzoneFC, selectedPlanningAreas]);

  const totalPAUniverse = useMemo(
    () => new Set(paUniverse.filter(Boolean)).size,
    [paUniverse]
  );
  const selectedPASet = useMemo(() => new Set((selectedPlanningAreas || []).map(toS).filter(Boolean)), [selectedPlanningAreas]);
  const hasPASelection = selectedPASet.size > 0;
  const isAllPASelected = hasPASelection && totalPAUniverse > 0 && selectedPASet.size >= totalPAUniverse;
  const paFilterValues = Array.from(selectedPASet);
  const hasSZSelection = (selectedSubzones || []).length > 0;

  const paArea = useMemo(() => {
    const m = {};
    for (const f of planningFC.features || []) {
      const name = toS(getProp(f.properties, PA_NAME_KEYS));
      m[name] = +f.properties?.area || 0;
    }
    return m;
  }, [planningFC]);
  const szArea = useMemo(() => {
    const m = {};
    for (const f of subzoneFC.features || []) {
      const name = toS(getProp(f.properties, SZ_NAME_KEYS));
      m[name] = +f.properties?.area || 0;
    }
    return m;
  }, [subzoneFC]);

  const paFloodsCount = useMemo(
    () => computePACounts(floodFC, selectedPlanningAreas, selectedFloodTypes.map(toLC), floodDateFrom, floodDateTo),
    [floodFC, selectedPlanningAreas, selectedFloodTypes, floodDateFrom, floodDateTo]
  );
  const szFloodsCount = useMemo(
    () => computeSZCounts(floodFC, selectedPlanningAreas, selectedFloodTypes.map(toLC), floodDateFrom, floodDateTo),
    [floodFC, selectedPlanningAreas, selectedFloodTypes, floodDateFrom, floodDateTo]
  );
  const paFloodsDensity = useMemo(() => {
    const m = {};
    for (const [k, c] of Object.entries(paFloodsCount)) {
      const a = +paArea[k] || 0;
      m[k] = a > 0 ? (+c || 0) / a : 0;
    }
    return m;
  }, [paFloodsCount, paArea]);
  const szFloodsDensity = useMemo(() => {
    const m = {};
    for (const [k, c] of Object.entries(szFloodsCount)) {
      const a = +szArea[k] || 0;
      m[k] = a > 0 ? (+c || 0) / a : 0;
    }
    return m;
  }, [szFloodsCount, szArea]);

  const { paCounts: paAmenCount, szCounts: szAmenCount } = useMemo(
    () => computeAmenityCounts({
      amenitiesFC,
      planningFC,
      subzoneFC,
      selectedPAs: selectedPlanningAreas,
      selectedCats: selectedAmenityCategories,
      selectedTypes: selectedAmenityTypes
    }),
    [amenitiesFC, planningFC, subzoneFC, selectedPlanningAreas, selectedAmenityCategories, selectedAmenityTypes]
  );
  const paAmenDensity = useMemo(() => {
    const m = {};
    for (const [k, c] of Object.entries(paAmenCount)) {
      const a = +paArea[k] || 0;
      m[k] = a > 0 ? (+c || 0) / a : 0;
    }
    return m;
  }, [paAmenCount, paArea]);
  const szAmenDensity = useMemo(() => {
    const m = {};
    for (const [k, c] of Object.entries(szAmenCount)) {
      const a = +szArea[k] || 0;
      m[k] = a > 0 ? (+c || 0) / a : 0;
    }
    return m;
  }, [szAmenCount, szArea]);

  const paRankFloodsCount   = useMemo(() => rankComplete(paUniverseFiltered, paFloodsCount),   [paUniverseFiltered, paFloodsCount]);
  const paRankFloodsDensity = useMemo(() => rankComplete(paUniverseFiltered, paFloodsDensity), [paUniverseFiltered, paFloodsDensity]);
  const paRankAmenCount     = useMemo(() => rankComplete(paUniverseFiltered, paAmenCount),     [paUniverseFiltered, paAmenCount]);
  const paRankAmenDensity   = useMemo(() => rankComplete(paUniverseFiltered, paAmenDensity),   [paUniverseFiltered, paAmenDensity]);

  const szRankFloodsCount   = useMemo(() => rankComplete(szUniverseFiltered, szFloodsCount),   [szUniverseFiltered, szFloodsCount]);
  const szRankFloodsDensity = useMemo(() => rankComplete(szUniverseFiltered, szFloodsDensity), [szUniverseFiltered, szFloodsDensity]);
  const szRankAmenCount     = useMemo(() => rankComplete(szUniverseFiltered, szAmenCount),     [szUniverseFiltered, szAmenCount]);
  const szRankAmenDensity   = useMemo(() => rankComplete(szUniverseFiltered, szAmenDensity),   [szUniverseFiltered, szAmenDensity]);

  const perPA_SZ_Ranks = useMemo(() => {
    const selected = new Set((selectedPlanningAreas || []).map(toS).filter(Boolean));
    const paToSZ = {};
    for (const f of subzoneFC.features || []) {
      const sz = toS(getProp(f.properties, SZ_NAME_KEYS));
      const pa = toS(getProp(f.properties, PA_NAME_KEYS));
      if (!sz || !pa) continue;
      // Only include PAs that are selected (or all if none selected)
      if (selected.size > 0 && !selected.has(pa)) continue;
      (paToSZ[pa] ||= []).push(sz);
    }
    const build = (names, map) => {
      const entries = (names || []).map(n => [n, +map[n] || 0]).sort((a,b)=>b[1]-a[1]);
      const r = {}; entries.forEach(([k], i) => r[k] = i + 1);
      return { ranks: r, total: entries.length };
    };
    const out = {};
    for (const [pa, list] of Object.entries(paToSZ)) {
      out[pa] = {
        floodsCount:   build(list, szFloodsCount),
        floodsDensity: build(list, szFloodsDensity),
        amenCount:     build(list, szAmenCount),
        amenDensity:   build(list, szAmenDensity),
      };
    }
    return out;
  }, [subzoneFC, szFloodsCount, szFloodsDensity, szAmenCount, szAmenDensity, selectedPlanningAreas]);

  const popupStatsRef = useRef({
    paFloodsCount,
    paFloodsDensity,
    paAmenCount,
    paAmenDensity,
    paRankFloodsCount,
    paRankFloodsDensity,
    paRankAmenCount,
    paRankAmenDensity,
    szFloodsCount,
    szFloodsDensity,
    szAmenCount,
    szAmenDensity,
    szRankFloodsCount,
    szRankFloodsDensity,
    szRankAmenCount,
    szRankAmenDensity,
    perPA_SZ_Ranks,
  });

  useEffect(() => {
    popupStatsRef.current = {
      paFloodsCount,
      paFloodsDensity,
      paAmenCount,
      paAmenDensity,
      paRankFloodsCount,
      paRankFloodsDensity,
      paRankAmenCount,
      paRankAmenDensity,
      szFloodsCount,
      szFloodsDensity,
      szAmenCount,
      szAmenDensity,
      szRankFloodsCount,
      szRankFloodsDensity,
      szRankAmenCount,
      szRankAmenDensity,
      perPA_SZ_Ranks,
    };
  }, [
    paFloodsCount,
    paFloodsDensity,
    paAmenCount,
    paAmenDensity,
    paRankFloodsCount,
    paRankFloodsDensity,
    paRankAmenCount,
    paRankAmenDensity,
    szFloodsCount,
    szFloodsDensity,
    szAmenCount,
    szAmenDensity,
    szRankFloodsCount,
    szRankFloodsDensity,
    szRankAmenCount,
    szRankAmenDensity,
    perPA_SZ_Ranks,
  ]);

  const paCentroidsBase = useMemo(
    () => buildCentroids(planningFC, "PLN_AREA_N", paFloodsCount, (f) => ({
      population: f.properties?.population ?? null,
      area_km2: +f.properties?.area || null,
      population_density: f.properties?.population_density ?? null,
    })),
    [planningFC, paFloodsCount]
  );
  const szCentroidsBase = useMemo(
    () => buildCentroids(subzoneFC, "SUBZONE_N", szFloodsCount, (f) => ({
      pa_name: toS(getProp(f?.properties, PA_NAME_KEYS)),
      area_km2: +f.properties?.area || null,
    })),
    [subzoneFC, szFloodsCount]
  );

  const getMetricValuePA = (name) => {
    switch (metric) {
      case "flood_density":   return paFloodsDensity[name] ?? 0;
      case "amenity_count":   return paAmenCount[name] ?? 0;
      case "amenity_density": return paAmenDensity[name] ?? 0;
      default:                return paFloodsCount[name] ?? 0;
    }
  };
  const getMetricValueSZ = (name) => {
    switch (metric) {
      case "flood_density":   return szFloodsDensity[name] ?? 0;
      case "amenity_count":   return szAmenCount[name] ?? 0;
      case "amenity_density": return szAmenDensity[name] ?? 0;
      default:                return szFloodsCount[name] ?? 0;
    }
  };

  const paBubbleFC = useMemo(() => {
    const feats = (paCentroidsBase.features || []).map((f) => {
      const name = f.properties?.name;
      const v = getMetricValuePA(name);
      return { ...f, properties: { ...f.properties, bubble_value: typeof v === "number" ? (metric.endsWith("_density") ? v.toFixed(2) : v) : v } };
    });
    return { type: "FeatureCollection", features: feats };
  }, [paCentroidsBase, metric, paFloodsCount, paFloodsDensity, paAmenCount, paAmenDensity]);

  const szBubbleFC = useMemo(() => {
    const feats = (szCentroidsBase.features || []).map((f) => {
      const name = f.properties?.name;
      const v = getMetricValueSZ(name);
      return { ...f, properties: { ...f.properties, bubble_value: typeof v === "number" ? (metric.endsWith("_density") ? v.toFixed(2) : v) : v } };
    });
    return { type: "FeatureCollection", features: feats };
  }, [szCentroidsBase, metric, szFloodsCount, szFloodsDensity, szAmenCount, szAmenDensity]);

  // Map used for the LEGEND only — respects SZ selection when PA is selected
  // Map used for the LEGEND only — respects SZ selection when PA is selected
const legendValueMap = useMemo(() => {
  const base = !hasPASelection
    ? (metric === "flood_density"
        ? paFloodsDensity
        : metric === "amenity_count"
        ? paAmenCount
        : metric === "amenity_density"
        ? paAmenDensity
        : paFloodsCount)
    : (metric === "flood_density"
        ? szFloodsDensity
        : metric === "amenity_count"
        ? szAmenCount
        : metric === "amenity_density"
        ? szAmenDensity
        : szFloodsCount);

  if (hasPASelection && hasSZSelection) {
    const allow = new Set((selectedSubzones || []).map(toS));
    const out = {};
    for (const [k, v] of Object.entries(base)) {
      if (allow.has(k)) out[k] = v;
    }
    return out;
  }
  return base;
}, [
  hasPASelection,
  hasSZSelection,
  selectedSubzones,
  metric,
  paFloodsCount,
  paFloodsDensity,
  paAmenCount,
  paAmenDensity,
  szFloodsCount,
  szFloodsDensity,
  szAmenCount,
  szAmenDensity,
]);


  const formatTick = (x) => (metric.endsWith("_density") ? (Math.round(x * 100) / 100).toString() : Math.round(x).toString());

  /* === init map once === */
  useEffect(() => {
    if (mapRef.current) return;
    if (!mapboxgl.supported()) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: mapbox_style,
      center: default_center,
      zoom: default_zoom,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;

    map.on("load", () => {
      loadedRef.current = true;

      // sources
      map.addSource(PA_SRC, { type: "geojson", data: planningFC, generateId: true });
      if (subzoneFC.features.length) map.addSource(SZ_SRC, { type: "geojson", data: subzoneFC, generateId: true });
      if (floodFC.features.length)   map.addSource(FLOODS_SRC, { type: "geojson", data: floodFC });
      if (roadFC.features.length)    map.addSource(ROAD_SRC, { type: "geojson", data: roadFC, generateId: true });
      if (amenitiesFC.features.length) map.addSource(AMENITIES_SRC, { type: "geojson", data: amenitiesFC });

      // choropleth (pa + outline)
      map.addLayer({ id: PA_FILL, type: "fill", source: PA_SRC, paint: { "fill-color": PA_DEFAULT, "fill-opacity": 0.8 }, layout: { visibility: "visible" } });
      map.addLayer({ id: PA_OUTLINE, type: "line", source: PA_SRC, paint: { "line-color": "#1f2937", "line-width": 1.1, "line-opacity": 0.6 }, layout: { visibility: "visible" } });

      const { expr } = buildChoropleth(paFloodsCount, "PLN_AREA_N");
      map.setPaintProperty(PA_FILL, "fill-color", expr);

      // subzones (hidden until pa selected)
      if (subzoneFC.features.length) {
        map.addLayer({ id: SZ_FILL, type: "fill", source: SZ_SRC, layout: { visibility: "none" }, paint: { "fill-color": SZ_DEFAULT, "fill-opacity": 0.55 } });
        map.addLayer({ id: SZ_OUTLINE, type: "line", source: SZ_SRC, layout: { visibility: "none" }, paint: { "line-color": "#1d4ed8", "line-width": 0.8, "line-opacity": 0.7 } });
      }

      // kde (heatmap) for floods
      if (floodFC.features.length) {
        map.addLayer({
          id: FLOOD_HEAT,
          type: "heatmap",
          source: FLOODS_SRC,
          maxzoom: 15,
          layout: { visibility: "none" },
          paint: {
            "heatmap-intensity": kdeIntensity,
            "heatmap-radius": [
              "interpolate", ["linear"], ["zoom"],
              8, Math.max(5, kdeRadius * 0.6),
              12, kdeRadius,
              15, Math.min(80, kdeRadius * 1.6)
            ],
            "heatmap-opacity": 0.65,
            "heatmap-color": KDE_GRAD,
            "heatmap-weight": 1
          }
        });
      }

      // flood points (toggle)
      if (floodFC.features.length) {
        map.addLayer({
          id: FLOOD_POINTS,
          type: "circle",
          source: FLOODS_SRC,
          layout: { visibility: "none" },
          paint: {
            "circle-radius": 4,
            "circle-color": "#ef4444",
            "circle-stroke-color": "#111827",
            "circle-stroke-width": 1,
            "circle-opacity": 0.9
          }
        });
      }

      // amenity markers
      if (amenitiesFC.features.length) {
        map.addLayer({
          id: AMENITY_POINTS,
          type: "circle",
          source: AMENITIES_SRC,
          layout: { visibility: "none" },
          paint: {
            "circle-radius": 3.5,
            "circle-color": "#10b981",
            "circle-stroke-color": "#064e3b",
            "circle-stroke-width": 0.8,
            "circle-opacity": 0.9
          }
        });
      }

      // roads (only show for selected pa)
      if (roadFC.features.length) {
        map.addLayer({
          id: ROAD_LINE,
          type: "line",
          source: ROAD_SRC,
          layout: { visibility: "none" },
          paint: {
            "line-color": "#fb923c",
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 14, 1.6],
            "line-opacity": 0.95
          }
        });
      }

      // bubbles
      map.addSource(PA_CENTROIDS_SRC, { type: "geojson", data: paBubbleFC });
      map.addLayer({
        id: PA_BUBBLE_CIRCLES, type: "circle", source: PA_CENTROIDS_SRC,
        paint: { "circle-radius": 12, "circle-color": "rgba(15,23,42,0.95)", "circle-stroke-color": "#0b1220", "circle-stroke-width": 1.25 }
      });
      map.addLayer({
        id: PA_BUBBLE_LABELS, type: "symbol", source: PA_CENTROIDS_SRC,
        layout: { "text-field": ["to-string", ["get", "bubble_value"]], "text-size": 11, "text-allow-overlap": true, "text-font": ["Open Sans Bold","Arial Unicode MS Bold"] },
        paint: { "text-color": "#ffffff" }
      });

      map.addSource(SZ_CENTROIDS_SRC, { type: "geojson", data: szBubbleFC });
      map.addLayer({
        id: SZ_BUBBLE_CIRCLES, type: "circle", source: SZ_CENTROIDS_SRC, layout: { visibility: "none" },
        paint: { "circle-radius": 11, "circle-color": "rgba(30,58,138,0.95)", "circle-stroke-color": "#0b1220", "circle-stroke-width": 1.0 }
      });
      map.addLayer({
        id: SZ_BUBBLE_LABELS, type: "symbol", source: SZ_CENTROIDS_SRC, layout: { visibility: "none",
          "text-field": ["to-string", ["get", "bubble_value"]], "text-size": 10, "text-allow-overlap": true, "text-font": ["Open Sans Bold","Arial Unicode MS Bold"] },
        paint: { "text-color": "#ffffff" }
      });

      // popups
      paPopupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: "dark-popup", anchor: "bottom", maxWidth: "360px" });
      szPopupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: "dark-popup", anchor: "bottom", maxWidth: "360px" });
      markerPopupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: "dark-popup", anchor: "bottom", maxWidth: "320px" });

      const fmtNum = (n) => (n == null || Number.isNaN(+n) ? "–" : (+n).toLocaleString());
      const fmtFloat = (n, d = 2) => (n == null || Number.isNaN(+n) ? "–" : (+n).toFixed(d));

      const PA_HTML = (p) => {
        const stats = popupStatsRef.current || {};
        const {
          paFloodsCount = {},
          paFloodsDensity = {},
          paAmenCount = {},
          paAmenDensity = {},
          paRankFloodsCount = {},
          paRankFloodsDensity = {},
          paRankAmenCount = {},
          paRankAmenDensity = {},
        } = stats;
        const raw = toS(getProp(p, PA_NAME_KEYS));
        const name = toTitle(raw);
        const area  = p.area != null ? +p.area : (p.area_km2 != null ? +p.area_km2 : null);
        const pop   = p.population != null ? +p.population : null;

        const floods = +paFloodsCount[raw] || 0;
        const densF  = +paFloodsDensity[raw] || 0;
        const amen   = +paAmenCount[raw] || 0;
        const densA  = +paAmenDensity[raw] || 0;

        const rFC = paRankFloodsCount.ranks[raw] || "–";
        const rFD = paRankFloodsDensity.ranks[raw] || "–";
        const rAC = paRankAmenCount.ranks[raw] || "–";
        const rAD = paRankAmenDensity.ranks[raw] || "–";
        const tot = paRankFloodsCount.total || 0;

        return `
<div style="min-width:260px;max-width:340px;background:#0b1220;color:#e5e7eb;border-radius:12px;padding:12px 14px;box-shadow:0 6px 22px rgba(0,0,0,.5);">
  <div style="font-weight:800;letter-spacing:.2px;font-size:14px;margin-bottom:6px;">Planning Area: ${name}</div>
  <div style="opacity:.8;font-size:11px;margin-bottom:6px;">Planning Area — Numbers</div>
  <ul style="list-style:none;padding:0;margin:0 0 8px 0;font-size:12px;line-height:1.35;">
    <li>Area: <b>${fmtFloat(area, 2)}</b> km²</li>
    <li>Population: <b>${fmtNum(pop)}</b></li>
    <li>No. Of Floods: <b>${fmtNum(floods)}</b> | Rank <b>#${rFC}</b> / ${tot}</li>
    <li>No. Of Amenities: <b>${fmtNum(amen)}</b> | Rank <b>#${rAC}</b> / ${tot}</li>
  </ul>
  <div style="opacity:.8;font-size:11px;margin-bottom:6px;">Planning Area — Statistics</div>
  <ul style="list-style:none;padding:0;margin:0;font-size:12px;line-height:1.35;">
    <li>Flood Density: <b>${fmtFloat(densF)}</b> / km² | Rank <b>#${rFD}</b></li>
    <li>Amenities Density: <b>${fmtFloat(densA)}</b> / km² | Rank <b>#${rAD}</b></li>
  </ul>
</div>`;
      };

      const SZ_HTML = (p) => {
        const stats = popupStatsRef.current || {};
        const {
          szFloodsCount = {},
          szFloodsDensity = {},
          szAmenCount = {},
          szAmenDensity = {},
          szRankFloodsCount = {},
          szRankFloodsDensity = {},
          szRankAmenCount = {},
          szRankAmenDensity = {},
          perPA_SZ_Ranks: perRanks = {},
        } = stats;
        const rawSZ = toS(getProp(p, SZ_NAME_KEYS));
        const rawPA = toS(getProp(p, PA_NAME_KEYS));
        const szName = toTitle(rawSZ);
        const paName = toTitle(rawPA);
        const area   = p.area != null ? +p.area : (p.area_km2 != null ? +p.area_km2 : null);

        const floods = +szFloodsCount[rawSZ] || 0;
        const densF  = +szFloodsDensity[rawSZ] || 0;
        const amen   = +szAmenCount[rawSZ] || 0;
        const densA  = +szAmenDensity[rawSZ] || 0;

        const gFC = szRankFloodsCount.ranks[rawSZ] || "–";
        const gFD = szRankFloodsDensity.ranks[rawSZ] || "–";
        const gAC = szRankAmenCount.ranks[rawSZ] || "–";
        const gAD = szRankAmenDensity.ranks[rawSZ] || "–";
        const gTot = szRankFloodsCount.total || 0;

        const within = perRanks[rawPA] || {};
        const wFC = within.floodsCount?.ranks?.[rawSZ] || "–";
        const wFD = within.floodsDensity?.ranks?.[rawSZ] || "–";
        const wAC = within.amenCount?.ranks?.[rawSZ] || "–";
        const wAD = within.amenDensity?.ranks?.[rawSZ] || "–";
        const wTot = within.floodsCount?.total || 0;

        return `
<div style="min-width:260px;max-width:360px;background:#0b1220;color:#e5e7eb;border-radius:12px;padding:12px 14px;box-shadow:0 6px 22px rgba(0,0,0,.5);">
  <div style="font-weight:800;letter-spacing:.2px;font-size:14px;margin-bottom:2px;">Subzone: ${szName}</div>
  <div style="font-size:12px;opacity:.85;margin-bottom:8px;">Planning Area: ${paName}</div>
  <div style="opacity:.8;font-size:11px;margin-bottom:6px;">Subzone — Numbers</div>
  <ul style="list-style:none;padding:0;margin:0 0 8px 0;font-size:12px;line-height:1.35;">
    <li>Area: <b>${fmtFloat(area, 2)}</b> km²</li>
    <li>No. Of Floods: <b>${fmtNum(floods)}</b> | Global <b>#${gFC}</b> / ${gTot} | Within PA <b>#${wFC}</b> / ${wTot}</li>
    <li>No. Of Amenities: <b>${fmtNum(amen)}</b> | Global <b>#${gAC}</b> / ${gTot} | Within PA <b>#${wAC}</b> / ${wTot}</li>
  </ul>
  <div style="opacity:.8;font-size:11px;margin-bottom:6px;">Subzone — Statistics</div>
  <ul style="list-style:none;padding:0;margin:0;font-size:12px;line-height:1.35;">
    <li>Flood Density: <b>${fmtFloat(densF)}</b> / km² | Global <b>#${gFD}</b> | Within PA <b>#${wFD}</b></li>
    <li>Amenities Density: <b>${fmtFloat(densA)}</b> / km² | Global <b>#${gAD}</b> | Within PA <b>#${wAD}</b></li>
  </ul>
</div>`;
      };

      // hover handlers
      map.on("mousemove", PA_FILL, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        paPopupRef.current.setLngLat(e.lngLat).setHTML(PA_HTML(feature.properties || {})).addTo(map);
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", PA_FILL, () => {
        paPopupRef.current?.remove();
        map.getCanvas().style.cursor = "";
      });

      map.on("mousemove", SZ_FILL, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        szPopupRef.current.setLngLat(e.lngLat).setHTML(SZ_HTML(feature.properties || {})).addTo(map);
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", SZ_FILL, () => {
        szPopupRef.current?.remove();
        map.getCanvas().style.cursor = "";
      });

      const showMarkerPopup = (lngLat, html) => {
        if (!markerPopupRef.current) return;
        markerPopupRef.current.setLngLat(lngLat).setHTML(html).addTo(map);
      };

      if (map.getLayer(FLOOD_POINTS)) {
        map.on("mousemove", FLOOD_POINTS, (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          showMarkerPopup(e.lngLat, FLOOD_POINT_HTML(feature.properties || {}));
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", FLOOD_POINTS, () => {
          markerPopupRef.current?.remove();
          map.getCanvas().style.cursor = "";
        });
      }

      if (map.getLayer(AMENITY_POINTS)) {
        map.on("mousemove", AMENITY_POINTS, (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          showMarkerPopup(e.lngLat, AMENITY_POINT_HTML(feature.properties || {}));
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", AMENITY_POINTS, () => {
          markerPopupRef.current?.remove();
          map.getCanvas().style.cursor = "";
        });
      }

      // click: drill into pa
      map.on("click", PA_FILL, (e) => {
        const f = e.features?.[0];
        const paName = toS(getProp(f?.properties, PA_NAME_KEYS));
        if (!paName) return;
        onPlanningAreaToggle?.(paName);
        const b = computeBounds(f.geometry);
        if (b) map.fitBounds(b, { padding: 48, duration: 700, maxZoom: 13 });
      });

      const handleBackgroundClick = (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [PA_FILL] });
        if (features && features.length) return;
        // Don't clear selected planning areas when clicking outside
        // Just close popups
        try { paPopupRef.current?.remove(); } catch {}
        try { szPopupRef.current?.remove(); } catch {}
      };

      const FLOOD_POINT_HTML = (p) => {
        const title = toTitle(p.event || p.flood_type || "Flood Event");
        const paName = toTitle(getProp(p, FLOOD_PA_NAME_KEYS));
        const subName = toTitle(p.origin_subzone || p.subzone || p.start_subzone || p.end_subzone);
        const date = p.event_date_iso || p.event_date || p.date || p.dt || null;
        const location = p.location || p.address || p.origin_road || p.start_street_name || "";
        return `
<div style="min-width:220px;max-width:320px;background:#0b1220;color:#e5e7eb;border-radius:12px;padding:10px 12px;box-shadow:0 6px 22px rgba(0,0,0,.5);">
  <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${title}</div>
  <ul style="list-style:none;margin:0;padding:0;font-size:12px;line-height:1.4;">
    ${date ? `<li><strong>Date:</strong> ${date}</li>` : ""}
    ${paName ? `<li><strong>Planning Area:</strong> ${paName}</li>` : ""}
    ${subName ? `<li><strong>Subzone:</strong> ${subName}</li>` : ""}
    ${location ? `<li><strong>Location:</strong> ${location}</li>` : ""}
  </ul>
</div>`;
      };

      const AMENITY_POINT_HTML = (p) => {
        const name = toTitle(p.amenity_name || p.name || p.display_name || "Amenity");
        const category = toTitle(p.amenity_category || p.category || "Amenity");
        const type = toTitle(p.amenity_type || p.type || "");
        const paName = toTitle(getProp(p, AMEN_PA_NAME_KEYS));
        const subName = toTitle(p.subzone || "");
        return `
<div style="min-width:220px;max-width:320px;background:#0b1220;color:#e5e7eb;border-radius:12px;padding:10px 12px;box-shadow:0 6px 22px rgba(0,0,0,.5);">
  <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${name}</div>
  <ul style="list-style:none;margin:0;padding:0;font-size:12px;line-height:1.4;">
    <li><strong>Category:</strong> ${category}</li>
    ${type ? `<li><strong>Type:</strong> ${type}</li>` : ""}
    ${paName ? `<li><strong>Planning Area:</strong> ${paName}</li>` : ""}
    ${subName ? `<li><strong>Subzone:</strong> ${subName}</li>` : ""}
  </ul>
</div>`;
      };
      map.on("click", handleBackgroundClick);

      map.on("remove", () => {
        map.off("click", handleBackgroundClick);
      });
    });

    map.on("error", (ev) => console.warn("[map error]", ev?.error || ev));

    return () => {
      try { paPopupRef.current?.remove(); } catch {}
      try { szPopupRef.current?.remove(); } catch {}
      try { markerPopupRef.current?.remove(); } catch {}
      try { map.remove(); } catch {}
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []); 
  
  /* keep sources current */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.getSource(PA_SRC)?.setData(planningFC);
    if (map.getSource(SZ_SRC)) map.getSource(SZ_SRC)?.setData(subzoneFC);
    if (map.getSource(FLOODS_SRC)) map.getSource(FLOODS_SRC)?.setData(floodFC);
    if (map.getSource(ROAD_SRC)) map.getSource(ROAD_SRC)?.setData(roadFC);
    if (map.getSource(AMENITIES_SRC)) map.getSource(AMENITIES_SRC)?.setData(amenitiesFC);
  }, [planningFC, subzoneFC, floodFC, roadFC, amenitiesFC]);

  /* paints + visibility updates */
    /* paints + visibility updates */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const filterAll = ["all"];
    const filterNone = ["boolean", false];
    const selectedSubzonesList = (selectedSubzones || []).map(toS).filter(Boolean);
    const showDetailLayers = hasPASelection && (!isAllPASelected || selectedSubzonesList.length > 0);

    const paFilterExpr = !hasPASelection
      ? filterNone
      : (isAllPASelected ? filterAll : matchFilter("PLN_AREA_N", paFilterValues));

    const subzoneFilterExpr = selectedSubzonesList.length
      ? matchFilter("SUBZONE_N", selectedSubzones)
      : filterAll;

    const combinedSubzoneFilter = !hasPASelection
      ? filterNone
      : (isAllPASelected
          ? (selectedSubzonesList.length ? subzoneFilterExpr : filterAll)
          : (selectedSubzonesList.length
              ? ["all", matchFilter("PLN_AREA_N", paFilterValues), subzoneFilterExpr]
              : matchFilter("PLN_AREA_N", paFilterValues)));

    const valueMapPA =
      metric === "flood_density"    ? paFloodsDensity
      : metric === "amenity_count"  ? paAmenCount
      : metric === "amenity_density"? paAmenDensity
      : paFloodsCount;

    const valueMapSZ =
      metric === "flood_density"    ? szFloodsDensity
      : metric === "amenity_count"  ? szAmenCount
      : metric === "amenity_density"? szAmenDensity
      : szFloodsCount;

    // --- planning area choropleth ---
    const paVis = showChoropleth ? "visible" : "none";
    if (map.getLayer(PA_FILL)) {
      const { expr } = buildChoropleth(valueMapPA, "PLN_AREA_N");
      map.setLayoutProperty(PA_FILL, "visibility", paVis);
      map.setPaintProperty(PA_FILL, "fill-color", expr);
      map.setFilter(PA_FILL, paFilterExpr);
    }
    if (map.getLayer(PA_OUTLINE)) {
      map.setLayoutProperty(PA_OUTLINE, "visibility", paVis);
      map.setFilter(PA_OUTLINE, paFilterExpr);
    }

    // --- subzone choropleth ---
    const szVis = showChoropleth && showDetailLayers ? "visible" : "none";
    if (map.getLayer(SZ_FILL)) {
      map.setLayoutProperty(SZ_FILL, "visibility", szVis);
      map.setFilter(SZ_FILL, combinedSubzoneFilter);
      const { expr } = buildChoropleth(valueMapSZ, "SUBZONE_N");
      map.setPaintProperty(SZ_FILL, "fill-color", expr);
    }
    if (map.getLayer(SZ_OUTLINE)) {
      map.setLayoutProperty(SZ_OUTLINE, "visibility", szVis);
      map.setFilter(SZ_OUTLINE, combinedSubzoneFilter);
    }

    // --- bubbles (PA vs SZ) ---
    const paBubbleVis = showChoropleth && !showDetailLayers ? "visible" : "none";
    const szBubbleVis = showChoropleth && showDetailLayers ? "visible" : "none";

    if (map.getSource(PA_CENTROIDS_SRC)) {
      map.getSource(PA_CENTROIDS_SRC).setData(paBubbleFC);
    }
    if (map.getSource(SZ_CENTROIDS_SRC)) {
      map.getSource(SZ_CENTROIDS_SRC).setData(szBubbleFC);
    }

    if (map.getLayer(PA_BUBBLE_CIRCLES)) {
      map.setLayoutProperty(PA_BUBBLE_CIRCLES, "visibility", paBubbleVis);
    }
    if (map.getLayer(PA_BUBBLE_LABELS)) {
      map.setLayoutProperty(PA_BUBBLE_LABELS, "visibility", paBubbleVis);
    }

    if (map.getLayer(SZ_BUBBLE_CIRCLES)) {
      map.setLayoutProperty(SZ_BUBBLE_CIRCLES, "visibility", szBubbleVis);
      const filters = [];
      if (!isAllPASelected) filters.push(matchFilter("pa_name", paFilterValues));
      if (selectedSubzonesList.length) filters.push(matchFilter("name", selectedSubzonesList));
      const finalFilter = !filters.length ? filterAll : ["all", ...filters];
      map.setFilter(SZ_BUBBLE_CIRCLES, finalFilter);
    }
    if (map.getLayer(SZ_BUBBLE_LABELS)) {
      map.setLayoutProperty(SZ_BUBBLE_LABELS, "visibility", szBubbleVis);
      const filters = [];
      if (!isAllPASelected) filters.push(matchFilter("pa_name", paFilterValues));
      if (selectedSubzonesList.length) filters.push(matchFilter("name", selectedSubzonesList));
      const finalFilter = !filters.length ? filterAll : ["all", ...filters];
      map.setFilter(SZ_BUBBLE_LABELS, finalFilter);
    }

    // --- points & heatmap filters ---
    const floodTypeValues = (selectedFloodTypes || []).map(toLC).filter(Boolean);
    const amenCategoryValues = (selectedAmenityCategories || []).map(toS).filter(Boolean);
    const amenTypeValues = (selectedAmenityTypes || []).map(toS).filter(Boolean);

    const floodFilters = [];
    if (hasPASelection && !isAllPASelected) {
      floodFilters.push(anyKeyEqualsFilter(FLOOD_PA_NAME_KEYS, paFilterValues));
    }
    if (selectedSubzonesList.length) {
      floodFilters.push(anyKeyEqualsFilter(SZ_NAME_KEYS, selectedSubzonesList));
    }
    if (floodTypeValues.length) {
      floodFilters.push([
        "in",
        ["downcase", ["coalesce", ["get", "event"], ["get", "flood_type"], ""]],
        ["literal", floodTypeValues],
      ]);
    }
    const floodDateExpr = [
      "to-string",
      [
        "coalesce",
        ["get", "event_date_iso"],
        ["get", "event_date"],
        ["get", "date"],
        ["get", "dt"],
        "",
      ],
    ];
    if (floodDateFrom) {
      floodFilters.push([">=", floodDateExpr, floodDateFrom]);
    }
    if (floodDateTo) {
      floodFilters.push(["<=", floodDateExpr, floodDateTo]);
    }

    const amenFilters = [];
    if (hasPASelection && !isAllPASelected) {
      amenFilters.push(anyKeyEqualsFilter(AMEN_PA_NAME_KEYS, paFilterValues));
    }
    if (selectedSubzonesList.length) {
      amenFilters.push(anyKeyEqualsFilter(SZ_NAME_KEYS, selectedSubzonesList));
    }
    if (amenCategoryValues.length) {
      amenFilters.push(matchFilter("amenity_category", amenCategoryValues));
    }
    if (amenTypeValues.length) {
      amenFilters.push(matchFilter("amenity_type", amenTypeValues));
    }

    const floodFilterExpr = !hasPASelection
      ? filterNone
      : (floodFilters.length ? ["all", ...floodFilters] : filterAll);

    const amenityFilterExpr = !hasPASelection
      ? filterNone
      : (amenFilters.length ? ["all", ...amenFilters] : filterAll);

    if (map.getLayer(FLOOD_POINTS)) {
      map.setLayoutProperty(FLOOD_POINTS, "visibility", showFloodMarkers ? "visible" : "none");
      map.setFilter(FLOOD_POINTS, floodFilterExpr);
    }
    if (map.getLayer(AMENITY_POINTS)) {
      map.setLayoutProperty(AMENITY_POINTS, "visibility", showAmenityMarkers ? "visible" : "none");
      map.setFilter(AMENITY_POINTS, amenityFilterExpr);
    }
    if (map.getLayer(FLOOD_HEAT)) {
      map.setLayoutProperty(FLOOD_HEAT, "visibility", showKDE ? "visible" : "none");
      map.setPaintProperty(FLOOD_HEAT, "heatmap-intensity", kdeIntensity);
      map.setPaintProperty(FLOOD_HEAT, "heatmap-radius", [
        "interpolate",
        ["linear"],
        ["zoom"],
        8, Math.max(5, kdeRadius * 0.6),
        12, kdeRadius,
        15, Math.min(80, kdeRadius * 1.6),
      ]);
      map.setFilter(FLOOD_HEAT, floodFilterExpr);
    }

    if (map.getLayer(ROAD_LINE)) {
      if (showDetailLayers) {
        const roadFilter = isAllPASelected
          ? filterAll
          : anyKeyEqualsFilter(ROAD_PA_NAME_KEYS, paFilterValues);
        map.setLayoutProperty(ROAD_LINE, "visibility", "visible");
        map.setFilter(ROAD_LINE, roadFilter);
      } else {
        map.setLayoutProperty(ROAD_LINE, "visibility", "none");
        map.setFilter(ROAD_LINE, filterNone);
      }
    }
  }, [
    metric,
    showChoropleth,
    showFloodMarkers,
    showAmenityMarkers,
    showKDE,
    kdeRadius,
    kdeIntensity,
    selectedPlanningAreas,
    selectedSubzones,
    selectedFloodTypes,
    selectedAmenityCategories,
    selectedAmenityTypes,
    floodDateFrom,
    floodDateTo,
    paFloodsCount,
    paFloodsDensity,
    paAmenCount,
    paAmenDensity,
    szFloodsCount,
    szFloodsDensity,
    szAmenCount,
    szAmenDensity,
    paBubbleFC,
    szBubbleFC,
    hasPASelection,
    isAllPASelected,
    paFilterValues,
  ]);

  /* external subzone select → zoom */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !selectedSubzone) return;
    const b = computeBounds(selectedSubzone.geometry || null);
    if (b) map.fitBounds(b, { padding: 48, duration: 700, maxZoom: 14 });
  }, [selectedSubzone]);

  /* planning area selection → zoom */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    // If one or more planning areas selected, zoom to them (stay at planning area level)
    if (selectedPlanningAreas.length >= 1) {
      const selectedFeatures = planningFC.features.filter(f => {
        const paName = toS(getProp(f.properties, PA_NAME_KEYS));
        return selectedPlanningAreas.map(toS).includes(paName);
      });

      if (selectedFeatures.length > 0) {
        // Compute combined bounds for all selected planning areas
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;

        for (const feature of selectedFeatures) {
          const b = computeBounds(feature.geometry);
          if (b) {
            const [[x1, y1], [x2, y2]] = b;
            if (x1 < minx) minx = x1;
            if (y1 < miny) miny = y1;
            if (x2 > maxx) maxx = x2;
            if (y2 > maxy) maxy = y2;
          }
        }

        if (Number.isFinite(minx) && Number.isFinite(maxx)) {
          // When multiple planning areas selected, stay at planning area level (maxZoom: 13)
          // Don't zoom into subzone level
          map.fitBounds([[minx, miny], [maxx, maxy]], {
            padding: 48,
            duration: 700,
            maxZoom: selectedPlanningAreas.length > 1 ? 12 : 13  // Lower zoom for multiple PAs
          });
        }
      }
    }
    // If no planning areas selected, reset to default view
    else if (selectedPlanningAreas.length === 0) {
      map.easeTo({ center: default_center, zoom: default_zoom, duration: 600 });
    }
  }, [selectedPlanningAreas, planningFC]);

  /* resize */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    // Add small delay to ensure DOM has updated before resizing
    const timeoutId = setTimeout(() => {
      try { map.resize(); } catch {}
    }, 50);
    return () => clearTimeout(timeoutId);
  }, [resizeSignal]);

  /* legend values (choropleth) — now respects selected subzones */
  const ticks = useMemo(
    () => legendBreaks(Object.values(legendValueMap).reduce((a,b)=>Math.max(a,+b||0),1)),
    [legendValueMap]
  );
  const legendItems = CHORO_RAMP.map((c, i) => {
    const a = ticks[i] ?? 0;
    const b = ticks[i + 1] ?? ticks[ticks.length - 1];
    const label = i === CHORO_RAMP.length - 1 ? `≥ ${formatTick(a)}${metric.endsWith("_density") ? " / km²" : ""}` : `${formatTick(a)}–${formatTick(b)}${metric.endsWith("_density") ? " / km²" : ""}`;
    return { c, label };
  });

  const hasSelection = hasPASelection;

  return (
    <div className="relative w-full h-[95dvh]">
      <div ref={containerRef} className="absolute inset-0 map-container" />

      {/* settings (top-right) */}
      <div className="absolute right-3 top-3 z-10 rounded-lg bg-slate-900/90 border border-white/10 p-2 text-xs text-slate-200 min-w-[280px]">
        <div className="font-semibold mb-1">Settings</div>
        <div className="grid grid-cols-1 gap-2">
          <label className="flex items-center justify-between gap-2">
            <span className="opacity-90">Metric</span>
            <select value={metric} onChange={(e) => setMetric(e.target.value)} className="bg-white/90 text-slate-900 rounded px-2 py-1">
              <option value="flood_count">Flood Count</option>
              <option value="flood_density">Flood Density</option>
              <option value="amenity_count">Amenity Count</option>
              <option value="amenity_density">Amenity Density</option>
            </select>
          </label>

          <label className="flex items-center justify-between gap-2">
            <span className="opacity-90">Show Choropleth</span>
            <input type="checkbox" checked={showChoropleth} onChange={(e) => setShowChoropleth(e.target.checked)} className="accent-white" />
          </label>

          <label className="flex items-center justify-between gap-2">
            <span className="opacity-90">Show Flood Markers</span>
            <input type="checkbox" checked={showFloodMarkers} onChange={(e) => setShowFloodMarkers(e.target.checked)} className="accent-white" />
          </label>

          <label className="flex items-center justify-between gap-2">
            <span className="opacity-90">Show Amenity Markers</span>
            <input type="checkbox" checked={showAmenityMarkers} onChange={(e) => setShowAmenityMarkers(e.target.checked)} className="accent-white" />
          </label>

          <div className="h-px bg-white/10 my-1" />

          <label className="flex items-center justify-between gap-2">
            <span className="opacity-90">Show KDE (Flood Heat)</span>
            <input type="checkbox" checked={showKDE} onChange={(e) => setShowKDE(e.target.checked)} className="accent-white" />
          </label>

          <div className={`grid gap-1 ${showKDE ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
            <label className="flex items-center justify-between gap-2">
              <span className="opacity-90">Radius</span>
              <input type="range" min={6} max={70} value={kdeRadius} onChange={(e) => setKdeRadius(+e.target.value)} className="w-36" />
              <span className="tabular-nums">{kdeRadius}px</span>
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="opacity-90">Intensity</span>
              <input type="range" step={0.05} min={0.1} max={2} value={kdeIntensity} onChange={(e) => setKdeIntensity(+e.target.value)} className="w-36" />
              <span className="tabular-nums">{kdeIntensity.toFixed(2)}</span>
            </label>
          </div>
        </div>
      </div>

      {/* choropleth legend (bottom-left) */}
      {showChoropleth && (
        <div className="absolute left-3 bottom-3 z-10 rounded-lg bg-slate-900/90 border border-white/10 px-3 py-2 text-xs text-slate-200">
          <div className="font-semibold">
            {hasSelection
              ? (metric.includes("amenity") ? "Amenities (Subzone Choropleth)" : "Floods (Subzone Choropleth)")
              : (metric.includes("amenity") ? "Amenities (Planning Area Choropleth)" : "Floods (Planning Area Choropleth)")}
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {legendItems.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="inline-block h-3 w-5 rounded" style={{ backgroundColor: it.c }} />
                <span className="tabular-nums">{it.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            Filtered To Selected Planning Areas{subzoneFC.features?.length ? (hasSZSelection ? " / Subzones" : "") : ""}
          </div>
        </div>
      )}

      {/* heatmap legend (bottom-right) – only when kde is on */}
      {showKDE && (
        <div className="absolute right-3 bottom-3 z-10 rounded-lg bg-slate-900/90 border border-white/10 p-3 text-xs text-slate-200 w-[220px]">
          <div className="font-semibold mb-2">Flood KDE (Heatmap)</div>
          <div className="w-full h-3 rounded overflow-hidden" style={{
            background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, #fee2e2 20%, #fecaca 40%, #fca5a5 60%, #ef4444 80%, #991b1b 100%)"
          }} />
          <div className="flex justify-between mt-1 text-[10px]">
            <span>Low</span><span>High</span>
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            Radius {kdeRadius}px · Intensity {kdeIntensity.toFixed(2)}
          </div>
        </div>
      )}

      {/* remove popup chrome */}
      <style>{`
        .mapboxgl-popup.dark-popup .mapboxgl-popup-content { background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
        .mapboxgl-popup.dark-popup .mapboxgl-popup-tip { display: none !important; }
      `}</style>
    </div>
  );
}
