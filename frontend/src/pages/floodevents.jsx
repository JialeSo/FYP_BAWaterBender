// src/components/floodevents.jsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMapData } from "@/context/mapdatacontext";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import * as turf from "@turf/turf";

mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const mapbox_style = "mapbox://styles/mapbox/light-v11";
const page_size = 20;

/* ===== utils ===== */
const to_num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };
const fmt = (v, d = 6) => (Number.isFinite(+v) ? (+v).toFixed(d) : "—");
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const date_in_range = (dt, from, to) => { if (!dt) return true; if (from && dt < from) return false; if (to && dt > to) return false; return true; };
const dist_m = (lng1, lat1, lng2, lat2) => turf.distance([lng1, lat1], [lng2, lat2], { units: "kilometers" }) * 1000;

function await_style(map) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded && map.isStyleLoaded()) return resolve();
    const on_load = () => { map.off("load", on_load); resolve(); };
    map.on("load", on_load);
  });
}

function bounds_from_floods(fc) {
  const b = new mapboxgl.LngLatBounds();
  let had = false;
  for (const f of fc?.features || []) {
    const p = f.properties || {};
    const lng = to_num(p.start_lng);
    const lat = to_num(p.start_lat);
    if (!Number.isNaN(lng) && !Number.isNaN(lat)) { b.extend([lng, lat]); had = true; }
  }
  return had ? b : null;
}

function build_flood_detail(p) {
  const origin = [to_num(p.origin_lng), to_num(p.origin_lat)];
  const start  = [to_num(p.start_lng),  to_num(p.start_lat)];
  const pred_a = [to_num(p.end100_a_lng), to_num(p.end100_a_lat)];
  const pred_b = [to_num(p.end100_b_lng), to_num(p.end100_b_lat)];
  const end    = [to_num(p.end_lng),    to_num(p.end_lat)];
  const has = (xy) => !Number.isNaN(xy?.[0]) && !Number.isNaN(xy?.[1]) && Math.abs(xy[0]) <= 180 && Math.abs(xy[1]) <= 90;

  const points = [];
  if (has(origin)) points.push({ role: "origin", coord: origin });
  if (has(start))  points.push({ role: "start",  coord: start });
  if (has(pred_a)) points.push({ role: "pred_a", coord: pred_a });
  if (has(pred_b)) points.push({ role: "pred_b", coord: pred_b });
  if (has(end))    points.push({ role: "end",    coord: end });

  const seg = (a, b, role) => (has(a) && has(b) ? [{ role, a, b }] : []);
  const lines = [
    ...seg(origin, start, "origin_to_start"),
    ...seg(start, pred_a, "start_to_pred_a"),
    ...seg(start, pred_b, "start_to_pred_b"),
    ...seg(pred_a, end,  "pred_a_to_end"),
    ...seg(pred_b, end,  "pred_b_to_end"),
    ...(!has(end) && has(pred_a) && has(pred_b) ? seg(pred_a, pred_b, "pred_a_to_pred_b") : []),
  ];

  const center = has(start) ? start : (has(origin) ? origin : points[0]?.coord);
  return { points, lines, center };
}

