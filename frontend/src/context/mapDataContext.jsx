// src/context/MapDataContext.jsx
"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

/* ========= backend config ========= */
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || "https://fyp-ba-water-bender-six.vercel.app").trim();
const BACKEND_TOKEN = (import.meta.env.VITE_BACKEND_TOKEN || "").trim();

/* ========= tiny csv parser ========= */
function parse_csv(text = "") {
  const s = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", i = 0, in_quotes = false;
  const push_cell = () => { row.push(cell); cell = ""; };
  const push_row = () => { if (row.length) rows.push(row); row = []; };

  while (i < s.length) {
    const ch = s[i];
    if (in_quotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        in_quotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { in_quotes = true; i++; continue; }
    if (ch === ",") { push_cell(); i++; continue; }
    if (ch === "\r") { push_cell(); push_row(); i += (s[i + 1] === "\n" ? 2 : 1); continue; }
    if (ch === "\n") { push_cell(); push_row(); i++; continue; }
    cell += ch; i++;
  }
  push_cell(); push_row();

  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map(h => h.trim());
  const records = rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, idx) => { o[h] = (r[idx] ?? "").trim(); });
    return o;
  });
  return { headers, records };
}

/* ========= utils ========= */
const to_num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const to_int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const nz = (v) => (v === "" || v === undefined || v === null ? null : v);
const null_if_zero = (v) => { const n = to_int(v); return n === null ? null : (n === 0 ? null : n); };
const slug = (s) => String(s || "").toLowerCase().trim();

/* ========= date parser (supports dd/mm/yyyy and yyyy-mm-dd) ========= */
function parse_event_date(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;

  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

/* ========= geometry helper (strip crs) ========= */
function strip_crs(geom) {
  if (!geom || typeof geom !== "object") return geom;
  const { crs, ...rest } = geom;
  return rest;
}

/* ========= csv → featurecollection ========= */
function amenities_csv_to_fc(csv_text) {
  const { records } = parse_csv(csv_text);
  const features = records.map((rec, idx) => {
    const lat = to_num(rec.lat);
    const lon = to_num(rec.lon);
    if (lat == null || lon == null) return null;
    const id = nz(rec.amenity_id) ?? nz(rec.id) ?? idx;
    return {
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        ...rec,
        amenity_id: nz(rec.amenity_id) ?? String(id),
        amenity_category_id: null_if_zero(rec.amenity_category_id),
        amenity_category: nz(rec.amenity_category),
        amenity_type: nz(rec.amenity_type),
        amenity_name: nz(rec.amenity_name ?? rec.name ?? rec.poi_name ?? rec.display_name),
        pa_id: null_if_zero(rec.pa_id),
        sz_id: null_if_zero(rec.sz_id),
        rn_id: null_if_zero(rec.rn_id),
      },
    };
  }).filter(Boolean);
  return { type: "FeatureCollection", features };
}

function floods_csv_to_fc(csv_text) {
  const { records } = parse_csv(csv_text);
  const features = records.map((rec, idx) => {
    let lat = to_num(rec.start_lat);
    let lon = to_num(rec.start_lng);
    if (lat == null || lon == null) { lat = to_num(rec.end_lat); lon = to_num(rec.end_lng); }
    if (lat == null || lon == null) return null;
    const id = nz(rec.id) ?? idx;
    return {
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        ...rec,
        id,
        start_pa_id: null_if_zero(rec.start_pa_id),
        start_sz_id: null_if_zero(rec.start_sz_id),
        start_rn_id: null_if_zero(rec.start_rn_id),
        end_pa_id: null_if_zero(rec.end_pa_id),
        end_sz_id: null_if_zero(rec.end_sz_id),
        end_rn_id: null_if_zero(rec.end_rn_id),
        origin_pa_id: null_if_zero(rec.origin_pa_id),
        origin_sz_id: null_if_zero(rec.origin_sz_id),
        origin_rn_id: null_if_zero(rec.origin_rn_id),
        event: nz(rec.event),
        event_date_iso: parse_event_date(rec.event_date),
        origin_lat: to_num(rec.origin_lat),
        origin_lng: to_num(rec.origin_lng),
        end_lat: to_num(rec.end_lat),
        end_lng: to_num(rec.end_lng),
      },
    };
  }).filter(Boolean);
  return { type: "FeatureCollection", features };
}

