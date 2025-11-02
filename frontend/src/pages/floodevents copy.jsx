// src/components/floodevents.jsx
"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useMapData } from "@/context/MapDataContext";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { AreaChart, Area, XAxis, YAxis, Tooltip, Brush, ResponsiveContainer } from "recharts";
import * as turf from "@turf/turf";

mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";

/* ---------- tiny utils ---------- */
const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};
const fmt = (v, d = 6) => (Number.isFinite(+v) ? (+v).toFixed(d) : "—");
const dateInRange = (dt, from, to) => {
  if (!dt) return true;
  if (from && dt < from) return false;
  if (to && dt > to) return false;
  return true;
};

function awaitStyle(map) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded && map.isStyleLoaded()) return resolve();
    const onLoad = () => { map.off("load", onLoad); resolve(); };
    map.on("load", onLoad);
  });
}

function buildBoundsFromFloods(fc) {
  const b = new mapboxgl.LngLatBounds();
  let had = false;
  for (const f of fc?.features || []) {
    const p = f.properties || {};
    const lng = toNum(p.start_lng);
    const lat = toNum(p.start_lat);
    if (!Number.isNaN(lng) && !Number.isNaN(lat)) {
      b.extend([lng, lat]);
      had = true;
    }
  }
  return had ? b : null;
}

/* draw detail (origin/start/pred a/pred b/end) */
function buildFloodDetail(p) {
  const origin = [toNum(p.origin_lng), toNum(p.origin_lat)];
  const start = [toNum(p.start_lng), toNum(p.start_lat)];
  const predA = [toNum(p.end100_a_lng), toNum(p.end100_a_lat)];
  const predB = [toNum(p.end100_b_lng), toNum(p.end100_b_lat)];
  const end = [toNum(p.end_lng), toNum(p.end_lat)];
  const has = (xy) => !Number.isNaN(xy?.[0]) && !Number.isNaN(xy?.[1]) && Math.abs(xy[0]) <= 180 && Math.abs(xy[1]) <= 90;

  const points = [];
  if (has(origin)) points.push({ role: "origin", coord: origin });
  if (has(start)) points.push({ role: "start", coord: start });
  if (has(predA)) points.push({ role: "pred_a", coord: predA });
  if (has(predB)) points.push({ role: "pred_b", coord: predB });
  if (has(end)) points.push({ role: "end", coord: end });

  const seg = (a, b, role) => (has(a) && has(b) ? [{ role, a, b }] : []);
  const lines = [
    ...seg(origin, start, "origin_to_start"),
    ...seg(start, predA, "start_to_pred_a"),
    ...seg(start, predB, "start_to_pred_b"),
    ...seg(predA, end, "pred_a_to_end"),
    ...seg(predB, end, "pred_b_to_end"),
    ...(!has(end) && has(predA) && has(predB) ? seg(predA, predB, "pred_a_to_pred_b") : []),
  ];

  const center = has(start) ? start : (has(origin) ? origin : points[0]?.coord);
  return { points, lines, center };
}

/* ---------- popup html ---------- */
function floodPopupHTML(p = {}) {
  const safe = (x) => (x ?? "—");
  const typ = (p.event || "").replace("_", " ");
  const road = p.start_road || p.parent_road || "—";
  return `
    <div>
      <div class="text-xs uppercase opacity-70">flood</div>
      <div><b>id:</b> ${safe(p.id)}</div>
      <div><b>date:</b> ${safe(p.event_date)}</div>
      <div><b>type:</b> ${safe(typ)}</div>
      <div><b>road:</b> ${safe(road)}</div>
      <div class="mt-1 text-xs opacity-70">
        start: ${fmt(p.start_lat)}, ${fmt(p.start_lng)}
      </div>
      <div class="mt-1 text-xs opacity-70">
        pred a: ${fmt(p.end100_a_lat)}, ${fmt(p.end100_a_lng)}<br/>
        pred b: ${fmt(p.end100_b_lat)}, ${fmt(p.end100_b_lng)}<br/>
        end: ${fmt(p.end_lat)}, ${fmt(p.end_lng)}
      </div>
    </div>
  `;
}

/* month palette for spatio-temporal points */
const MONTH_PALETTE = ["#2563eb","#059669","#b45309","#7c3aed","#dc2626","#0f766e","#d97706","#9333ea","#16a34a","#ea580c","#e11d48","#0891b2"];

/* ---------- turf helpers (isochrones + banding) ---------- */
const steps = 128;
const m = (x) => x; // readability

function makeCircle(centerLngLat, radiusM) {
  return turf.circle(centerLngLat, radiusM, { steps, units: "meters" });
}

function bandPredicate(featurePoint, centerLngLat, rInner, rOuter) {
  const dKm = turf.distance(centerLngLat, featurePoint, { units: "kilometers" });
  const d = dKm * 1000;
  if (d <= rInner) return "inner";
  if (d <= rOuter) return "outer";
  return null;
}