function popup_html(p = {}) {
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

/* ===== tiny accordion (capitalized to be a component) ===== */
function Accordion({ title, default_open = false, children, right = null }) {
  return (
    <details className="rounded-xl border bg-card open:shadow-sm" open={default_open}>
      <summary className="flex items-center justify-between gap-2 cursor-pointer select-none px-3 py-2 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">{right}</span>
      </summary>
      <div className="border-t px-3 py-3">{children}</div>
    </details>
  );
}

/* ===== weights & scoring ===== */
const default_weight_by_category = {
  community_spaces: 1,
  education_institutions: 3,
  emergency_services: 5,
  essential_services: 4,
  government_services: 2,
  healthcare_facilities: 5,
  others: 1,
  residential: 2,
  retail_services: 2,
  tourism: 1,
  transport_services: 3,
};
function normalize01(val, min, max) {
  if (!Number.isFinite(val) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return (val - min) / (max - min);
}

/* ===== roads distance helper (dynamic pad; supports multilinestring) ===== */
function meters_to_deg(lat, meters) {
  const deg_lat = meters / 111320;
  const deg_lng = meters / (111320 * Math.cos(lat * Math.PI / 180) || 1);
  return { deg_lat, deg_lng };
}

function roads_within_rings(road_fc, center, r_in, r_out) {
  if (!road_fc?.features?.length || !center) return { inner: [], outer: [] };

  const [lng0, lat0] = center;
  const { deg_lat, deg_lng } = meters_to_deg(lat0, Math.max(r_out, 50));
  const minx = lng0 - deg_lng, maxx = lng0 + deg_lng;
  const miny = lat0 - deg_lat, maxy = lat0 + deg_lat;

  const pt = turf.point(center);
  const inner = [], outer = [];

  for (const rf of road_fc.features) {
    if (!rf?.geometry) continue;

    const bb = turf.bbox(rf);
    if (bb[0] > maxx || bb[2] < minx || bb[1] > maxy || bb[3] < miny) continue;

    let d;
    try {
      d = turf.pointToLineDistance(pt, rf, { units: "meters" });
    } catch {
      const ls = [];
      if (rf.geometry.type === "MultiLineString") {
        for (const coords of rf.geometry.coordinates || []) {
          ls.push({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} });
        }
      } else if (rf.geometry.type === "LineString") {
        ls.push(rf);
      }
      d = Math.min(
        ...ls.map(f => turf.pointToLineDistance(pt, f, { units: "meters" })).filter(Number.isFinite)
      );
    }

    if (!Number.isFinite(d) || d > r_out) continue;

    const band = d <= r_in ? "inner" : "outer";
    const rp = rf.properties || {};
    const name = rp.name || rp.road_name || rp.ROAD_NAME || "(unnamed)";
    const rn_id = rp.rn_id ?? rp.RN_ID ?? null;

    const item = {
      band, d: Math.round(d), name, rn_id,
      geometry: rf.geometry,
      props: { ...rp },
    };
    (band === "inner" ? inner : outer).push(item);
  }

  inner.sort((a, b) => a.d - b.d);
  outer.sort((a, b) => a.d - b.d);
  return { inner, outer };
}

/* ===== main component ===== */
export default function floodevents() {
  const {
    floods_fc_enriched: floods_fc,
    amenity_fc_raw: amenity_fc,
    road_fc_enriched: road_fc,
    category_lookup,
  } = useMapData();

  const map_ref = useRef(null);
  const container_ref = useRef(null);
  const popup_ref = useRef(null);

  const [mode, set_mode] = useState("distance");
  const [r_inner, set_r_inner] = useState(200);
  const [r_outer, set_r_outer] = useState(500);
  const [iso_profile, set_iso_profile] = useState("driving");
  const [iso_inner_min, set_iso_inner_min] = useState(5);
  const [iso_outer_min, set_iso_outer_min] = useState(10);
  const [q, set_q] = useState("");
  const [event_type, set_event_type] = useState("all");
  const [from_str, set_from_str] = useState("");
  const [to_str, set_to_str] = useState("");
  const [pa_filter, set_pa_filter] = useState("all");
  const [sz_filter, set_sz_filter] = useState("all");
  const from_date = useMemo(() => (from_str ? new Date(from_str) : null), [from_str]);
  const to_date = useMemo(() => (to_str ? new Date(to_str) : null), [to_str]);
  const [selected, set_selected] = useState(null);
  const [selected_props, set_selected_props] = useState(null);
  const [panel_open, set_panel_open] = useState(true);
  const [panel_tab, set_panel_tab] = useState("amenities"); // "amenities" | "roads"
  const [ring_filter, set_ring_filter] = useState("all");
  const [show_page_rings, set_show_page_rings] = useState(false);
  const [sort_key, set_sort_key] = useState("dt_desc");
  const [page, set_page] = useState(1);
  const [visible_cols, set_visible_cols] = useState({
    id: true, event_date: true, event: true, planning_area: true, subzone: true, location: true, parent_road: true,
    ring_inner: true, ring_outer: true, ring_total: true,
    impact_inner: true, impact_outer: true, impact_total: true, centrality: true, flood_index: true,
    start_postal_code: false, start_lat: false, start_lng: false,
  });

  const categories = useMemo(() => {
    const items = Object.values(category_lookup?.by_id || {});
    return items.sort((a, b) => (a.id || 0) - (b.id || 0));
  }, [category_lookup]);

  const [cat_weights, setCatWeights] = useState(() => {
    const out = { ...default_weight_by_category };
    for (const c of Object.values(category_lookup?.by_id || {})) {
      const name = String(c.amenity_category || "").trim();
      if (!(name in out)) out[name] = 1;
    }
    return out;
  });

  const [inner_mult, set_inner_mult] = useState(1.0);
  const [outer_mult, set_outer_mult] = useState(0.5);
  const [w_centrality, set_w_centrality] = useState(0.5);
  const [w_amenity, set_w_amenity] = useState(0.5);

  /* roads index by rn_id for centrality */
  const roads_by_id = useMemo(() => {
    const idx = new Map();
    for (const f of road_fc?.features || []) {
      const rn = f?.properties?.rn_id ?? f?.properties?.RN_ID ?? null;
      if (rn == null) continue;
      const key = String(rn);
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(f);
    }
    return idx;
  }, [road_fc]);

  const centrality_scale = useMemo(() => {
    let bmins = +Infinity, bmaxs = -Infinity, cmins = +Infinity, cmaxs = -Infinity;
    for (const f of road_fc?.features || []) {
      const p = f.properties || {};
      const b = +((p.betweenness_norm ?? p.betweenness ?? p.BETWEENNESS_NORM ?? p.BETWEENNESS) || NaN);
      const c = +((p.closeness_norm   ?? p.closeness   ?? p.CLOSENESS_NORM   ?? p.CLOSENESS)   || NaN);
      if (Number.isFinite(b)) { bmins = Math.min(bmins,b); bmaxs = Math.max(bmaxs,b); }
      if (Number.isFinite(c)) { cmins = Math.min(cmins,c); cmaxs = Math.max(cmaxs,c); }
    }
    if (!Number.isFinite(bmins)) { bmins=0; bmaxs=1; }
    if (!Number.isFinite(cmins)) { cmins=0; cmaxs=1; }
    return { bmins, bmaxs, cmins, cmaxs };
  }, [road_fc]);

  /* amenities flat list */
  const amenity_list = useMemo(() => {
    const feats = amenity_fc?.features || [];
    const arr = [];
    for (const f of feats) {
      const p = f?.properties || {};
      const c = f?.geometry?.coordinates || [];
      const lng = +c[0], lat = +c[1];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const catname =
        p.amenity_category_name ||
        category_lookup?.by_id?.[p.amenity_category_id || 0]?.amenity_category ||
        "others";
      arr.push({
        id: p.amenity_id ?? f.id ?? `${Math.random()}`,
        lng, lat,
        name: p.amenity_name ?? p.name ?? p.poi_name ?? p.display_name ?? p.place_name ?? "(unnamed)",
        category: catname,
      });
    }
    return arr;
  }, [amenity_fc, category_lookup]);

  const query_amenities = (lng, lat, max_m) => {
    const pad_deg = 0.009;
    const out = [];
    for (const a of amenity_list) {
      if (a.lng < lng - pad_deg || a.lng > lng + pad_deg || a.lat < lat - pad_deg || a.lat > lat + pad_deg) continue;
      const d = dist_m(lng, lat, a.lng, a.lat);
      if (d <= max_m) out.push({ ...a, _distm: d });
    }
    out.sort((x, y) => x._distm - y._distm);
    return out;
  };

  const [selected_stats, set_selected_stats] = useState(null); // includes amenities & index scores
  const [roads_nearby_state, set_roads_nearby_state] = useState({ inner: [], outer: [] }); // for panel roads

  /* precompute fast amenity counts per flood for table */
  const stats_by_flood_distance = useMemo(() => {
    const out = new Map();
    const floods = floods_fc?.features || [];
    if (!floods.length) return out;

    const r_in = Math.max(0, Math.min(r_inner, r_outer));
    const r_out = Math.max(r_in, r_outer);

    for (const f of floods) {
      const p = f.properties || {};
      const id = String(p.id ?? f.id ?? "");
      const lng = to_num(p.start_lng), lat = to_num(p.start_lat);
      if (Number.isNaN(lng) || Number.isNaN(lat)) continue;

      let inner = 0, outer = 0;
      let impact_inner = 0, impact_outer = 0;
      const near = amenity_list.length ? query_amenities(lng, lat, r_out) : [];

      for (const a of near) {
        const d = a._distm;
        const band = d <= r_in ? "inner" : "outer";
        const w = +cat_weights[a.category] || 0.0;
        if (band === "inner") { inner++; impact_inner += w * inner_mult; }
        else { outer++; impact_outer += w * outer_mult; }
      }

      const counts = { inner, outer, total: inner + outer };
      const impact_total = impact_inner + impact_outer;

      let bnorm = 0, cnorm = 0;
      if (p.start_rn_id != null) {
        const rlist = roads_by_id.get(String(p.start_rn_id)) || [];
        let bmax = -Infinity, cmax = -Infinity;
        for (const r of rlist) {
          const rp = r.properties || {};
          const b = +((rp.betweenness_norm ?? rp.betweenness ?? rp.BETWEENNESS_NORM ?? rp.BETWEENNESS) || NaN);
          const c = +((rp.closeness_norm   ?? rp.closeness   ?? rp.CLOSENESS_NORM   ?? rp.CLOSENESS)   || NaN);
          if (Number.isFinite(b)) bmax = Math.max(bmax, b);
          if (Number.isFinite(c)) cmax = Math.max(cmax, c);
        }
        if (Number.isFinite(bmax)) bnorm = normalize01(bmax, centrality_scale.bmins, centrality_scale.bmaxs);
        if (Number.isFinite(cmax)) cnorm = normalize01(cmax, centrality_scale.cmins, centrality_scale.cmaxs);
      }
      const centrality_score = 0.6*bnorm + 0.4*cnorm;

      const amenity_score = 1 - Math.exp(-(impact_total) / 10.0);
      const flood_index = (w_centrality * centrality_score) + (w_amenity * amenity_score);

      out.set(id, {
        center: [lng, lat],
        counts,
        impact: { inner: impact_inner, outer: impact_outer, total: impact_total },
        centrality: { bnorm, cnorm, centrality_score },
        scores: { amenity_score, flood_index },
      });
    }
    return out;
  }, [floods_fc, amenity_list, r_inner, r_outer, cat_weights, inner_mult, outer_mult, roads_by_id, centrality_scale, w_centrality, w_amenity]);

  /* rows & filters */
  const rows = useMemo(() => {
    const fc = floods_fc || { type: "featurecollection", features: [] };
    const arr = (fc.features || []).map((f) => {
      const p = f.properties || {};
      const id = String(p.id ?? f.id ?? "");
      const stats = stats_by_flood_distance.get(id);
      const event_date = p.event_date || "";
      const event = p.event || "";
      const location = p.location || "";
      const parent_road = p.parent_road || "";
      const planning_area = p.start_planning_area || "";
      const subzone = p.start_subzone || "";
      const start_postal_code = p.start_postal_code || "";
      const start_lat = to_num(p.start_lat);
      const start_lng = to_num(p.start_lng);
      const dt = p.event_date_iso ? new Date(p.event_date_iso) : (p.event_date ? new Date(p.event_date) : null);
      return {
        id, event_date, event, dt, location, parent_road, planning_area, subzone,
        start_postal_code, start_lat, start_lng,
        ring_inner: stats?.counts.inner ?? 0,
        ring_outer: stats?.counts.outer ?? 0,
        ring_total: stats?.counts.total ?? 0,
        impact_inner: +(stats?.impact.inner ?? 0).toFixed(2),
        impact_outer:  +(stats?.impact.outer ?? 0).toFixed(2),
        impact_total:  +(stats?.impact.total ?? 0).toFixed(2),
        centrality:    +(stats?.centrality.centrality_score ?? 0).toFixed(3),
        flood_index:   +(stats?.scores.flood_index ?? 0).toFixed(3),
        _props: p,
      };
    });

    Object.defineProperty(arr, "_options", {
      value: {
        event_types: ["all", ...Array.from(new Set(arr.map(r => r.event).filter(Boolean))).sort()],
        planning_areas: ["all", ...Array.from(new Set(arr.map(r => r.planning_area).filter(Boolean))).sort()],
        subzones: ["all", ...Array.from(new Set(arr.map(r => r.subzone).filter(Boolean))).sort()],
      },
      enumerable: false,
    });

    return arr;
  }, [floods_fc, stats_by_flood_distance]);

  const event_type_options = rows._options?.event_types || ["all"];
  const pa_options = rows._options?.planning_areas || ["all"];
  const sz_options = rows._options?.subzones || ["all"];

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (event_type === "all" || r.event === event_type) &&
      date_in_range(r.dt, from_date, to_date) &&
      (pa_filter === "all" || r.planning_area === pa_filter) &&
      (sz_filter === "all" || r.subzone === sz_filter) &&
      (!needle ||
        r.id.toLowerCase().includes(needle) ||
        (r.location || "").toLowerCase().includes(needle) ||
        (r.parent_road || "").toLowerCase().includes(needle))
    );
  }, [rows, q, event_type, from_date, to_date, pa_filter, sz_filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const by = (k, dir = "asc") => {
      const sgn = dir === "asc" ? 1 : -1;
      arr.sort((a, b) => {
        let va = a[k], vb = b[k];
        if (k === "dt") { va = a.dt ? a.dt.getTime() : 0; vb = b.dt ? b.dt.getTime() : 0; }
        if (typeof va === "string") return sgn * (va || "").localeCompare(vb || "");
        return sgn * ((va ?? 0) - (vb ?? 0));
      });
    };
    if (sort_key === "dt_desc") by("dt", "desc");
    else if (sort_key.endsWith("_asc"))  by(sort_key.slice(0, -4), "asc");
    else if (sort_key.endsWith("_desc")) by(sort_key.slice(0, -5), "desc");
    return arr;
  }, [filtered, sort_key]);

  const total_pages = Math.max(1, Math.ceil(sorted.length / page_size));
  const page_safe = clamp(page, 1, total_pages);
  const paged = useMemo(() => {
    const start = (page_safe - 1) * page_size;
    return sorted.slice(start, start + page_size);
  }, [sorted, page_safe]);

  const bounds = useMemo(() => bounds_from_floods(floods_fc), [floods_fc]);

  /* ===== map init ===== */
  useEffect(() => {
    if (!container_ref.current || !floods_fc) return;

    const map = new mapboxgl.Map({
      container: container_ref.current,
      style: mapbox_style,
      center: [103.82, 1.35],
      zoom: 11,
      attributionControl: false,
      cooperativeGestures: true,
    });
    map_ref.current = map;

    (async () => {
      await await_style(map);

      map.addSource("floods", {
        type: "geojson",
        data: floods_fc,
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

      map.addSource("flood-selected-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("flood-selected-lines",  { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("flood-selected-labels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({
        id: "flood-selected-lines-casing",
        type: "line",
        source: "flood-selected-lines",
        paint: { "line-color": "#0b1220", "line-opacity": 0.25, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 13, 8, 15, 10] },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "flood-selected-lines",
        type: "line",
        source: "flood-selected-lines",
        paint: {
          "line-color": [
            "match", ["get", "role"],
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
            "match", ["get", "role"],
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
        layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-allow-overlap": true, "visibility": "none" },
        paint: { "text-color": "#111827", "text-halo-color": "#ffffff", "text-halo-width": 1.0 },
      });

      /* start road only (original) */
      map.addSource("affected-road", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "affected-road",
        type: "line",
        source: "affected-road",
        paint: { "line-color": "#38bdf8", "line-opacity": 0.45, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 13, 2.0, 15, 3.0] },
        layout: { visibility: "none" },
      });

      /* all roads within rings (inner/outer bands) */
      map.addSource("roads-nearby-inner", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("roads-nearby-outer", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({
        id: "roads-nearby-outer",
        type: "line",
        source: "roads-nearby-outer",
        paint: {
          "line-color": "#0ea5e9",
          "line-opacity": 0.75,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 13, 2.6, 15, 3.6]
        },
        layout: { visibility: "none" }
      });
      map.addLayer({
        id: "roads-nearby-inner",
        type: "line",
        source: "roads-nearby-inner",
        paint: {
          "line-color": "#22c55e",
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 13, 2.8, 15, 3.8]
        },
        layout: { visibility: "none" }
      });

      /* rings (per page or per selection) */
      map.addSource("rings-page-inner", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("rings-page-outer", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "rings-page-outer-fill", type: "fill", source: "rings-page-outer",
        paint: { "fill-color": "#0ea5e9", "fill-opacity": 0.06 }, layout: { visibility: "none" } });
      map.addLayer({ id: "rings-page-inner-fill", type: "fill", source: "rings-page-inner",
        paint: { "fill-color": "#22c55e", "fill-opacity": 0.08 }, layout: { visibility: "none" } });
      map.addLayer({ id: "rings-page-outer-line", type: "line", source: "rings-page-outer",
        paint: { "line-color": "#0ea5e9", "line-width": 1, "line-opacity": 0.6 }, layout: { visibility: "none" } });
      map.addLayer({ id: "rings-page-inner-line", type: "line", source: "rings-page-inner",
        paint: { "line-color": "#22c55e", "line-width": 1, "line-opacity": 0.7 }, layout: { visibility: "none" } });

      /* amenities */
      map.addSource("amenities-nearby", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "amenities-nearby",
        type: "circle",
        source: "amenities-nearby",
        paint: {
          "circle-radius": 6,
          "circle-color": ["match", ["get", "band"], "inner", "#22c55e", "outer", "#0ea5e9", "#6b7280"],
          "circle-opacity": 0.95,
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 1.5,
        },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "amenities-nearby-labels",
        type: "symbol",
        source: "amenities-nearby",
        layout: {
          "icon-image": "marker-15",
          "icon-size": 1.0,
          "icon-allow-overlap": true,
          "text-field": ["coalesce", ["get", "name_short"], ""],
          "text-size": 10,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-allow-overlap": true,
          "visibility": "none",
        },
        paint: { "text-color": "#111827", "text-halo-color": "#ffffff", "text-halo-width": 1.1 },
      });

      /* ensure roads draw above fills so they’re always visible */
      try {
        map.moveLayer("roads-nearby-outer", "amenities-nearby");
        map.moveLayer("roads-nearby-inner", "roads-nearby-outer");
      } catch {}

      if (bounds) map.fitBounds(bounds, { padding: 40, duration: 0 });

      map.on("mousemove", "flood-points", (e) => {
        const f = e?.features?.[0];
        if (!f) return;
        const p = f.properties || {};
        show_popup(e.lngLat, popup_html(p));
      });
      map.on("mouseleave", "flood-points", () => hide_popup());

      map.on("mousemove", "flood-selected-points", (e) => {
        const p = selected_props || {};
        show_popup(e.lngLat, popup_html(p));
      });
      map.on("mouseleave", "flood-selected-points", () => hide_popup());

      map.on("click", "flood-points", (e) => {
        const f = e?.features?.[0];
        const id = f?.properties?.id ?? f?.id;
        if (id != null) focus_select(String(id));
      });
      map.on("click", "flood-clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["flood-clusters"] });
        const cluster_id = features[0]?.properties?.cluster_id;
        const source = map.getSource("floods");
        if (!source || cluster_id == null) return;
        source.getClusterExpansionZoom(cluster_id, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: e.lngLat, zoom });
        });
      });

      map.on("click", (e) => {
        const bbox = [[e.point.x - 2, e.point.y - 2],[e.point.x + 2, e.point.y + 2]];
        const hit = map.queryRenderedFeatures(bbox, {
          layers: [
            "flood-clusters","flood-cluster-count","flood-points","flood-selected-points",
            "flood-selected-labels","amenities-nearby","amenities-nearby-labels",
            "rings-page-inner-fill","rings-page-outer-fill","roads-nearby-inner","roads-nearby-outer"
          ],
        });
        if (!hit || hit.length === 0) clear_selection();
      });
    })();

    try {
      const map = map_ref.current;
      map.moveLayer("flood-selected-labels");
      map.moveLayer("flood-selected-lines");
      map.moveLayer("flood-selected-lines-casing");
      map.moveLayer("amenities-nearby-labels");
      map.moveLayer("amenities-nearby");
      map.moveLayer("roads-nearby-outer");
      map.moveLayer("roads-nearby-inner");
      map.moveLayer("affected-road");
    } catch {}
    return () => { try { map_ref.current?.remove(); } catch {} };
  }, [floods_fc, bounds]);

  useEffect(() => {
    const on_key = (e) => { if (e.key === "Escape") clear_selection(); };
    window.addEventListener("keydown", on_key);
    return () => window.removeEventListener("keydown", on_key);
  }, []);

  useEffect(() => {
    if (!floods_fc?.features?.length) return;
    const ids = floods_fc.features.map(ft => String(ft.properties?.id ?? ft.id ?? ""));
    const target = ids[0];
    if (target) focus_select(target);
  }, [floods_fc, stats_by_flood_distance]);

  useEffect(() => {
    if (!selected) return;
    focus_select(selected);
  }, [r_inner, r_outer, cat_weights, inner_mult, outer_mult, w_centrality, w_amenity]);

  useEffect(() => {
    const map = map_ref.current;
    if (!map) return;

    const set_vis = (vis) => {
      try {
        map.setLayoutProperty("rings-page-inner-fill", vis);
        map.setLayoutProperty("rings-page-outer-fill", vis);
        map.setLayoutProperty("rings-page-inner-line", vis);
        map.setLayoutProperty("rings-page-outer-line", vis);
      } catch {}
    };

    if (!show_page_rings || mode !== "distance") {
      set_vis("none");
      try {
        map.getSource("rings-page-inner")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("rings-page-outer")?.setData({ type: "FeatureCollection", features: [] });
      } catch {}
      return;
    }

    const inner_feats = [];
    const outer_feats = [];
    const r_in = Math.max(0, Math.min(r_inner, r_outer));
    const r_out = Math.max(r_in, r_outer);

    for (const row of paged) {
      const stats = stats_by_flood_distance.get(String(row.id));
      if (!stats?.center) continue;
      const [lng, lat] = stats.center;
      const inner = turf.circle([lng, lat], r_in,  { steps: 64, units: "meters" });
      const outer = turf.circle([lng, lat], r_out, { steps: 64, units: "meters" });
      inner.properties = { id: row.id, band: "inner" };
      outer.properties = { id: row.id, band: "outer" };
      inner_feats.push(inner);
      outer_feats.push(outer);
    }

    try {
      map.getSource("rings-page-inner")?.setData({ type: "FeatureCollection", features: inner_feats });
      map.getSource("rings-page-outer")?.setData({ type: "FeatureCollection", features: outer_feats });
      set_vis("visible");
    } catch {}
  }, [show_page_rings, paged, r_inner, r_outer, stats_by_flood_distance, mode]);

  function show_popup(lnglat, html) {
    hide_popup();
    popup_ref.current = new mapboxgl.Popup({ closeOnClick: false, closeButton: false, className: "popup-dark", offset: 10, maxWidth: "320px" })
      .setLngLat(lnglat)
      .setHTML(html)
      .addTo(map_ref.current);
  }
  function hide_popup() { try { popup_ref.current?.remove(); } catch {} popup_ref.current = null; }

  /* ===== selection ===== */
  async function focus_select(id_str) {
    set_selected(id_str);

    const feat = (floods_fc?.features || []).find((ft) => String(ft.properties?.id ?? ft.id) === String(id_str));
    if (!feat) return;
    const p = feat.properties || {};
    const detail = build_flood_detail(p);
    const center = detail.center;
    const map = map_ref.current;
    if (!map || !center) return;

    set_selected_props({ ...p });

    try {
      map.setFilter("flood-points", ["all", ["!", ["has", "point_count"]], ["==", ["to-string", ["get", "id"]], String(id_str)]]);
      map.setLayoutProperty("flood-clusters", "visibility", "none");
      map.setLayoutProperty("flood-cluster-count", "visibility", "none");
    } catch {}

    const point_features = detail.points.map(pt => ({ type: "Feature", properties: { role: pt.role, label: pt.role.replace("_", " ") }, geometry: { type: "Point", coordinates: pt.coord } }));
    const line_features  = detail.lines.map(l => ({ type: "Feature", properties: { role: l.role }, geometry: { type: "LineString", coordinates: [l.a, l.b] } }));
    try {
      map.getSource("flood-selected-points")?.setData({ type: "FeatureCollection", features: point_features });
      map.getSource("flood-selected-lines")?.setData({ type: "FeatureCollection", features: line_features });
      map.getSource("flood-selected-labels")?.setData({ type: "FeatureCollection", features: point_features });
      map.setLayoutProperty("flood-selected-points", "visibility", point_features.length ? "visible" : "none");
      map.setLayoutProperty("flood-selected-lines-casing", "visibility", line_features.length ? "visible" : "none");
      map.setLayoutProperty("flood-selected-lines", "visibility", line_features.length ? "visible" : "none");
      map.setLayoutProperty("flood-selected-labels", "visibility", point_features.length ? "visible" : "none");
    } catch {}

    /* start road highlight (original) */
    const road_id = p.start_rn_id == null ? null : String(p.start_rn_id);
    const road_feats = road_id ? (roads_by_id.get(road_id) || []) : [];
    try {
      map.getSource("affected-road")?.setData({
        type: "FeatureCollection",
        features: road_feats.map(r => ({ type: "Feature", properties: { rn_id: r.properties?.rn_id ?? r.properties?.RN_ID ?? null, name: r.properties?.name || "" }, geometry: r.geometry })),
      });
      map.setLayoutProperty("affected-road", "visibility", road_feats.length ? "visible" : "none");
    } catch {}

    /* rings for this selection */
    const r_in = Math.max(0, Math.min(r_inner, r_outer));
    const r_out = Math.max(r_in, r_outer);
    const inner = turf.circle(center, r_in,  { steps: 128, units: "meters" });
    const outer = turf.circle(center, r_out, { steps: 128, units: "meters" });
    try {
      map.getSource("rings-page-inner")?.setData(inner);
      map.getSource("rings-page-outer")?.setData(outer);
      map.setLayoutProperty("rings-page-inner-fill", "visibility", "visible");
      map.setLayoutProperty("rings-page-outer-fill", "visibility", "visible");
      map.setLayoutProperty("rings-page-inner-line", "visibility", "visible");
      map.setLayoutProperty("rings-page-outer-line", "visibility", "visible");
    } catch {}

    /* amenities near */
    const near = query_amenities(center[0], center[1], r_out);
    let inner_count = 0, outer_count = 0, impact_inner = 0, impact_outer = 0;
    const amenity_feats = [];
    for (const a of near) {
      const band = a._distm <= r_in ? "inner" : "outer";
      const w = +cat_weights[a.category] || 0;
      if (band === "inner") { inner_count++; impact_inner += w * inner_mult; }
      else { outer_count++; impact_outer += w * outer_mult; }
      amenity_feats.push({
        type: "Feature",
        properties: { id: a.id, band, name_short: a.name || "", type: a.category || "amenity", distm: Math.round(a._distm) },
        geometry: { type: "Point", coordinates: [a.lng, a.lat] },
      });
    }
    try {
      map.getSource("amenities-nearby")?.setData({ type: "FeatureCollection", features: amenity_feats });
      map.setLayoutProperty("amenities-nearby", "visibility", "visible");
      map.setLayoutProperty("amenities-nearby-labels", "visibility", "visible");
    } catch {}

    /* roads near (inner/outer) — rendered & for panel */
    const roads_pack = roads_within_rings(road_fc, center, r_in, r_out);
    set_roads_nearby_state(roads_pack);

    try {
      map.getSource("roads-nearby-inner")?.setData({
        type: "FeatureCollection",
        features: roads_pack.inner.map(r => ({ type: "Feature", properties: { band: "inner", rn_id: r.rn_id, name: r.name, distm: r.d }, geometry: r.geometry }))
      });
      map.getSource("roads-nearby-outer")?.setData({
        type: "FeatureCollection",
        features: roads_pack.outer.map(r => ({ type: "Feature", properties: { band: "outer", rn_id: r.rn_id, name: r.name, distm: r.d }, geometry: r.geometry }))
      });
      map.setLayoutProperty("roads-nearby-inner", roads_pack.inner.length ? "visible" : "none");
      map.setLayoutProperty("roads-nearby-outer", roads_pack.outer.length ? "visible" : "none");
    } catch {}

    /* scores */
    let bnorm = 0, cnorm = 0;
    if (p.start_rn_id != null) {
      const rlist = roads_by_id.get(String(p.start_rn_id)) || [];
      let bmax = -Infinity, cmax = -Infinity;
      for (const r of rlist) {
        const rp = r.properties || {};
        const b = +((rp.betweenness_norm ?? rp.betweenness ?? rp.BETWEENNESS_NORM ?? rp.BETWEENNESS) || NaN);
        const c = +((rp.closeness_norm   ?? rp.closeness   ?? rp.CLOSENESS_NORM   ?? rp.CLOSENESS)   || NaN);
        if (Number.isFinite(b)) bmax = Math.max(bmax, b);
        if (Number.isFinite(c)) cmax = Math.max(cmax, c);
      }
      if (Number.isFinite(bmax)) bnorm = normalize01(bmax, centrality_scale.bmins, centrality_scale.bmaxs);
      if (Number.isFinite(cmax)) cnorm = normalize01(cmax, centrality_scale.cmins, centrality_scale.cmaxs);
    }
    const centrality_score = 0.6*bnorm + 0.4*cnorm;
    const impact_total = impact_inner + impact_outer;
    const amenity_score = 1 - Math.exp(-impact_total / 10.0);
    const flood_index = (w_centrality * centrality_score) + (w_amenity * amenity_score);

    set_selected_stats({
      mode: "distance",
      center,
      counts: { inner: inner_count, outer: outer_count, total: inner_count + outer_count },
      impact: { inner: +impact_inner.toFixed(2), outer: +impact_outer.toFixed(2), total: +impact_total.toFixed(2) },
      centrality: { bnorm, cnorm, centrality_score: +centrality_score.toFixed(3) },
      scores: { amenity_score: +amenity_score.toFixed(3), flood_index: +flood_index.toFixed(3) },
    });

    try { map.flyTo({ center, zoom: 15, essential: true }); } catch {}
  }

  function clear_selection() {
    set_selected(null);
    set_selected_props(null);
    set_selected_stats(null);
    set_roads_nearby_state({ inner: [], outer: [] });
    set_ring_filter("all");
    hide_popup();
    const map = map_ref.current;
    if (map) {
      try {
        map.setFilter("flood-points", ["all", ["!", ["has", "point_count"]]]);
        map.setLayoutProperty("flood-clusters", "visibility", "visible");
        map.setLayoutProperty("flood-cluster-count", "visibility", "visible");
        map.setLayoutProperty("flood-selected-points", "visibility", "none");
        map.setLayoutProperty("flood-selected-lines-casing", "visibility", "none");
        map.setLayoutProperty("flood-selected-lines", "visibility", "none");
        map.setLayoutProperty("flood-selected-labels", "visibility", "none");
        map.setLayoutProperty("amenities-nearby", "visibility", "none");
        map.setLayoutProperty("amenities-nearby-labels", "visibility", "none");
        map.setLayoutProperty("rings-page-inner-fill", "visibility", "none");
        map.setLayoutProperty("rings-page-outer-fill", "visibility", "none");
        map.setLayoutProperty("rings-page-inner-line", "visibility", "none");
        map.setLayoutProperty("rings-page-outer-line", "visibility", "none");
        map.setLayoutProperty("roads-nearby-inner", "visibility", "none");
        map.setLayoutProperty("roads-nearby-outer", "visibility", "none");
        map.getSource("amenities-nearby")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("roads-nearby-inner")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("roads-nearby-outer")?.setData({ type: "FeatureCollection", features: [] });
      } catch {}
    }
  }

  function export_csv() {
    const cols = Object.keys(visible_cols).filter(k => visible_cols[k]);
    const header = cols.join(",");
    const escape = (v) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = sorted.map(r => cols.map(k => escape(k === "event" ? r[k]?.replace("_"," ") : r[k])).join(","));
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `floods_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns = [
    { key: "id", label: "id", type: "string" },
    { key: "event_date", label: "date", type: "string" },
    { key: "event", label: "type", type: "string", render: (v)=>v?.replace("_"," ") },
    { key: "planning_area", label: "planning area", type: "string" },
    { key: "subzone", label: "subzone", type: "string" },
    { key: "location", label: "location", type: "string" },
    { key: "parent_road", label: "road", type: "string" },
    { key: "ring_inner", label: "≤inner count", type: "number" },
    { key: "ring_outer", label: "outer band count", type: "number" },
    { key: "ring_total", label: "≤outer total", type: "number" },
    { key: "impact_inner", label: "impact inner", type: "number" },
    { key: "impact_outer",  label: "impact outer", type: "number" },
    { key: "impact_total",  label: "impact total", type: "number" },
    { key: "centrality",    label: "road centrality", type: "number" },
    { key: "flood_index",   label: "flood index", type: "number" },
    { key: "start_postal_code", label: "postal", type: "string", optional: true },
    { key: "start_lat", label: "start lat", type: "number", optional: true },
    { key: "start_lng", label: "start lng", type: "number", optional: true },
  ];

  const sort_icon = (key) => {
    if (key === "dt") return sort_key === "dt_desc" ? "↓" : "↑";
    if (sort_key === `${key}_asc`) return "↑";
    if (sort_key === `${key}_desc`) return "↓";
    return "↕";
  };
  const toggle_sort = (key) => {
    if (key === "dt") {
      set_sort_key(sort_key === "dt_desc" ? "dt_asc" : "dt_desc");
      return;
    }
    if (sort_key === `${key}_asc`) set_sort_key(`${key}_desc`);
    else if (sort_key === `${key}_desc`) set_sort_key(`${key}_asc`);
    else set_sort_key(`${key}_asc`);
  };

  /* ===== ui header with accordions ===== */
  return (
    <div className="mx-auto flex w-full flex-col gap-5 p-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">flood events dashboard</h1>
        <p className="text-muted-foreground">
          weighted amenity impact × road centrality → flood index. click a row or map point to focus. press <kbd>esc</kbd> to clear.
        </p>

        <div className="space-y-3">
          <Accordion title="filters" default_open>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-4 flex gap-2">
                <input
                  value={q}
                  onChange={(e)=>{ set_q(e.target.value); set_page(1); }}
                  placeholder="search id / location / road…"
                  className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring"
                />
              </div>

              <select value={event_type} onChange={(e)=>{ set_event_type(e.target.value); set_page(1); }} className="md:col-span-2 rounded-lg border bg-background px-3 py-2 text-sm">
                {event_type_options.map((t)=>(<option key={t} value={t}>{t==="all"?"all types":t.replace("_"," ")}</option>))}
              </select>
              <select value={pa_filter} onChange={(e)=>{ set_pa_filter(e.target.value); set_page(1); }} className="md:col-span-3 rounded-lg border bg-background px-3 py-2 text-sm">
                {pa_options.map((n)=>(<option key={n} value={n}>{n==="all"?"all planning areas":n}</option>))}
              </select>
              <select value={sz_filter} onChange={(e)=>{ set_sz_filter(e.target.value); set_page(1); }} className="md:col-span-3 rounded-lg border bg-background px-3 py-2 text-sm">
                {sz_options.map((n)=>(<option key={n} value={n}>{n==="all"?"all subzones":n}</option>))}
              </select>

              <input type="date" value={from_str} onChange={(e)=>{ set_from_str(e.target.value); set_page(1); }} className="md:col-span-2 rounded-lg border bg-background px-3 py-2 text-sm" />
              <input type="date" value={to_str} onChange={(e)=>{ set_to_str(e.target.value); set_page(1); }} className="md:col-span-2 rounded-lg border bg-background px-3 py-2 text-sm" />

              <div className="md:col-span-12 flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={show_page_rings && mode==="distance"} onChange={(e)=>set_show_page_rings(e.target.checked)} disabled={mode!=="distance"} />
                  <span>show rings for visible page (distance mode)</span>
                </label>
                <div className="flex items-center gap-3">
                  <button onClick={()=>{ set_q(""); set_event_type("all"); set_pa_filter("all"); set_sz_filter("all"); set_from_str(""); set_to_str(""); set_page(1); }} className="rounded-lg border px-3 py-2 text-sm hover:bg-muted">clear</button>
                  <button onClick={()=>set_page((p)=>clamp(p-1,1,total_pages))} className="rounded-lg border px-2 py-1 text-sm hover:bg-muted">prev</button>
                  <button onClick={()=>set_page((p)=>clamp(p+1,1,total_pages))} className="rounded-lg border px-2 py-1 text-sm hover:bg-muted">next</button>
                  <button onClick={export_csv} className="rounded-lg border px-2 py-1 text-sm hover:bg-muted">export csv</button>
                </div>
              </div>
            </div>
          </Accordion>

          <Accordion title="settings" default_open>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              <Accordion title="mode" default_open>
                <div className="flex items-center gap-2 text-sm">
                  <label className={`rounded-lg border px-2 py-1 cursor-pointer ${mode==="distance"?"bg-muted":""}`}>
                    <input type="radio" name="mode" className="mr-2" checked={mode==="distance"} onChange={()=>set_mode("distance")} />
                    distance rings
                  </label>
                  <label className={`rounded-lg border px-2 py-1 cursor-pointer ${mode==="isochrone"?"bg-muted":""}`}>
                    <input type="radio" name="mode" className="mr-2" checked={mode==="isochrone"} onChange={()=>set_mode("isochrone")} />
                    travel-time isochrone
                  </label>
                </div>

                {mode==="isochrone" && (
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-24">profile</span>
                      <select value={iso_profile} onChange={(e)=>set_iso_profile(e.target.value)} className="rounded border px-2 py-1">
                        <option value="driving">driving</option>
                        <option value="walking">walking</option>
                        <option value="cycling">cycling</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-24">inner (min)</span>
                      <input type="number" min={1} value={iso_inner_min} onChange={(e)=>set_iso_inner_min(clamp(+e.target.value||1,1,120))} className="w-24 rounded border px-2 py-1" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-24">outer (min)</span>
                      <input type="number" min={1} value={iso_outer_min} onChange={(e)=>set_iso_outer_min(clamp(+e.target.value||1,1,240))} className="w-24 rounded border px-2 py-1" />
                    </div>
                    <div className="text-[11px] text-muted-foreground">note: local isochrone coming later; ui kept for continuity.</div>
                  </div>
                )}
              </Accordion>

              <Accordion title="rings (meters)" default_open>
                <div className="flex items-center gap-2 text-sm">
                  <label className="w-20">inner</label>
                  <input type="number" min={0} value={r_inner} onChange={(e)=>set_r_inner(clamp(+e.target.value||0,0,5000))} className="w-24 rounded border px-2 py-1" />
                </div>
                <div className="flex items-center gap-2 text-sm mt-2">
                  <label className="w-20">outer</label>
                  <input type="number" min={0} value={r_outer} onChange={(e)=>set_r_outer(clamp(+e.target.value||0,0,10000))} className="w-24 rounded border px-2 py-1" />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">outer is clamped ≥ inner</div>
              </Accordion>

              <Accordion title="ring multipliers" default_open>
                <div className="flex items-center gap-2 text-sm">
                  <label className="w-24">inner</label>
                  <input type="number" step="0.1" value={inner_mult} onChange={(e)=>set_inner_mult(clamp(+e.target.value||0,0,10))} className="w-24 rounded border px-2 py-1"/>
                </div>
                <div className="flex items-center gap-2 text-sm mt-2">
                  <label className="w-24">outer</label>
                  <input type="number" step="0.1" value={outer_mult} onChange={(e)=>set_outer_mult(clamp(+e.target.value||0,0,10))} className="w-24 rounded border px-2 py-1"/>
                </div>
              </Accordion>

              <Accordion
                title="index blend"
                right={<span className="text-xs">centrality {w_centrality.toFixed(2)} · amenity {w_amenity.toFixed(2)}</span>}
                default_open
              >
                <div className="space-y-2">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={w_centrality}
                    onChange={(e)=>{ const v = clamp(+e.target.value||0,0,1); set_w_centrality(v); set_w_amenity(+(1-v).toFixed(2)); }}
                    className="w-full"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>amenity-heavy</span>
                    <span>centrality-heavy</span>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border p-3 text-xs leading-relaxed bg-muted/40">
                  <div className="font-medium mb-1">how flood index is calculated (current)</div>
                  <div><b>flood index</b> = w<sub>centrality</sub> · <i>centrality score</i> + w<sub>amenity</sub> · <i>amenity score</i></div>
                  <ul className="list-disc pl-5 mt-2 space-y-1">
                    <li><i>centrality score</i> = 0.6 · b<sub>norm</sub> + 0.4 · c<sub>norm</sub>, where b<sub>norm</sub>, c<sub>norm</sub> are the selected road’s betweenness / closeness normalized to [0,1] across all roads.</li>
                    <li><i>amenity score</i> = 1 − exp(− <i>impact total</i> / 10). this saturates as impact grows (diminishing returns).</li>
                    <li><i>impact total</i> = inner_mult · Σ(weight(category) for amenities ≤ inner m) + outer_mult · Σ(weight(category) for inner&lt;distance≤outer).</li>
                  </ul>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    tip: move the slider to shift importance between network centrality vs nearby amenity density.
                  </div>
                </div>
              </Accordion>
            </div>

            <Accordion title="amenity category weights" default_open>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                {categories.length ? categories.map((c)=> {
                  const name = c.amenity_category;
                  return (
                    <label key={c.id} className="flex items-center gap-2">
                      <span className="capitalize w-44 truncate">{name}</span>
                      <input
                        type="number" step="0.1"
                        value={cat_weights[name] ?? 1}
                        onChange={(e)=>setCatWeights(s=>({...s, [name]: +e.target.value || 0}))}
                        className="w-20 rounded border px-2 py-1"
                      />
                    </label>
                  );
                }) : (
                  Object.keys(default_weight_by_category).map((name)=>(
                    <label key={name} className="flex items-center gap-2">
                      <span className="capitalize w-44 truncate">{name}</span>
                      <input
                        type="number" step="0.1"
                        value={cat_weights[name] ?? 1}
                        onChange={(e)=>setCatWeights(s=>({...s, [name]: +e.target.value || 0}))}
                        className="w-20 rounded border px-2 py-1"
                      />
                    </label>
                  ))
                )}
              </div>
            </Accordion>
          </Accordion>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 relative rounded-3xl border border-border bg-card shadow-sm h-[36rem] overflow-hidden">
            {selected && (
            <div className="flood-legend absolute left-3 top-3 z-10 rounded-xl p-3 text-xs shadow-lg">
              <div className="mb-2 font-medium">legend</div>
              <div className="flex items-center gap-2 mb-1"><span className="legend-swatch" style={{background:"#22c55e"}} /><span>origin / inner ring / inner roads</span></div>
              <div className="flex items-center gap-2 mb-1"><span className="legend-swatch" style={{background:"#3b82f6"}} /><span>start</span></div>
              <div className="flex items-center gap-2 mb-2"><span className="legend-swatch" style={{background:"#f59e0b"}} /><span>predicted a / b</span></div>
              <div className="flex items-center gap-2 mb-2"><span className="legend-swatch" style={{background:"#ef4444"}} /><span>end</span></div>
              <div className="flex items-center gap-2 mb-2"><span className="legend-swatch" style={{background:"#0ea5e9"}} /><span>outer ring / outer roads</span></div>
            </div>
          )}
          <div ref={container_ref} className="h-full w-full min-h-[36rem]" />
        </div>

          <div className="lg:col-span-1 rounded-3xl border border-border bg-card shadow-sm h-[36rem] overflow-hidden flex flex-col">
            <div className="p-4 border-b flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-muted-foreground mb-1">
                {panel_tab==="amenities" ? "nearby amenities (≤ outer meters)" : "nearby roads (≤ outer meters)"}
              </div>
              <div className="text-base font-semibold truncate">
                {selected_props ? (selected_props.start_road || selected_props.parent_road || "—") : "—"}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {selected_props ? (selected_props.start_planning_area || "—") : "select a flood to view"}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1">
              <button onClick={()=>set_panel_tab("amenities")} className={`rounded-lg border px-2 py-1 text-xs hover:bg-muted ${panel_tab==="amenities"?"bg-muted":""}`}>amenities</button>
              <button onClick={()=>set_panel_tab("roads")} className={`rounded-lg border px-2 py-1 text-xs hover:bg-muted ${panel_tab==="roads"?"bg-muted":""}`}>roads</button>
              <button onClick={()=>set_ring_filter("all")}   className={`rounded-lg border px-2 py-1 text-xs hover:bg-muted ${ring_filter==="all"?"bg-muted":""}`}>all</button>
              <button onClick={()=>set_ring_filter("inner")} className={`rounded-lg border px-2 py-1 text-xs hover:bg-muted ${ring_filter==="inner"?"bg-muted":""}`}>≤{r_inner}m</button>
              <button onClick={()=>set_ring_filter("outer")} className={`rounded-lg border px-2 py-1 text-xs hover:bg-muted ${ring_filter==="outer"?"bg-muted":""}`}>≤{r_outer}m</button>
              <button onClick={()=>set_panel_open(v=>!v)} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                {panel_open ? "collapse" : "expand"}
              </button>
            </div>
          </div>

          {panel_open ? (
            <div className="flex-1 overflow-y-auto p-3">
              {selected_stats && (
                <div className="mb-3 rounded-lg border p-3 text-xs bg-muted/40">
                  <div className="font-medium mb-1">flood index (live)</div>
                  <div>centrality {w_centrality.toFixed(2)} · amenity {w_amenity.toFixed(2)}</div>
                  <div className="mt-1">index = {selected_stats.scores?.flood_index ?? "—"}</div>
                </div>
              )}

              {selected_stats ? (
                panel_tab === "amenities" ? (
                  <AmenitiesPanel
                    center={selected_stats.center}
                    stats={selected_stats}
                    amenity_list={amenity_list}
                    ring_filter={ring_filter}
                    r_inner={r_inner}
                    r_outer={r_outer}
                    on_center={(lng, lat) => map_ref.current?.flyTo({ center: [lng, lat], zoom: 17, essential: true })}
                  />
                ) : (
                  <RoadsPanel
                    center={selected_stats.center}
                    roads_pack={roads_nearby_state}
                    ring_filter={ring_filter}
                    r_inner={r_inner}
                    r_outer={r_outer}
                    on_focus_rn={(geom) => {
                      const map = map_ref.current;
                      if (!map || !geom) return;
                      try {
                        const bb = turf.bbox({ type:"Feature", geometry: geom, properties:{} });
                        map.fitBounds([[bb[0],bb[1]],[bb[2],bb[3]]], { padding: 60, duration: 500 });
                      } catch {}
                    }}
                  />
                )
              ) : (
                <div className="h-full grid place-items-center text-sm text-muted-foreground p-6">
                  select a flood on the left to see details here.
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 text-xs text-muted-foreground">panel collapsed</div>
          )}
        </div>
      </div>

      <section className="rounded-3xl border border-border bg-card shadow-sm overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.filter(c=>visible_cols[c.key]).map((c)=>{
                const k = c.key === "event_date" ? "dt" : c.key;
                return (
                  <th key={c.key} className="px-4 py-2">
                    <button onClick={()=>toggle_sort(k)} className="inline-flex items-center gap-1">
                      <span>{c.label}</span>
                      <span className="opacity-70">{sort_icon(k)}</span>
                    </button>
                  </th>
                );
              })}
              <th className="px-4 py-2">action</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => {
              const active = String(selected ?? "") === String(r.id);
              return (
                <tr
                  key={r.id}
                  onClick={() => set_selected(prev => {
                    const next = String(prev) === String(r.id) ? null : r.id;
                    if (next) focus_select(next); else clear_selection();
                    return next;
                  })}
                  className={`cursor-pointer hover:bg-muted/60 ${active ? "bg-muted/80 font-medium" : ""}`}
                >
                  {columns.filter(c=>visible_cols[c.key]).map((c)=>(
                    <td key={c.key} className="px-4 py-2">
                      {c.render ? c.render(r[c.key]) : (r[c.key] ?? "—")}
                    </td>
                  ))}
                  <td className="px-4 py-2">
                    <button
                      onClick={(e)=>{ e.stopPropagation(); set_selected(prev => {
                        const next = String(prev) === String(r.id) ? null : r.id;
                        if (next) focus_select(next); else clear_selection();
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
            {paged.length === 0 && (
              <tr><td colSpan={columns.filter(c=>visible_cols[c.key]).length+1} className="px-4 py-6 text-center text-muted-foreground">no rows match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </section>

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
        .flood-legend {
          background: rgba(2, 6, 23, 0.92);
          color: #e5e7eb;
          border: 1px solid rgba(148, 163, 184, .25);
          backdrop-filter: blur(6px) saturate(120%);
        }
        @media (prefers-color-scheme: light) {
          .flood-legend {
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

/* ===== amenities panel (capitalized component) ===== */
function AmenitiesPanel({ center, stats, amenity_list, ring_filter, r_inner, r_outer, on_center }) {
  const [q, set_q] = useState("");
  const [open_band, set_open_band] = useState({ inner: true, outer: true });
  const [open_types, set_open_types] = useState({});
  const [limit_per_type, set_limit_per_type] = useState(200);

  const list = useMemo(() => {
    if (!center || !stats) return [];
    const pad = 0.009;
    const arr = [];
    for (const a of amenity_list) {
      if (a.lng < center[0] - pad || a.lng > center[0] + pad || a.lat < center[1] - pad || a.lat > center[1] + pad) continue;
      const d = turf.distance([center[0], center[1]], [a.lng, a.lat], { units: "kilometers" }) * 1000;
      if (d <= Math.max(r_inner, r_outer)) {
        arr.push({ ...a, distm: Math.round(d), band: d <= Math.max(0, Math.min(r_inner, r_outer)) ? "inner" : "outer" });
      }
    }
    return arr;
  }, [center, stats, amenity_list, r_inner, r_outer]);

  const needle = q.trim().toLowerCase();
  const filtered = list
    .filter(r => (ring_filter === "all" || r.band === ring_filter))
    .filter(r => !needle || (r.name || "").toLowerCase().includes(needle) || (r.category || "").toLowerCase().includes(needle));

  const grouped = useMemo(() => {
    const g = { inner: new Map(), outer: new Map() };
    for (const r of filtered) {
      const key = r.category || "others";
      const bucket_map = g[r.band];
      if (!bucket_map.has(key)) bucket_map.set(key, []);
      bucket_map.get(key).push(r);
    }
    return g;
  }, [filtered]);

  const totals = useMemo(() => {
    if (!stats) return { inner: 0, outer: 0, total: 0, types_inner: 0, types_outer: 0 };
    const inner = stats.counts?.inner || 0;
    const outer = stats.counts?.outer || 0;
    return { inner, outer, total: inner + outer, types_inner: grouped.inner.size, types_outer: grouped.outer.size };
  }, [stats, grouped]);

  if (!center || !stats) return <div className="text-sm text-muted-foreground p-3">select a flood to compute nearby amenities.</div>;
  if (totals.total === 0) return <div className="text-sm text-muted-foreground p-3">no amenities within ≤{r_outer} m.</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e)=>set_q(e.target.value)} placeholder="search name / category…" className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          total: <b>{totals.total}</b> · index: <b>{stats.scores?.flood_index ?? "—"}</b>
        </span>
      </div>

      {(["inner","outer"]).filter(b => ring_filter==="all" || ring_filter===b).map((band)=>{
        const m = grouped[band];
        const is_open = open_band[band];
        const count = band==="inner" ? totals.inner : totals.outer;
        const label = band==="inner" ? `≤${r_inner} m` : `≤${r_outer} m`;
        if (count===0) return null;
        return (
          <div key={band} className="rounded-2xl border">
            <div className="flex items-center justify-between p-3">
              <div className="space-y-0.5">
                <div className="text-xs text-muted-foreground uppercase">{label}</div>
                <div className="text-sm"><b>{count}</b> amenities</div>
              </div>
              <button onClick={()=>set_open_band((s)=>({ ...s, [band]: !s[band] }))} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                {is_open ? "collapse" : "expand"}
              </button>
            </div>

            {is_open && (
              <div className="p-2 pt-0">
                {[...m.keys()].sort((a,b)=>a.localeCompare(b)).map((bucket)=>{
                  const items = m.get(bucket) || [];
                  const tkey = `${band}::${bucket}`;
                  const open = (open_types[tkey] ?? true);
                  const show = open ? items.slice(0, limit_per_type) : [];
                  const more = open && items.length > limit_per_type;

                  return (
                    <div key={bucket} className="mb-2 rounded-xl border">
                      <div className="flex items-center justify-between p-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs capitalize">{bucket}</span>
                          <span className="text-xs text-muted-foreground">· {items.length}</span>
                        </div>
                        <button onClick={()=>set_open_types((s)=>({ ...s, [tkey]: !(s[tkey] ?? true) }))} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                          {open ? "hide" : "show"}
                        </button>
                      </div>

                      {open && (
                        <div className="max-h-64 overflow-auto divide-y">
                          {show.map((a)=>(
                            <div key={a.id} className="p-2 text-sm flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-medium truncate">{a.name || "(unnamed)"}</div>
                                <div className="text-[11px] text-muted-foreground font-mono">{fmt(a.lat,5)}, {fmt(a.lng,5)} · {a.distm} m</div>
                              </div>
                              <div className="shrink-0">
                                <button className="rounded-lg border px-2 py-1 text-xs hover:bg-muted" onClick={()=>on_center?.(a.lng, a.lat)}>focus</button>
                              </div>
                            </div>
                          ))}
                          {more && (
                            <div className="p-2 text-center">
                              <button onClick={()=>set_limit_per_type((n)=>clamp(n+200,0,5000))} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                                show more…
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ===== roads panel (capitalized component) ===== */
function RoadsPanel({ center, roads_pack, ring_filter, r_inner, r_outer, on_focus_rn }) {
  const [q, set_q] = useState("");
  const [open_band, set_open_band] = useState({ inner: true, outer: true });
  const [limit, set_limit] = useState(300);

  const list = useMemo(() => {
    const rows = [];
    for (const band of ["inner","outer"]) {
      for (const r of roads_pack[band] || []) {
        rows.push({ ...r, band });
      }
    }
    return rows;
  }, [roads_pack]);

  const needle = q.trim().toLowerCase();
  const filtered = list
    .filter(r => (ring_filter === "all" || r.band === ring_filter))
    .filter(r => !needle || (r.name || "").toLowerCase().includes(needle) || String(r.rn_id || "").includes(needle));

  const grouped = useMemo(() => {
    return {
      inner: (filtered.filter(x=>x.band==="inner")),
      outer: (filtered.filter(x=>x.band==="outer")),
    };
  }, [filtered]);

  const totals = useMemo(() => ({
    inner: roads_pack.inner?.length || 0,
    outer: roads_pack.outer?.length || 0,
    total: (roads_pack.inner?.length || 0) + (roads_pack.outer?.length || 0),
  }), [roads_pack]);

  if (!center) return <div className="text-sm text-muted-foreground p-3">select a flood to compute nearby roads.</div>;
  if (totals.total === 0) return <div className="text-sm text-muted-foreground p-3">no roads within ≤{r_outer} m.</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e)=>set_q(e.target.value)} placeholder="search road name / rn id…" className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">total: <b>{totals.total}</b></span>
      </div>

      {(["inner","outer"]).filter(b => ring_filter==="all" || ring_filter===b).map((band)=>{
        const rows = grouped[band] || [];
        if (!rows.length) return null;
        const is_open = open_band[band];
        const label = band==="inner" ? `≤${r_inner} m` : `≤${r_outer} m`;
        return (
          <div key={band} className="rounded-2xl border">
            <div className="flex items-center justify-between p-3">
              <div className="space-y-0.5">
                <div className="text-xs text-muted-foreground uppercase">{label}</div>
                <div className="text-sm"><b>{rows.length}</b> roads</div>
              </div>
              <button onClick={()=>set_open_band((s)=>({ ...s, [band]: !s[band] }))} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                {is_open ? "collapse" : "expand"}
              </button>
            </div>

            {is_open && ( 
              <div className="max-h-64 overflow-auto divide-y">
                {rows.slice(0, limit).map((r, i)=>(
                  <div key={`${r.rn_id}-${i}-${r.d}`} className="p-2 text-sm flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">rn_id: {r.rn_id ?? "—"} · {r.d} m</div>
                    </div>
                    <div className="shrink-0">
                      <button className="rounded-lg border px-2 py-1 text-xs hover:bg-muted" onClick={()=>on_focus_rn?.(r.geometry)}>focus</button>
                    </div>
                  </div>
                ))}
                {rows.length > limit && (
                  <div className="p-2 text-center">
                    <button onClick={()=>set_limit(n=>clamp(n+300,0,5000))} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                      show more…
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