/* ========= generic featurecollection helper ========= */
function as_feature_collection(data) {
  if (!data) return { type: "FeatureCollection", features: [] };
  if ((data.type || "") === "FeatureCollection") return data;
  return { type: "FeatureCollection", features: Array.isArray(data) ? data : [] };
}

/* ========= planning-area API → featurecollection ========= */
function planning_api_to_fc(json) {
  const rows = json?.data ?? json ?? [];
  const features = (Array.isArray(rows) ? rows : []).map((row, idx) => {
    const geom_raw = row.geom || row.geometry || row.GEOM;
    if (!geom_raw || !geom_raw.type || !geom_raw.coordinates) return null;
    const geom = strip_crs(geom_raw);

    const { geom: _g, geometry: _g2, GEOM: _g3, ...props } = row;
    const pa_id = to_int(props.pa_id ?? props.PA_ID ?? idx);

    return {
      type: "Feature",
      id: pa_id,
      geometry: geom,
      properties: {
        ...props,
        pa_id,
        pln_area_n: props.pln_area_n ?? props.PLN_AREA_N ?? null,
      },
    };
  }).filter(Boolean);

  return { type: "FeatureCollection", features };
}

/* ========= subzone API → featurecollection ========= */
function subzone_api_to_fc(json) {
  const rows = json?.data ?? json ?? [];
  const features = (Array.isArray(rows) ? rows : []).map((row, idx) => {
    const geom_raw = row.geom || row.geometry || row.GEOM;
    if (!geom_raw || !geom_raw.type || !geom_raw.coordinates) return null;
    const geom = strip_crs(geom_raw);

    const { geom: _g, geometry: _g2, GEOM: _g3, ...props } = row;
    const sz_id = to_int(props.sz_id ?? props.SZ_ID ?? idx);

    return {
      type: "Feature",
      id: sz_id,
      geometry: geom,
      properties: {
        ...props,
        sz_id,
        pa_id: to_int(props.pa_id ?? props.PA_ID ?? null),
        subzone_n: props.subzone_n ?? props.SUBZONE_N ?? null,
        pln_area_n: props.pln_area_n ?? props.PLN_AREA_N ?? null,
      },
    };
  }).filter(Boolean);

  return { type: "FeatureCollection", features };
}

/* ========= floods API → featurecollection ========= */
function floods_api_to_fc(json) {
  const rows = json?.data ?? json ?? [];
  const features = (Array.isArray(rows) ? rows : []).map((rec, idx) => {
    const id = nz(rec.id) ?? idx;

    let geom = rec.geom || rec.geometry || rec.GEOM;
    if (geom && geom.type && geom.coordinates) {
      geom = strip_crs(geom);
    } else {
      let lat = to_num(rec.start_lat);
      let lon = to_num(rec.start_lng);
      if (lat == null || lon == null) { lat = to_num(rec.end_lat); lon = to_num(rec.end_lng); }
      if (lat == null || lon == null) return null;
      geom = { type: "Point", coordinates: [lon, lat] };
    }

    return {
      type: "Feature",
      id,
      geometry: geom,
      properties: {
        ...rec,
        id,
        start_pa_id: null_if_zero(rec.start_pa_id),
        start_sz_id: null_if_zero(rec.start_sz_id),
        start_rn_id: null_if_zero(rec.start_rn_id),
        end_pa_id: null_if_zero(rec.end_pa_id),
        end_sz_id: null_if_zero(rec.end_sz_id),
        end_rn_id: null_if_zero(rec.end_rn_id),
        origin_pa_id: null_if_zero(rec.origin_pa_id),
        origin_sz_id: null_if_zero(rec.origin_sz_id),
        origin_rn_id: null_if_zero(rec.origin_rn_id),
        event: nz(rec.event),
        event_date_iso: parse_event_date(rec.event_date),
        start_lat: to_num(rec.start_lat),
        start_lng: to_num(rec.start_lng),
        origin_lat: to_num(rec.origin_lat),
        origin_lng: to_num(rec.origin_lng),
        end_lat: to_num(rec.end_lat),
        end_lng: to_num(rec.end_lng),
        end100_a_lat: to_num(rec.end100_a_lat),
        end100_a_lng: to_num(rec.end100_a_lng),
        end100_b_lat: to_num(rec.end100_b_lat),
        end100_b_lng: to_num(rec.end100_b_lng),
      },
    };
  }).filter(Boolean);

  return { type: "FeatureCollection", features };
}