/* ===== component ===== */
export default function floodevents() {
  const {
    floods_fc_enriched: floodsFC,
    amenity_fc_raw: amenityFC,
    road_fc_enriched: roadFC, // kept if you still want to visualize road segments
  } = useMapData();

  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const popupRef = useRef(null);

  /* selection */
  const [selected, setSelected] = useState(null);
  const [selectedProps, setSelectedProps] = useState(null);

  /* ring filter for side panel */
  const [ringFilter, setRingFilter] = useState("all"); // "all" | "inner" | "outer"

  /* amenities panel expanded/collapsed */
  const [amenitiesOpen, setAmenitiesOpen] = useState(true);

  function clearSelection() {
    setSelected(null);
    setSelectedProps(null);
    setRingFilter("all");
    try { popupRef.current?.remove(); } catch {}
    const map = mapRef.current;
    if (map) {
      try {
        map.setFilter("flood-points", ["all", ["!", ["has", "point_count"]]]);
        map.setLayoutProperty("flood-clusters", "visibility", "visible");
        map.setLayoutProperty("flood-cluster-count", "visibility", "visible");
        map.setLayoutProperty("flood-selected-points", "visibility", "none");
        map.setLayoutProperty("flood-selected-lines-casing", "visibility", "none");
        map.setLayoutProperty("flood-selected-lines", "visibility", "none");
        map.setLayoutProperty("flood-selected-labels", "visibility", "none");

        // rings + proximity amenities off
        map.setLayoutProperty("iso-200-fill", "visibility", "none");
        map.setLayoutProperty("iso-400-fill", "visibility", "none");
        map.setLayoutProperty("iso-200-line", "visibility", "none");
        map.setLayoutProperty("iso-400-line", "visibility", "none");
        map.setLayoutProperty("amenities-200", "visibility", "none");
        map.setLayoutProperty("amenities-400", "visibility", "none");
        map.setLayoutProperty("amenities-labels", "visibility", "none");
        map.setFilter("amenities-200", null);
        map.setFilter("amenities-400", null);
        map.setFilter("amenities-labels", null);
      } catch {}
    }
  }

  /* indices (optional road viz) */
  const roadsById = useMemo(() => {
    const idx = new Map();
    for (const f of roadFC?.features || []) {
      const rn = f?.properties?.rn_id ?? f?.properties?.RN_ID ?? null;
      if (rn == null) continue;
      const key = String(rn);
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(f);
    }
    return idx;
  }, [roadFC]);

  /* filters */
  const [q, setQ] = useState("");
  const [eventType, setEventType] = useState("all");
  const [fromStr, setFromStr] = useState("");
  const [toStr, setToStr] = useState("");
  const [paFilter, setPaFilter] = useState("all");
  const [szFilter, setSzFilter] = useState("all");

  const fromDate = useMemo(() => (fromStr ? new Date(fromStr) : null), [fromStr]);
  const toDate = useMemo(() => (toStr ? new Date(toStr) : null), [toStr]);
  const tsFrom = useMemo(() => (fromDate ? +fromDate : null), [fromDate]);
  const tsTo = useMemo(() => (toDate ? +toDate : null), [toDate]);

  /* kde / spatio-temporal prep */
  const floodsPointsFC = useMemo(() => {
    const feats = [];
    for (const f of floodsFC?.features || []) {
      const p = f.properties || {};
      const lng = toNum(p.start_lng);
      const lat = toNum(p.start_lat);
      if (Number.isNaN(lng) || Number.isNaN(lat)) continue;
      let ts = null;
      if (p.event_date_iso) ts = +new Date(p.event_date_iso);
      else if (p.event_date) ts = +new Date(p.event_date);
      if (!Number.isFinite(ts)) ts = null;
      const month = Number.isFinite(ts) ? new Date(ts).getMonth() : null;
      feats.push({
        type: "Feature",
        properties: {
          id: String(p.id ?? f.id ?? ""),
          event: p.event || "",
          planning_area: p.start_planning_area || "",
          subzone: p.start_subzone || "",
          ts, month,
        },
        geometry: { type: "Point", coordinates: [lng, lat] },
      });
    }
    return { type: "FeatureCollection", features: feats };
  }, [floodsFC]);

  /* kde style */
  const [kdePreset, setKdePreset] = useState("g");
  const kdePaint = useMemo(() => {
    const basecolors = [
      "interpolate", ["linear"], ["heatmap-density"],
      0,   "rgba(33, 102, 172, 0)",
      0.2, "rgb(103, 169, 207)",
      0.4, "rgb(209, 229, 240)",
      0.6, "rgb(253, 219, 199)",
      0.8, "rgb(239, 138, 98)",
      1,   "rgb(178, 24, 43)"
    ];
    switch (kdePreset) {
      case "k": return { "heatmap-weight": 1,   "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 13, 1.0, 15, 1.2], "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 10, 13, 18, 15, 24], "heatmap-opacity": 0.85, "heatmap-color": basecolors };
      case "l": return { "heatmap-weight": 0.8, "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.4, 13, 0.8, 15, 1.0], "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 16, 13, 26, 15, 34], "heatmap-opacity": 0.75, "heatmap-color": basecolors };
      case "d": return { "heatmap-weight": 1.1, "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 13, 1.2, 15, 1.4], "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 22, 13, 36, 15, 44], "heatmap-opacity": 0.9,  "heatmap-color": basecolors };
      case "g":
      default:  return { "heatmap-weight": 1,   "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 13, 1.0, 15, 1.2], "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 18, 13, 28, 15, 36], "heatmap-opacity": 0.85, "heatmap-color": basecolors };
    }
  }, [kdePreset]);

  /* view toggle */
  const [viewMode, setViewMode] = useState("points"); // 'points' | 'kde' | 'st'

  /* table prep */
  const enrichedRows = useMemo(() => {
    const fc = floodsFC || { type: "FeatureCollection", features: [] };
    const rows = (fc.features || []).map((f) => {
      const p = f.properties || {};
      const id = String(p.id ?? f.id ?? "");
      const event_date = p.event_date || "";
      const event = p.event || "";
      const location = p.location || "";
      const parent_road = p.parent_road || "";
      const start_postal_code = p.start_postal_code || "";
      const planning_area = p.start_planning_area || "";
      const subzone = p.start_subzone || "";
      const dt = p.event_date_iso ? new Date(p.event_date_iso)
        : (p.event_date ? new Date(p.event_date) : null);
      return { id, event_date, event, dt, location, parent_road, start_postal_code, planning_area, subzone, _props: p };
    });

    Object.defineProperty(rows, "_options", {
      value: {
        eventTypes: ["all", ...Array.from(new Set(rows.map(r => r.event).filter(Boolean))).sort()],
        planningAreas: ["all", ...Array.from(new Set(rows.map(r => r.planning_area).filter(Boolean))).sort()],
        subzones: ["all", ...Array.from(new Set(rows.map(r => r.subzone).filter(Boolean))).sort()],
      },
      enumerable: false,
    });
    return rows;
  }, [floodsFC]);

  const eventTypeOptions = enrichedRows._options?.eventTypes || ["all"];
  const paOptions = enrichedRows._options?.planningAreas || ["all"];
  const szOptions = enrichedRows._options?.subzones || ["all"];

  const filteredRows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return enrichedRows
      .filter((r) =>
        (eventType === "all" || r.event === eventType) &&
        dateInRange(r.dt, fromDate, toDate) &&
        (paFilter === "all" || r.planning_area === paFilter) &&
        (szFilter === "all" || r.subzone === szFilter) &&
        (
          !query ||
          r.id.toLowerCase().includes(query) ||
          r.location.toLowerCase().includes(query) ||
          r.parent_road.toLowerCase().includes(query)
        )
      )
      .sort((a, b) => {
        const ta = a.dt ? a.dt.getTime() : 0;
        const tb = b.dt ? b.dt.getTime() : 0;
        if (tb !== ta) return tb - ta;
        return a.id.localeCompare(b.id);
      });
  }, [enrichedRows, q, eventType, fromDate, toDate, paFilter, szFilter]);

  /* bounds */
  const bounds = useMemo(() => buildBoundsFromFloods(floodsFC), [floodsFC]);

  /* init map */
  useEffect(() => {
    if (!containerRef.current || !floodsFC) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      center: [103.82, 1.35],
      zoom: 11,
      attributionControl: false,
      cooperativeGestures: true,
    });
    mapRef.current = map;

    (async () => {
      await awaitStyle(map);

      // base floods (clustered)
      map.addSource("floods", {
        type: "geojson",
        data: floodsFC,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 40,
        promoteId: "id",
      });

      map.addLayer({
        id: "flood-clusters",
        type: "circle",
        source: "floods",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": ["step", ["get", "point_count"], "#93c5fd", 10, "#60a5fa", 30, "#3b82f6"],
          "circle-radius": ["step", ["get", "point_count"], 14, 10, 20, 30, 26],
          "circle-stroke-color": "#0b1220",
          "circle-stroke-width": 1.2,
          "circle-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "flood-cluster-count",
        type: "symbol",
        source: "floods",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-allow-overlap": true },
        paint: { "text-color": "#0b122a", "text-halo-color": "#ffffff", "text-halo-width": 1.0 },
      });

      map.addLayer({
        id: "flood-points",
        type: "circle",
        source: "floods",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 5,
          "circle-color": "#60a5fa",
          "circle-stroke-color": "#0b1220",
          "circle-stroke-width": 1.25,
          "circle-opacity": 0.95,
        },
        layout: { visibility: "visible" },
      });

      // selection sources/layers
      map.addSource("flood-selected-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("flood-selected-lines",  { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("flood-selected-labels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({
        id: "flood-selected-lines-casing",
        type: "line",
        source: "flood-selected-lines",
        paint: {
          "line-color": "#0b1220",
          "line-opacity": 0.25,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 13, 8, 15, 10],
        },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "flood-selected-lines",
        type: "line",
        source: "flood-selected-lines",
        paint: {
          "line-color": [
            "match",
            ["get", "role"],
            "origin_to_start", "#22c55e",
            "start_to_pred_a", "#f59e0b",
            "start_to_pred_b", "#f59e0b",
            "pred_a_to_end",  "#ef4444",
            "pred_b_to_end",  "#ef4444",
            "pred_a_to_pred_b", "#94a3b8",
            "#f97316",
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 13, 3.5, 15, 4.5],
          "line-opacity": 0.98,
          "line-dasharray": [2, 2],
        },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "flood-selected-points",
        type: "circle",
        source: "flood-selected-points",
        paint: {
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0b1220",
          "circle-color": [
            "match",
            ["get", "role"],
            "origin", "#22c55e",
            "start",  "#3b82f6",
            "pred_a", "#f59e0b",
            "pred_b", "#f59e0b",
            "end",    "#ef4444",
            "#737373",
          ],
        },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "flood-selected-labels",
        type: "symbol",
        source: "flood-selected-labels",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-allow-overlap": true,
          "visibility": "none",
        },
        paint: { "text-color": "#111827", "text-halo-color": "#ffffff", "text-halo-width": 1.0 },
      });

      // roads (optional visual)
      map.addSource("affected-road", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "affected-road",
        type: "line",
        source: "affected-road",
        paint: {
          "line-color": "#38bdf8",
          "line-opacity": 0.45,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 13, 2.0, 15, 3.0],
        },
        layout: { visibility: "none" },
      });

      // global amenities source (all)
      map.addSource("amenities-all", { type: "geojson", data: amenityFC || { type: "FeatureCollection", features: [] } });
      // inner ring ≤200 m
      map.addLayer({
        id: "amenities-200",
        type: "circle",
        source: "amenities-all",
        paint: {
          "circle-radius": 6,
          "circle-color": "#22c55e",
          "circle-opacity": 0.95,
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 1.5,
        },
        layout: { visibility: "none" },
      });
      // outer band 200–400 m
      map.addLayer({
        id: "amenities-400",
        type: "circle",
        source: "amenities-all",
        paint: {
          "circle-radius": 6,
          "circle-color": "#0ea5e9",
          "circle-opacity": 0.95,
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 1.5,
        },
        layout: { visibility: "none" },
      });
      // labels for all within 400 m
      map.addLayer({
        id: "amenities-labels",
        type: "symbol",
        source: "amenities-all",
        layout: {
          "icon-image": "marker-15",
          "icon-size": 1.0,
          "icon-allow-overlap": true,
          "text-field": ["coalesce", ["get", "amenity_short"], ""],
          "text-size": 10,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-allow-overlap": true,
          "visibility": "none",
        },
        paint: { "text-color": "#111827", "text-halo-color": "#ffffff", "text-halo-width": 1.1 },
      });

      // kde + st
      map.addSource("floods-kde", { type: "geojson", data: floodsPointsFC });
      map.addLayer({
        id: "floods-heatmap",
        type: "heatmap",
        source: "floods-kde",
        paint: kdePaint,
        layout: { visibility: "none" },
      }, "flood-points");
      map.addLayer({
        id: "floods-st",
        type: "circle",
        source: "floods-kde",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 13, 5, 15, 7],
          "circle-stroke-color": "#0b1220",
          "circle-stroke-width": 1.0,
          "circle-opacity": 0.95,
          "circle-color": [
            "case",
            ["==", ["typeof", ["get", "month"]], "number"],
            ["match", ["get", "month"],
              0, MONTH_PALETTE[0], 1, MONTH_PALETTE[1], 2, MONTH_PALETTE[2],
              3, MONTH_PALETTE[3], 4, MONTH_PALETTE[4], 5, MONTH_PALETTE[5],
              6, MONTH_PALETTE[6], 7, MONTH_PALETTE[7], 8, MONTH_PALETTE[8],
              9, MONTH_PALETTE[9], 10, MONTH_PALETTE[10], 11, MONTH_PALETTE[11],
              "#6b7280"
            ],
            "#6b7280"
          ],
        },
        layout: { visibility: "none" },
      }, "flood-points");

      // isochrones (200m, 400m)
      map.addSource("iso-200", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("iso-400", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({
        id: "iso-400-fill",
        type: "fill",
        source: "iso-400",
        paint: { "fill-color": "#0ea5e9", "fill-opacity": 0.12 },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "iso-200-fill",
        type: "fill",
        source: "iso-200",
        paint: { "fill-color": "#22c55e", "fill-opacity": 0.18 },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "iso-400-line",
        type: "line",
        source: "iso-400",
        paint: { "line-color": "#0ea5e9", "line-width": 2, "line-opacity": 0.8 },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "iso-200-line",
        type: "line",
        source: "iso-200",
        paint: { "line-color": "#22c55e", "line-width": 2, "line-opacity": 0.9 },
        layout: { visibility: "none" },
      });

      // bounds
      if (bounds) map.fitBounds(bounds, { padding: 40, duration: 0 });

      // hover popups (ephemeral)
      map.on("mousemove", "flood-points", (e) => {
        const f = e?.features?.[0];
        if (!f) return;
        const p = f.properties || {};
        showHoverPopup(e.lngLat, floodPopupHTML(p));
      });
      map.on("mouseleave", "flood-points", () => hidePopup());

      map.on("mousemove", "flood-selected-points", (e) => {
        const f = e?.features?.[0];
        if (!f) return;
        const p = selectedProps || {};
        showHoverPopup(e.lngLat, floodPopupHTML(p));
      });
      map.on("mouseleave", "flood-selected-points", () => hidePopup());

      // click handlers
      map.on("click", "flood-points", (e) => {
        const f = e?.features?.[0];
        const id = f?.properties?.id ?? f?.id;
        if (id != null) focusSelect(String(id));
      });
      map.on("click", "flood-clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["flood-clusters"] });
        const clusterId = features[0]?.properties?.cluster_id;
        const source = map.getSource("floods");
        if (!source || clusterId == null) return;
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: e.lngLat, zoom });
        });
      });
      // empty spot click clears
      map.on("click", (e) => {
        const bbox = [[e.point.x - 2, e.point.y - 2],[e.point.x + 2, e.point.y + 2]];
        const hit = map.queryRenderedFeatures(bbox, {
          layers: [
            "flood-clusters","flood-cluster-count","flood-points","flood-selected-points",
            "flood-selected-labels","amenities-200","amenities-400","amenities-labels",
            "iso-200-fill","iso-400-fill"
          ],
        });
        if (!hit || hit.length === 0) clearSelection();
      });

      updateViewVisibility(map, viewMode);
      map.getSource("floods-kde")?.setData(floodsPointsFC);
      applyKdeFilter(map);
      applySTFilter(map);
    })();

    return () => { try { mapRef.current?.remove(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floodsFC, bounds]);

  // keep amenities source fresh if amenityFC changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try { map.getSource("amenities-all")?.setData(amenityFC || { type:"FeatureCollection", features:[] }); } catch {}
  }, [amenityFC]);

  // esc to clear
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") clearSelection(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // live kde/st data
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try { map.getSource("floods-kde")?.setData(floodsPointsFC); } catch {}
  }, [floodsPointsFC]);

  /* selection focus: one flood + rings + proximity amenities */
  function focusSelect(idStr) {
    setSelected(idStr);

    const feat = (floodsFC?.features || []).find(
      (ft) => String(ft.properties?.id ?? ft.id) === String(idStr)
    );
    if (!feat) return;
    const p = feat.properties || {};
    const { points, lines, center } = buildFloodDetail(p);
    setSelectedProps(p);
    setRingFilter("all");

    const map = mapRef.current;
    if (!map) return;

    // only selected visible in base points; hide clusters
    try {
      map.setFilter("flood-points", [
        "all",
        ["!", ["has", "point_count"]],
        ["==", ["to-string", ["get", "id"]], String(idStr)],
      ]);
      map.setLayoutProperty("flood-clusters", "visibility", "none");
      map.setLayoutProperty("flood-cluster-count", "visibility", "none");
    } catch {}

    // selection sources
    const pointFeatures = points.map(pt => ({
      type: "Feature",
      properties: { role: pt.role, label: pt.role.replace("_", " ") },
      geometry: { type: "Point", coordinates: pt.coord },
    }));
    const lineFeatures = lines.map(l => ({
      type: "Feature",
      properties: { role: l.role },
      geometry: { type: "LineString", coordinates: [l.a, l.b] },
    }));

    try {
      map.getSource("flood-selected-points")?.setData({ type: "FeatureCollection", features: pointFeatures });
      map.getSource("flood-selected-lines")?.setData({ type: "FeatureCollection", features: lineFeatures });
      map.getSource("flood-selected-labels")?.setData({ type: "FeatureCollection", features: pointFeatures });
      map.setLayoutProperty("flood-selected-points", "visibility", pointFeatures.length ? "visible" : "none");
      map.setLayoutProperty("flood-selected-lines-casing", "visibility", lineFeatures.length ? "visible" : "none");
      map.setLayoutProperty("flood-selected-lines", "visibility", lineFeatures.length ? "visible" : "none");
      map.setLayoutProperty("flood-selected-labels", "visibility", pointFeatures.length ? "visible" : "none");
    } catch {}

    // optional: show the road geometry if you have start_rn_id
    const roadId = p.start_rn_id == null ? null : String(p.start_rn_id);
    const roadFeats = roadId ? (roadsById.get(roadId) || []) : [];
    try {
      map.getSource("affected-road")?.setData({
        type: "FeatureCollection",
        features: roadFeats.map(r => ({
          type: "Feature",
          properties: { rn_id: r.properties?.rn_id ?? r.properties?.RN_ID ?? null, name: r.properties?.name || "" },
          geometry: r.geometry,
        })),
      });
      map.setLayoutProperty("affected-road", "visibility", roadFeats.length ? "visible" : "none");
    } catch {}

    // rings + proximity amenities
    if (center) {
      const centerLngLat = center; // [lng, lat]
      const iso200 = makeCircle(centerLngLat, m(200));
      const iso400 = makeCircle(centerLngLat, m(400));

      try {
        map.getSource("iso-200")?.setData(iso200);
        map.getSource("iso-400")?.setData(iso400);
        map.setLayoutProperty("iso-200-fill", "visibility", "visible");
        map.setLayoutProperty("iso-400-fill", "visibility", "visible");
        map.setLayoutProperty("iso-200-line", "visibility", "visible");
        map.setLayoutProperty("iso-400-line", "visibility", "visible");
      } catch {}

      // filter the global amenities to inner and outer bands
      const innerFilter = ["within", iso200];
      const outerFilter = ["all", ["within", iso400], ["!", ["within", iso200]]];

      try {
        map.setFilter("amenities-200", innerFilter);
        map.setFilter("amenities-400", outerFilter);
        map.setFilter("amenities-labels", ["within", iso400]);
        map.setLayoutProperty("amenities-200", "visibility", "visible");
        map.setLayoutProperty("amenities-400", "visibility", "visible");
        map.setLayoutProperty("amenities-labels", "visibility", "visible");
      } catch {}

      // compute counts to show in header chips
      const feats = amenityFC?.features || [];
      let inner = 0, outer = 0;
      for (const a of feats) {
        const c = a.geometry?.coordinates || [];
        if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
        const band = bandPredicate(turf.point(c), centerLngLat, 200, 400);
        if (band === "inner") inner++;
        else if (band === "outer") outer++;
      }
      setSelectedProps(prev => ({ ...(prev || p), _ring_counts: { inner, outer } }));

      // fly
      try { map.flyTo({ center, zoom: 15, essential: true }); } catch {}
    }
  }

  /* hover popup helpers (non-persistent) */
  function showHoverPopup(lngLat, html) {
    hidePopup();
    popupRef.current = new mapboxgl.Popup({
      closeOnClick: false,
      closeButton: false,
      className: "popup-dark",
      offset: 10,
      maxWidth: "320px",
    })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(mapRef.current);
  }
  function hidePopup() {
    try { popupRef.current?.remove(); } catch {}
    popupRef.current = null;
  }

  /* visibility & filters for kde/st */
  function updateViewVisibility(map, mode) {
    const pointsVis = mode === "points" ? "visible" : "none";
    const kdeVis    = mode === "kde"    ? "visible" : "none";
    const stVis     = mode === "st"     ? "visible" : "none";
    try { map.setLayoutProperty("flood-clusters", "visibility", selected ? "none" : pointsVis); } catch {}
    try { map.setLayoutProperty("flood-cluster-count", "visibility", selected ? "none" : pointsVis); } catch {}
    try { map.setLayoutProperty("flood-points", "visibility", pointsVis); } catch {}
    try { map.setLayoutProperty("floods-heatmap", "visibility", kdeVis); } catch {}
    try { map.setLayoutProperty("floods-st", "visibility", stVis); } catch {}

    if (selected != null) {
      try { map.setLayoutProperty("flood-selected-points", "visibility", "visible"); } catch {}
      try { map.setLayoutProperty("flood-selected-lines-casing", "visibility", "visible"); } catch {}
      try { map.setLayoutProperty("flood-selected-lines", "visibility", "visible"); } catch {}
      try { map.setLayoutProperty("flood-selected-labels", "visibility", "visible"); } catch {}
    }
  }

  function commonFilters() {
    const f = ["all"];
    if (tsFrom != null) f.push([">=", ["get", "ts"], tsFrom]);
    if (tsTo   != null) f.push(["<=", ["get", "ts"], tsTo]);
    if (eventType !== "all") f.push(["==", ["get", "event"], eventType]);
    if (paFilter !== "all")  f.push(["==", ["get", "planning_area"], paFilter]);
    if (szFilter !== "all")  f.push(["==", ["get", "subzone"], szFilter]);
    return f;
  }
  function applyKdeFilter(map) { try { map.setFilter("floods-heatmap", commonFilters()); } catch {} }
  function applySTFilter(map)  { try { map.setFilter("floods-st", commonFilters()); } catch {} }

  // react to toggles/filters
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer("floods-heatmap")) {
      for (const [k, v] of Object.entries(kdePaint)) {
        try { map.setPaintProperty("floods-heatmap", k, v); } catch {}
      }
    }
    updateViewVisibility(map, viewMode);
    applyKdeFilter(map);
    applySTFilter(map);
  }, [viewMode, kdePreset, kdePaint, tsFrom, tsTo, eventType, paFilter, szFilter, selected]);

  /* timeline */
  const timelineData = useMemo(() => {
    const bins = new Map();
    for (const f of floodsPointsFC.features) {
      const ts = f.properties?.ts;
      if (!Number.isFinite(ts)) continue;
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      bins.set(key, (bins.get(key) || 0) + 1);
    }
    return Array.from(bins.entries()).map(([m, count]) => ({ m, count })).sort((a,b) => a.m.localeCompare(b.m));
  }, [floodsPointsFC]);

  /* ======= render ======= */
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">flood events</h1>
        <p className="text-muted-foreground">
          click a row or map point to focus a single flood; others hide. press <kbd>esc</kbd> or click empty map to clear. kde & spatio-temporal views available. hover a point for details.
        </p>
      </header>

      {/* map + side panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* map */}
        <div className="lg:col-span-2 relative rounded-3xl border border-border bg-card shadow-sm min-h-[36rem] overflow-hidden">

          {/* legend — only when selected */}
          {selected && (
            <div className="flood-legend absolute left-3 top-3 z-10 rounded-xl p-3 text-xs shadow-lg">
              <div className="mb-2 font-medium">legend (selected flood)</div>
              <div className="flex items-center gap-2 mb-1"><span className="legend-swatch" style={{background:"#22c55e"}} /><span>origin</span></div>
              <div className="flex items-center gap-2 mb-1"><span className="legend-swatch" style={{background:"#3b82f6"}} /><span>start</span></div>
              <div className="flex items-center gap-2 mb-2"><span className="legend-swatch" style={{background:"#f59e0b"}} /><span>predicted a / b</span></div>
              <div className="flex items-center gap-2 mb-2"><span className="legend-swatch" style={{background:"#ef4444"}} /><span>end</span></div>
              <div className="flex items-center gap-2 mb-2"><span className="legend-swatch" style={{background:"#22c55e"}} /><span>≤200 m ring & amenities</span></div>
              <div className="flex items-center gap-2 mb-2"><span className="legend-swatch" style={{background:"#0ea5e9"}} /><span>200–400 m ring & amenities</span></div>
            </div>
          )}

          {/* kde legend */}
          {viewMode === "kde" && (
            <div className="flood-legend absolute left-3 bottom-3 z-10 rounded-xl p-3 text-xs shadow-lg w-56">
              <div className="mb-2 font-medium">heatmap density</div>
              <div className="flex items-center gap-2">
                <span>low</span>
                <div className="h-3 flex-1 rounded overflow-hidden" style={{ background: "linear-gradient(to right, rgba(33,102,172,0), rgb(103,169,207), rgb(209,229,240), rgb(253,219,199), rgb(239,138,98), rgb(178,24,43))" }} />
                <span>high</span>
              </div>
            </div>
          )}

          {/* view toggle */}
          <div className="absolute right-3 top-3 z-10 rounded-xl p-3 text-xs shadow-lg view-toggle">
            <div className="mb-2 font-medium">view</div>
            <div className="space-y-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="viewmode" value="points" checked={viewMode === "points"} onChange={() => setViewMode("points")} />
                <span>points (clustered)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="viewmode" value="kde" checked={viewMode === "kde"} onChange={() => setViewMode("kde")} />
                <span>kde</span>
              </label>
              {viewMode === "kde" && (
                <select value={kdePreset} onChange={(e)=>setKdePreset(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs">
                  <option value="g">g — balanced</option>
                  <option value="d">d — dense</option>
                  <option value="k">k — compact</option>
                  <option value="l">l — light</option>
                </select>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="viewmode" value="st" checked={viewMode === "st"} onChange={() => setViewMode("st")} />
                <span>spatio-temporal</span>
              </label>
              {viewMode === "st" && (
                <div className="mt-2 grid grid-cols-6 gap-1">
                  {MONTH_PALETTE.map((c, i) => (<div key={i} className="h-3 rounded" style={{ background: c }} title={`month ${i+1}`} />))}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={clearSelection}
            className="absolute z-10 right-3 bottom-3 rounded-lg border border-white/10 px-3 py-1.5 text-sm bg-white/10 text-white/90 hover:bg-white/20 backdrop-blur shadow"
          >
            reset selection
          </button>

          <div ref={containerRef} className="h-full w-full min-h-[36rem]" />
        </div>

        {/* side panel: fixed height, scrollable list, collapsible */}
        <div className="lg:col-span-1 rounded-3xl border border-border bg-card shadow-sm flex flex-col min-h-[36rem]">
          <div className="p-4 border-b flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-muted-foreground mb-1">nearby amenities (proximity rings)</div>
              <div className="text-base font-semibold truncate">
                {selectedProps ? (selectedProps.start_road || selectedProps.parent_road || "—") : "—"}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {selectedProps ? (selectedProps.start_planning_area || "—") : "select a flood to view"}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1">
              <button onClick={()=>setRingFilter("all")} className={`rounded-lg border px-2 py-1 text-xs hover:bg-muted ${ringFilter==="all"?"bg-muted":""}`}>all</button>
              <button onClick={()=>setRingFilter("inner")} className={`rounded-lg border px-2 py-1 text-xs hover:bg-muted ${ringFilter==="inner"?"bg-muted":""}`}>
                ≤200m{selectedProps?` (${selectedProps._ring_counts?.inner||0})`:""}
              </button>
              <button onClick={()=>setRingFilter("outer")} className={`rounded-lg border px-2 py-1 text-xs hover:bg-muted ${ringFilter==="outer"?"bg-muted":""}`}>
                200–400m{selectedProps?` (${selectedProps._ring_counts?.outer||0})`:""}
              </button>
              <button
                onClick={() => setAmenitiesOpen(v => !v)}
                className="rounded-lg border px-2 py-1 text-xs hover:bg-muted"
                title={amenitiesOpen ? "collapse panel" : "expand panel"}
              >
                {amenitiesOpen ? "collapse" : "expand"}
              </button>
            </div>
          </div>

          {amenitiesOpen ? (
            <div className="flex-1 overflow-y-auto p-3">
              {selectedProps ? (
                <affectedamenitieslist
                  selectedProps={selectedProps}
                  amenityFC={amenityFC}
                  ringFilter={ringFilter}
                  onCenter={(lng, lat) => {
                    mapRef.current?.flyTo({ center: [lng, lat], zoom: 17, essential: true });
                  }}
                />
              ) : (
                <div className="h-full grid place-items-center text-sm text-muted-foreground p-6">
                  select a flood on the left to see nearby amenities here.
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 text-xs text-muted-foreground">panel collapsed</div>
          )}
        </div>
      </div>

      {/* timeline */}
      <section className="rounded-3xl border border-border bg-card shadow-sm p-4">
        <div className="mb-3 text-sm text-muted-foreground">timeline (brush to filter date range)</div>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timelineData} margin={{ left: 6, right: 6, top: 4, bottom: 4 }}>
              <XAxis dataKey="m" tick={{ fontSize: 10 }} />
              <YAxis width={28} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="#93c5fd" fillOpacity={0.5} />
              <Brush
                travellerWidth={8}
                height={18}
                stroke="#64748b"
                onChange={(range) => {
                  const { startIndex, endIndex } = range || {};
                  if (startIndex == null || endIndex == null) return;
                  const s = timelineData[Math.max(0, startIndex)]?.m;
                  const t = timelineData[Math.min(timelineData.length - 1, endIndex)]?.m;
                  if (!s || !t) return;
                  setFromStr(`${s}-01`);
                  setToStr(`${t}-28`);
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* filters */}
      <section className="rounded-3xl border border-border bg-card shadow-sm p-4">
        <div className="mb-3 text-sm text-muted-foreground">filters</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search id / location / road…" className="md:col-span-4 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring" />
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="md:col-span-2 rounded-lg border bg-background px-3 py-2 text-sm">
            {eventTypeOptions.map((t) => (<option key={t} value={t}>{t === "all" ? "all types" : t.replace("_"," ")}</option>))}
          </select>
          <select value={paFilter} onChange={(e) => setPaFilter(e.target.value)} className="md:col-span-3 rounded-lg border bg-background px-3 py-2 text-sm">
            {paOptions.map((n) => (<option key={n} value={n}>{n === "all" ? "all planning areas" : n}</option>))}
          </select>
          <select value={szFilter} onChange={(e) => setSzFilter(e.target.value)} className="md:col-span-3 rounded-lg border bg-background px-3 py-2 text-sm">
            {szOptions.map((n) => (<option key={n} value={n}>{n === "all" ? "all subzones" : n}</option>))}
          </select>
          <input type="date" value={fromStr} onChange={(e) => setFromStr(e.target.value)} className="md:col-span-2 rounded-lg border bg-background px-3 py-2 text-sm" />
          <input type="date" value={toStr} onChange={(e) => setToStr(e.target.value)} className="md:col-span-2 rounded-lg border bg-background px-3 py-2 text-sm" />
          <button onClick={() => { setQ(""); setEventType("all"); setPaFilter("all"); setSzFilter("all"); setFromStr(""); setToStr(""); }} className="md:col-span-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">clear</button>
        </div>
      </section>

      {/* table */}
      <div className="overflow-auto rounded-3xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2">id</th>
              <th className="px-4 py-2">date</th>
              <th className="px-4 py-2">type</th>
              <th className="px-4 py-2">planning area</th>
              <th className="px-4 py-2">subzone</th>
              <th className="px-4 py-2">location</th>
              <th className="px-4 py-2">road</th>
              <th className="px-4 py-2">action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => {
              const active = String(selected ?? "") === String(r.id);
              return (
                <tr
                  key={r.id}
                  onClick={() => setSelected(prev => {
                    const next = String(prev) === String(r.id) ? null : r.id;
                    if (next) focusSelect(next); else clearSelection();
                    return next;
                  })}
                  className={`cursor-pointer hover:bg-muted/60 ${active ? "bg-muted/80 font-medium" : ""}`}
                >
                  <td className="px-4 py-2">{r.id}</td>
                  <td className="px-4 py-2">{r.event_date}</td>
                  <td className="px-4 py-2">{r.event?.replace("_", " ")}</td>
                  <td className="px-4 py-2">{r.planning_area || "—"}</td>
                  <td className="px-4 py-2">{r.subzone || "—"}</td>
                  <td className="px-4 py-2">{r.location || "—"}</td>
                  <td className="px-4 py-2">{r.parent_road || "—"}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelected(prev => {
                        const next = String(prev) === String(r.id) ? null : r.id;
                        if (next) focusSelect(next); else clearSelection();
                        return next;
                      }); }}
                      className="rounded-lg border px-2 py-1 text-xs hover:bg-muted"
                    >
                      {active ? "hide" : "view on map"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">no rows match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* styles */}
      <style>{`
        .mapboxgl-popup.popup-dark .mapboxgl-popup-content {
          background: rgba(2, 6, 23, 0.96);
          color: #e5e7eb;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.45);
          padding: 10px 12px;
        }
        .mapboxgl-popup.popup-dark .mapboxgl-popup-tip {
          border-top-color: rgba(2, 6, 23, 0.96) !important;
          border-bottom-color: rgba(2, 6, 23, 0.96) !important;
          border-left-color: rgba(2, 6, 23, 0.96) !important;
          border-right-color: rgba(2, 6, 23, 0.96) !important;
        }
        .flood-legend, .view-toggle {
          background: rgba(2, 6, 23, 0.92);
          color: #e5e7eb;
          border: 1px solid rgba(148, 163, 184, .25);
          backdrop-filter: blur(6px) saturate(120%);
        }
        @media (prefers-color-scheme: light) {
          .flood-legend, .view-toggle {
            background: rgba(255, 255, 255, 0.92);
            color: #0f172a;
            border-color: rgba(15, 23, 42, .08);
          }
        }
        .flood-legend .legend-swatch {
          display: inline-block; width: 12px; height: 12px; border-radius: 9999px;
          border: 1px solid rgba(0,0,0,.4);
        }
      `}</style>
    </div>
  );
}

/* ---------- subcomponent: amenities (scrollable, proximity-based) ---------- */
function affectedamenitieslist({ selectedProps, amenityFC, ringFilter, onCenter }) {
  const centerLngLat = useMemo(() => {
    const lng = toNum(selectedProps?.start_lng), lat = toNum(selectedProps?.start_lat);
    return (Number.isNaN(lng) || Number.isNaN(lat)) ? null : [lng, lat];
  }, [selectedProps]);

  const list = useMemo(() => {
    if (!centerLngLat) return [];
    const feats = amenityFC?.features || [];
    const out = [];
    for (const a of feats) {
      const coords = a.geometry?.coordinates || [];
      if (!Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) continue;
      const band = bandPredicate(turf.point(coords), centerLngLat, 200, 400); // "inner" | "outer" | null
      if (!band) continue; // only keep ≤ 400 m
      if (ringFilter !== "all" && band !== ringFilter) continue;
      out.push({
        id: a.properties?.amenity_id ?? a.id ?? "",
        type: a.properties?.amenity_type ?? "",
        name: a.properties?.amenity_name ?? "",
        lat: coords[1], lng: coords[0],
        band,
      });
    }
    return out.sort((x, y) =>
      (x.band || "").localeCompare(y.band || "") ||
      (x.type || "").localeCompare(y.type || "") ||
      (x.name || "").localeCompare(y.name || "")
    );
  }, [amenityFC, centerLngLat, ringFilter]);

  if (!centerLngLat) {
    return <div className="text-sm text-muted-foreground p-3">select a flood to compute nearby amenities.</div>;
  }
  if (!list.length) {
    return <div className="text-sm text-muted-foreground p-3">no amenities within 400 m.</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {list.map((a) => (
        <div key={a.id} className="rounded-xl border p-2 text-sm hover:bg-muted/50 transition">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium truncate">{a.name || "(unnamed)"}</div>
              <div className="text-xs text-muted-foreground truncate">{a.type || "amenity"}</div>
              <div className="text-[11px] text-muted-foreground font-mono">
                {a.lat != null && a.lng != null ? `${fmt(a.lat)}, ${fmt(a.lng)}` : "—"}
              </div>
              <div className="mt-1 text-xs">
                <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 ${a.band==="inner"?"border-green-500":a.band==="outer"?"border-sky-500":"border-slate-400"}`}>
                  {a.band==="inner" ? "≤200m" : "200–400m"}
                </span>
              </div>
            </div>
            <div className="shrink-0">
              <button
                className="rounded-lg border px-2 py-1 text-xs hover:bg-muted"
                onClick={() => a.lng != null && a.lat != null && onCenter?.(a.lng, a.lat)}
                title="center map here"
              >
                focus
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