/* ========= amenities API → featurecollection ========= */
function amenities_api_to_fc(json) {
  const rows = json?.data ?? json ?? [];
  const features = (Array.isArray(rows) ? rows : []).map((rec, idx) => {
    const lat = to_num(rec.lat);
    const lon = to_num(rec.lon);
    if (lat == null || lon == null) return null;
    const id = nz(rec.amenity_id ?? rec.id) ?? idx;

    return {
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        ...rec,
        amenity_id: nz(rec.amenity_id ?? rec.id) ?? String(id),
        amenity_category_id: null_if_zero(rec.amenity_category_id),
        amenity_category: nz(rec.amenity_category),
        amenity_type: nz(rec.amenity_type),
        amenity_name: nz(rec.amenity_name ?? rec.name ?? rec.poi_name ?? rec.display_name),
        pa_id: null_if_zero(rec.pa_id),
        sz_id: null_if_zero(rec.sz_id),
        rn_id: null_if_zero(rec.rn_id),
        postalcode: nz(rec.postalcode ?? rec.postal_code),
      },
    };
  }).filter(Boolean);
  return { type: "FeatureCollection", features };
}

/* ========= road API → featurecollection ========= */
function road_api_to_fc(json) {
  const rows = json?.data ?? json ?? [];
  const features = (Array.isArray(rows) ? rows : []).map((row, idx) => {
    const geom_raw = row.geom || row.geometry || row.GEOM;
    if (!geom_raw || !geom_raw.type || !geom_raw.coordinates) return null;
    const geom = strip_crs(geom_raw);

    const { geom: _g, geometry: _g2, GEOM: _g3, ...props } = row;
    const rn_id = to_int(props.rn_id ?? props.RN_ID ?? idx);

    return {
      type: "Feature",
      id: rn_id,
      geometry: geom,
      properties: {
        ...props,
        rn_id,
        name: props.name ?? props.RD_NAME ?? null,
        sz_id: to_int(props.sz_id ?? props.SZ_ID ?? null),
        pa_id: to_int(props.pa_id ?? props.PA_ID ?? null),
        subzone_n: props.subzone_n ?? props.SUBZONE_N ?? null,
        pln_area_n: props.pln_area_n ?? props.PLN_AREA_N ?? null,
      },
    };
  }).filter(Boolean);

  return { type: "FeatureCollection", features };
}

/* ========= amenity category lookups ========= */
function build_category_lookup(csv_text) {
  const { records } = parse_csv(csv_text);
  return build_category_lookup_from_records(records);
}

function build_category_lookup_from_records(records) {
  const by_id = Object.create(null);
  const by_name = Object.create(null);
  const table = [];
  for (const r of records) {
    const id = to_int(r.amenity_category_id);
    const name = String(r.amenity_category || "").trim();
    if (id == null || !name) continue;
    const row = {
      id,
      amenity_category: name,
      slug: slug(name),
      amenity_priority: r.amenity_priority != null ? to_int(r.amenity_priority) : null,
      amenity_weight: r.amenity_weight != null ? to_num(r.amenity_weight) : null,
      importance_score: r.importance_score != null ? to_num(r.importance_score) : null,
    };
    by_id[id] = row;
    by_name[row.slug] = row;
    table.push(row);
  }
  table.sort((a, b) => a.id - b.id);
  return { by_id, by_name, table };
}

function build_category_lookup_from_api(json) {
  const rows = json?.data ?? json ?? [];
  return build_category_lookup_from_records(rows);
}

/* ========= scenario builder (shared for csv + api) ========= */
function build_scenarios_from_records(records) {
  const byScenario = new Map();

  for (const row of records) {
    const scenario = row.flood_scenario?.trim();
    const rn_id = to_int(row.RN_ID ?? row.rn_id);
    const name = (row.RD_NAME ?? row.rd_name ?? "").trim() || `Road ${rn_id}`;
    const pa_name = (row.PLN_AREA_N ?? row.pln_area_n ?? "").trim() || null;

    if (!scenario || rn_id == null) continue;

    if (!byScenario.has(scenario)) {
      byScenario.set(scenario, []);
    }
    byScenario.get(scenario).push({ rn_id, name, pa_name });
  }

  const scenarios = Array.from(byScenario.entries()).map(([name, roads]) => {
    let description = `${roads.length} roads affected in this scenario.`;

    if (name === "PUB_100RP_highest60mins") {
      description = "PUB's 1 in 100 year return period (based on Code of Practice for drainage design) for the highest 60 minute rainfall";
    } else if (name === "Historical_highest60mins") {
      description = "Historical extreme for the highest 60 minute rainfall";
    } else if (name === "V3_future_highest60mins") {
      description = "Future projected highest 60 minute rainfall";
    } else if (name.includes("Historical")) {
      description = `Simulates ${name.replace(/_/g, " ")} flood scenario affecting ${roads.length} roads across major arterial routes.`;
    }

    return { name, roads, description };
  });

  return scenarios;
}

/* ========= lookup builders ========= */
function build_planning_lookup(planning_fc) {
  const by_id = Object.create(null), by_name = Object.create(null);
  for (const f of planning_fc.features || []) {
    const pa_id = to_int(f.properties?.pa_id ?? f.properties?.PA_ID);
    const name = f.properties?.pln_area_n ?? f.properties?.PLN_AREA_N;
    if (pa_id == null || !name) continue;
    const item = { id: pa_id, name, slug: slug(name), props: f.properties };
    by_id[pa_id] = item; by_name[item.slug] = item;
  }
  return { by_id, by_name };
}

function build_subzone_lookup(subzone_fc) {
  const by_id = Object.create(null), by_name = Object.create(null);
  for (const f of subzone_fc.features || []) {
    const sz_id = to_int(f.properties?.sz_id ?? f.properties?.SZ_ID);
    const pa_id = to_int(f.properties?.pa_id ?? f.properties?.PA_ID);
    const name = f.properties?.subzone_n ?? f.properties?.SUBZONE_N;
    if (sz_id == null || !name) continue;
    const item = { id: sz_id, name, slug: slug(name), pa_id, props: f.properties };
    by_id[sz_id] = item; by_name[item.slug] = item;
  }
  return { by_id, by_name };
}

function build_road_lookup(road_fc) {
  const by_id = Object.create(null);
  for (const f of road_fc.features || []) {
    const rn_id = to_int(f.properties?.rn_id ?? f.properties?.RN_ID);
    if (rn_id == null) continue;
    by_id[rn_id] = { id: rn_id, name: nz(f.properties?.name), props: f.properties };
  }
  return { by_id };
}

/* ========= enrich floods (origin-centric) ========= */
function enrich_floods(floods_fc, lookups) {
  const { planning, subzone, road } = lookups;

  const features = (floods_fc.features || []).map((f) => {
    const p = { ...(f.properties || {}) };

    const origin_pa = p.origin_pa_id ? planning.by_id[p.origin_pa_id] : null;
    const origin_sz = p.origin_sz_id ? subzone.by_id[p.origin_sz_id] : null;
    const origin_rn = p.origin_rn_id ? road.by_id[p.origin_rn_id] : null;

    const end_pa   = p.end_pa_id ? planning.by_id[p.end_pa_id] : null;
    const end_sz   = p.end_sz_id ? subzone.by_id[p.end_sz_id] : null;
    const end_rn   = p.end_rn_id ? road.by_id[p.end_rn_id] : null;

    p.origin_planning_area = origin_pa?.name ?? null;
    p.origin_subzone       = origin_sz?.name ?? null;
    p.origin_road          = origin_rn?.name ?? null;

    p.end_planning_area = end_pa?.name ?? null;
    p.end_subzone       = end_sz?.name ?? null;
    p.end_road          = end_rn?.name ?? null;

    const origin = [to_num(p.origin_lng), to_num(p.origin_lat)];
    const endpt  = [to_num(p.end_lng),   to_num(p.end_lat)];
    p.origin_point = origin.every(Number.isFinite) ? origin : null;
    p.end_point    = endpt.every(Number.isFinite) ? endpt : null;
    p.has_segment  = Boolean(p.origin_point && p.end_point);
    p.segment      = p.has_segment
      ? { type: "LineString", coordinates: [p.origin_point, p.end_point] }
      : null;

    p.event_yyyymm = p.event_date_iso ? p.event_date_iso.slice(0, 7) : null;

    return { ...f, properties: p };
  });

  return { type: "FeatureCollection", features };
}

/* ========= enrich amenities (attach names + category) ========= */
function enrich_amenities(amenity_fc_raw, lookups, category_lookup) {
  const { planning, subzone } = lookups;
  const by_cat_id = category_lookup?.by_id || {};

  const features = (amenity_fc_raw?.features || []).map((f, idx) => {
    const p = { ...(f.properties || {}) };

    const pa_id = p.pa_id ?? p.pln_area_id ?? p.planning_area_id ?? null;
    const sz_id = p.sz_id ?? p.subzone_id ?? null;

    const pa    = pa_id != null ? planning.by_id[pa_id] : null;
    const sz    = sz_id != null ? subzone.by_id[sz_id] : null;

    const planning_area = p.planning_area
      ? String(p.planning_area).trim()
      : (pa?.name ?? null);

    const subzone_name  = p.subzone
      ? String(p.subzone).trim()
      : (sz?.name ?? null);

    const cat_id = p.amenity_category_id ?? null;
    const resolved_cat = cat_id != null && by_cat_id[cat_id]?.amenity_category
      ? by_cat_id[cat_id].amenity_category
      : (p.amenity_category ? String(p.amenity_category).trim() : null);

    const amenity_name = p.amenity_name ?? p.name ?? p.poi_name ?? p.display_name ?? `(amenity ${idx})`;
    const amenity_type = p.amenity_type ?? "";

    return {
      ...f,
      properties: {
        ...p,
        amenity_id: p.amenity_id ?? f.id ?? String(idx),
        amenity_name: String(amenity_name).trim(),
        amenity_type: String(amenity_type || "").trim(),
        amenity_category: resolved_cat ? String(resolved_cat).trim() : "others",
        planning_area: planning_area ?? "",
        subzone: subzone_name ?? "",
        pa_id: pa_id ?? null,
        sz_id: sz_id ?? null,
      },
    };
  });

  return { type: "FeatureCollection", features };
}

/* ========= context ========= */
const MapDataContext = createContext(null);

function MapDataProvider({ children }) {
  const [planning_fc_raw, set_planning_raw] = useState(null);
  const [subzone_fc_raw, set_subzone_raw] = useState(null);
  const [road_fc_raw, set_road_raw] = useState(null);
  const [floods_fc_raw, set_floods_raw] = useState(null);
  const [amenity_fc_raw, set_amenity_raw] = useState(null);
  const [category_lookup, set_category_lookup] = useState({ by_id: {}, by_name: {}, table: [] });
  const [flood_scenarios, set_flood_scenarios] = useState([]);

  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState("");

  async function auth_fetch_json(path) {
    const headers = { accept: "application/json" };
    if (BACKEND_TOKEN) headers["authorization"] = `Bearer ${BACKEND_TOKEN}`;
    const res = await fetch(`${BACKEND_URL}${path}`, { headers });
    return res;
  }

  /* ========= helper: load planning area ========= */
  async function load_planning_area() {
    try {
      const res = await auth_fetch_json("/api/planning-area/");
      if (res.ok) {
        const json = await res.json();
        console.log("✅ planning-area from api");
        return planning_api_to_fc(json);
      } else {
        console.warn("planning-area api failed with status", res.status);
      }
    } catch (e) {
      console.warn("planning-area api error", e);
    }

    console.log("ℹ️ falling back to local planning_area.geojson");
    const local = await fetch("/map/planning_area.geojson").then(r => r.json());
    return as_feature_collection(local);
  }

  /* ========= helper: load subzone ========= */
  async function load_subzone() {
    try {
      const res = await auth_fetch_json("/api/subzone/");
      if (res.ok) {
        const json = await res.json();
        console.log("✅ subzone from api");
        return subzone_api_to_fc(json);
      } else {
        console.warn("subzone api failed with status", res.status);
      }
    } catch (e) {
      console.warn("subzone api error", e);
    }

    console.log("ℹ️ falling back to local subzone_area.geojson");
    const local = await fetch("/map/subzone_area.geojson").then(r => r.json());
    return as_feature_collection(local);
  }

  /* ========= helper: load road network ========= */
  async function load_road() {
    // try {
    //   const res = await auth_fetch_json("/api/road-network/");
    //   if (res.ok) {
    //     const json = await res.json();
    //     console.log("✅ road-network from api");
    //     return road_api_to_fc(json);
    //   } else {
    //     console.warn("road-network api failed with status", res.status);
    //   }
    // } catch (e) {
    //   console.warn("road-network api error", e);
    // }

    // console.log("ℹ️ falling back to local road_network.geojson");
    const local = await fetch("/map/road_network.geojson").then(r => r.json());
    return as_feature_collection(local);
  }

  /* ========= helper: load floods ========= */
  async function load_floods() {
    try {
      const res = await auth_fetch_json("/api/flood-3layers/");
      if (res.ok) {
        const json = await res.json();
        console.log("✅ floods from api");
        return floods_api_to_fc(json);
      } else {
        console.warn("flood-3layers api failed with status", res.status);
      }
    } catch (e) {
      console.warn("flood-3layers api error", e);
    }

    console.log("ℹ️ falling back to local floods_3layers_new.csv");
    const csv = await fetch("/map/floods_3layers_new.csv").then(r => r.text());
    return floods_csv_to_fc(csv);
  }

  /* ========= helper: load amenities ========= */
  async function load_amenities() {
    try {
      const res = await auth_fetch_json("/api/amenity-3layers/");
      if (res.ok) {
        const json = await res.json();
        console.log("✅ amenities from api");
        return amenities_api_to_fc(json);
      } else {
        console.warn("amenity-3layers api failed with status", res.status);
      }
    } catch (e) {
      console.warn("amenity-3layers api error", e);
    }

    console.log("ℹ️ falling back to local amenity_3layers.csv");
    const csv = await fetch("/map/amenity_3layers.csv").then(r => r.text());
    return amenities_csv_to_fc(csv);
  }

  /* ========= helper: load amenity categories ========= */
  async function load_amenity_categories() {
    try {
      const res = await auth_fetch_json("/api/amenity-cat-lookup/");
      if (res.ok) {
        const json = await res.json();
        console.log("✅ amenity categories from api");
        return build_category_lookup_from_api(json);
      } else {
        console.warn("amenity-cat-lookup api failed with status", res.status);
      }
    } catch (e) {
      console.warn("amenity-cat-lookup api error", e);
    }

    console.log("ℹ️ falling back to local amenity_category_lookup_rows.csv");
    const csvText = await fetch("/map/amenity_category_lookup_rows.csv").then(r => r.text());
    return build_category_lookup(csvText);
  }

  /* ========= helper: load flood scenarios ========= */
  async function load_scenarios() {
    try {
      const res = await auth_fetch_json("/api/road-network-flood-scenarios/");
      if (res.ok) {
        const json = await res.json();
        console.log("✅ flood scenarios from api");
        const rows = json?.data ?? json ?? [];
        return build_scenarios_from_records(rows);
      } else {
        console.warn("road-network-flood-scenarios api failed with status", res.status);
      }
    } catch (e) {
      console.warn("road-network-flood-scenarios api error", e);
    }

    console.log("ℹ️ falling back to local road_network_flood_scenarios.csv");
    const csvText = await fetch("/map/road_network_flood_scenarios.csv").then(r => r.text());
    const { records } = parse_csv(csvText);
    return build_scenarios_from_records(records);
  }

  /* ========= load all assets ========= */
  useEffect(() => {
    (async () => {
      try {
        set_loading(true);

        const [
          planning_fc,
          subzone_fc,
          road_fc,
          floods_fc,
          amenity_fc,
          category_lookup_val,
          scenarios_val
        ] = await Promise.all([
          load_planning_area(),
          load_subzone(),
          load_road(),
          load_floods(),
          load_amenities(),
          load_amenity_categories(),
          load_scenarios(),
        ]);

        set_planning_raw(planning_fc);
        set_subzone_raw(as_feature_collection(subzone_fc));
        set_road_raw(as_feature_collection(road_fc));
        set_floods_raw(floods_fc);
        set_amenity_raw(amenity_fc);
        set_category_lookup(category_lookup_val);
        set_flood_scenarios(scenarios_val);

      } catch (e) {
        console.error(e);
        set_error(e?.message || "failed to load map data.");
      } finally {
        set_loading(false);
      }
    })();
  }, []);

  /* ========= lookups ========= */
  const lookups = useMemo(() => ({
    planning: build_planning_lookup(planning_fc_raw || { type: "FeatureCollection", features: [] }),
    subzone: build_subzone_lookup(subzone_fc_raw || { type: "FeatureCollection", features: [] }),
    road: build_road_lookup(road_fc_raw || { type: "FeatureCollection", features: [] }),
  }), [planning_fc_raw, subzone_fc_raw, road_fc_raw]);

  /* ========= enrich floods ========= */
  const floods_fc_enriched = useMemo(
    () => enrich_floods(floods_fc_raw || { type: "FeatureCollection", features: [] }, lookups),
    [floods_fc_raw, lookups]
  );

  /* ========= enrich amenities ========= */
  const amenity_fc_enriched = useMemo(
    () => enrich_amenities(amenity_fc_raw || { type: "FeatureCollection", features: [] }, lookups, category_lookup),
    [amenity_fc_raw, lookups, category_lookup]
  );

  /* ========= enrich roads (counts) ========= */
  const road_fc_enriched = useMemo(() => {
    if (!road_fc_raw?.features?.length) return { type: "FeatureCollection", features: [] };

    const flood_counts = Object.create(null);
    for (const f of floods_fc_enriched.features || []) {
      const p = f.properties || {};
      for (const rn_id of [p.start_rn_id, p.end_rn_id, p.origin_rn_id].filter(x => x != null)) {
        flood_counts[rn_id] = (flood_counts[rn_id] || 0) + 1;
      }
    }

    const amenity_counts = Object.create(null);
    for (const f of amenity_fc_enriched?.features || []) {
      const p = f.properties || {};
      if (p.rn_id != null) {
        amenity_counts[p.rn_id] = (amenity_counts[p.rn_id] || 0) + 1;
      }
    }

    const features = road_fc_raw.features.map(f => {
      const p = { ...(f.properties || {}) };
      const rn_id = to_int(p.rn_id ?? p.RN_ID);
      p.rn_id = rn_id;
      p.flood_count = flood_counts[rn_id] || 0;
      p.amenity_count = amenity_counts[rn_id] || 0;
      p.total_count = p.flood_count + p.amenity_count;
      return { ...f, properties: p };
    });

    return { type: "FeatureCollection", features };
  }, [road_fc_raw, floods_fc_enriched, amenity_fc_enriched]);

  /* ========= console summary ========= */
  useEffect(() => {
    console.log("🧭 loaded data summary:", {
      planning: planning_fc_raw?.features?.length,
      subzone: subzone_fc_raw?.features?.length,
      road: road_fc_raw?.features?.length,
      floods_raw: floods_fc_raw?.features?.length,
      amenities_raw: amenity_fc_raw?.features?.length,
      categories: category_lookup?.table?.length,
      floods_enriched: floods_fc_enriched?.features?.length,
      amenities_enriched: amenity_fc_enriched?.features?.length,
      flood_scenarios: flood_scenarios?.length,
    });
  }, [
    planning_fc_raw, subzone_fc_raw, road_fc_raw,
    floods_fc_raw, amenity_fc_raw, category_lookup,
    floods_fc_enriched, amenity_fc_enriched, flood_scenarios
  ]);

  const value = {
    planning_fc_raw,
    subzone_fc_raw,
    road_fc_enriched,
    floods_fc_enriched,
    amenity_fc_raw,
    amenity_fc_enriched,
    category_lookup,
    flood_scenarios,
    lookups,
    loading,
    error,
  };

  return (
    <MapDataContext.Provider value={value}>
      {loading && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-lg border bg-card px-6 py-4 shadow-lg text-center space-y-2">
            <p className="text-sm font-medium">
              Loading map data…
            </p>
            <p className="text-xs text-muted-foreground">
              This view is consuming data from the API. Please wait and avoid interacting with the page.
            </p>
          </div>
        </div>
      )}
      {children}
    </MapDataContext.Provider>
  );
}

function useMapData() {
  const ctx = useContext(MapDataContext);
  if (!ctx) throw new Error("useMapData must be used inside MapDataProvider");
  return ctx;
}

export { MapDataProvider, useMapData };
export default MapDataContext;
