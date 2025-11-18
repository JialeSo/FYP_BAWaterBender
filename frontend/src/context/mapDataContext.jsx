// // src/context/MapDataContext.jsx
// import { createContext, useContext, useEffect, useMemo, useState } from "react";
// import proj4 from "proj4";

// const API_BASE = (import.meta.env.VITE_BACKEND_URL || "https://fyp-ba-water-bender-six.vercel.app").trim();

// /* =========================
//    projection helpers
// ========================= */
// const EPSG3414 =
//   "+proj=tmerc +lat_0=1.3666666666666667 +lon_0=103.83333333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs";
// const num = (v) => (typeof v === "string" ? Number(v) : v);
// const isLikelyLonLat = (x, y) => x >= -180 && x <= 180 && y >= -90 && y <= 90;
// const isLikelySVY21 = (x, y) => x > 1000 && y > 1000 && (x > 10000 || y > 10000);
// const toWgs84 = (pt) => proj4(EPSG3414, proj4.WGS84, [num(pt[0]), num(pt[1])]);

// const reprojectGeometryIfNeeded = (geometry) => {
//   if (!geometry?.coordinates) return geometry;
//   const convert = (coord) => {
//     const x = num(coord[0]);
//     const y = num(coord[1]);
//     if (!Number.isFinite(x) || !Number.isFinite(y)) return coord;
//     if (isLikelyLonLat(x, y)) return [x, y];
//     if (isLikelySVY21(x, y)) return toWgs84([x, y]);
//     return [x, y];
//   };
//   const walk = (coords) =>
//     typeof coords[0] === "number" ? convert(coords) : coords.map(walk);
//   return { ...geometry, coordinates: walk(geometry.coordinates) };
// };

// /* =========================
//    WKB → GeoJSON parser
// ========================= */
// function hexToBytes(hex) {
//   const len = hex.length / 2;
//   const out = new Uint8Array(len);
//   for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
//   return out;
// }
// function readFloat64(view, offset, little) {
//   return view.getFloat64(offset, little);
// }
// function readUint32(view, offset, little) {
//   return view.getUint32(offset, little);
// }
// function parseWkbGeometry(view, offset = 0) {
//   const byteOrder = view.getUint8(offset);
//   const little = byteOrder === 1;
//   let off = offset + 1;
//   let typeWithFlags = readUint32(view, off, little);
//   off += 4;

//   const EWKB_SRID = 0x20000000;
//   const geomType = typeWithFlags & 0xff;
//   if (typeWithFlags & EWKB_SRID) off += 4; // skip SRID

//   if (geomType === 2) {
//     const n = readUint32(view, off, little);
//     off += 4;
//     const coords = new Array(n);
//     for (let i = 0; i < n; i++) {
//       const x = readFloat64(view, off, little);
//       off += 8;
//       const y = readFloat64(view, off, little);
//       off += 8;
//       coords[i] = [x, y];
//     }
//     return [{ type: "LineString", coordinates: coords }, off];
//   }

//   if (geomType === 5) {
//     const m = readUint32(view, off, little);
//     off += 4;
//     const lines = [];
//     for (let i = 0; i < m; i++) {
//       const [subGeom, newOff] = parseWkbGeometry(view, off);
//       off = newOff;
//       if (subGeom?.type === "LineString") lines.push(subGeom.coordinates);
//     }
//     return [{ type: "MultiLineString", coordinates: lines }, off];
//   }

//   throw new Error(`Unsupported WKB geometry type: ${geomType}`);
// }
// function parseWkbHexToGeometry(hex) {
//   const clean = hex.trim().toLowerCase().replace(/^0x/, "");
//   const bytes = hexToBytes(clean);
//   const view = new DataView(bytes.buffer);
//   const [geom] = parseWkbGeometry(view, 0);
//   return geom;
// }

// /* =========================
//    point feature helpers
// ========================= */
// function makePointFeature(lon, lat, props = {}, id) {
//   const x = num(lon);
//   const y = num(lat);
//   if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
//   return {
//     type: "Feature",
//     id,
//     geometry: { type: "Point", coordinates: [x, y] },
//     properties: props,
//   };
// }

// /* =========================
//    row → feature
// ========================= */
// function toFeature(row, opts = {}) {
//   if (!row) return null;

//   // 1️⃣ if it’s already a GeoJSON feature
//   if (row.type === "Feature") {
//     return { ...row, geometry: reprojectGeometryIfNeeded(row.geometry) };
//   }

//   // 2️⃣ if it has a geom field (WKB)
//   if (row.geom) {
//     let geometry = typeof row.geom === "string" ? parseWkbHexToGeometry(row.geom) : row.geom;
//     geometry = reprojectGeometryIfNeeded(geometry);
//     const { geom, ...propsRaw } = row;
//     return {
//       type: "Feature",
//       geometry,
//       properties: propsRaw,
//       id: propsRaw[opts.idProp] ?? propsRaw.id,
//     };
//   }

//   // 3️⃣ if it has lat/lon (for amenities / floods)
//   if (row.lat && row.lon) {
//     return makePointFeature(row.lon, row.lat, row, row[opts.idProp] ?? row.id);
//   }
//   if (row.start_lat && row.start_lng) {
//     return makePointFeature(row.start_lng, row.start_lat, row, row[opts.idProp] ?? row.id);
//   }

//   return null;
// }

// /* =========================
//    array → featurecollection
// ========================= */
// function asFeatureCollection(input, opts) {
//   const rows = Array.isArray(input) ? input : input?.data;
//   if (rows) {
//     const features = rows.map((r) => toFeature(r, opts)).filter(Boolean);
//     return { type: "FeatureCollection", features };
//   }
//   return { type: "FeatureCollection", features: [] };
// }

// /* =========================
//    context
// ========================= */
// const MapDataContext = createContext(null);

// export function MapDataProvider({ children }) {
//   const [planningRaw, setPlanningRaw] = useState(null);
//   const [subzoneRaw, setSubzoneRaw] = useState(null);
//   const [roadRaw, setRoadRaw] = useState(null);
//   const [floodsRaw, setFloodsRaw] = useState(null);
//   const [amenityRaw, setAmenityRaw] = useState(null);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState("");

//   useEffect(() => {
//     let cancelled = false;
//     async function fetchJson(url) {
//       const res = await fetch(url, { headers: { accept: "application/json" } });
//       if (!res.ok) throw new Error(`${url} → ${res.status}`);
//       return res.json();
//     }

//     (async () => {
//       setLoading(true);
//       setError("");
//       try {
//         const [planning, subzone, road, floods, amenity] = await Promise.all([
//           fetchJson(`${API_BASE}/api/planning-area/`),
//           fetchJson(`${API_BASE}/api/subzone/`),
//           fetchJson(`${API_BASE}/api/road-network/`),
//           fetchJson(`${API_BASE}/api/floods-3layers/`),
//           fetchJson(`${API_BASE}/api/amenity-3layers/`),
//         ]);
//         if (cancelled) return;
//         setPlanningRaw(planning);
//         setSubzoneRaw(subzone);
//         setRoadRaw(road);
//         setFloodsRaw(floods);
//         setAmenityRaw(amenity);
//       } catch (e) {
//         console.error(e);
//         if (!cancelled)
//           setError(e instanceof Error ? e.message : "Failed to load map datasets");
//       } finally {
//         if (!cancelled) setLoading(false);
//       }
//     })();

//     return () => { cancelled = true; };
//   }, []);

//   const planningFC = useMemo(
//     () => asFeatureCollection(planningRaw, { idProp: "PA_ID" }),
//     [planningRaw]
//   );
//   const subzoneFC = useMemo(
//     () => asFeatureCollection(subzoneRaw, { idProp: "SZ_ID" }),
//     [subzoneRaw]
//   );
//   const roadFC = useMemo(
//     () => asFeatureCollection(roadRaw, { idProp: "FEATURE_ID" }),
//     [roadRaw]
//   );
//   const floodsFC = useMemo(
//     () => asFeatureCollection(floodsRaw, { idProp: "id" }),
//     [floodsRaw]
//   );
//   const amenityFC = useMemo(
//     () => asFeatureCollection(amenityRaw, { idProp: "amentity_id" }),
//     [amenityRaw]
//   );

//   const value = {
//     planningFC,
//     subzoneFC,
//     roadFC,
//     floodsFC,
//     amenityFC,
//     loading,
//     error,
//   };

//   return <MapDataContext.Provider value={value}>{children}</MapDataContext.Provider>;
// }

// export function useMapData() {
//   const ctx = useContext(MapDataContext);
//   if (!ctx) throw new Error("useMapData must be used inside MapDataProvider");
//   return ctx;
// }



// for local dev
// src/context/MapDataContext.jsx

import { createContext, useContext, useEffect, useMemo, useState } from "react";

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

/* ========= date parser ========= */
function parse_event_date(dmy) {
  if (!dmy) return null;
  const m = String(dmy).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const d = m[1].padStart(2, "0");
  const mo = m[2].padStart(2, "0");
  const y = m[3];
  return `${y}-${mo}-${d}`;
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
        amenity_category: nz(rec.amenity_category),   // may be blank; will be resolved later
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

/* ========= base helpers ========= */
function as_feature_collection(data) {
  if (!data) return { type: "FeatureCollection", features: [] };
  if ((data.type || "") === "FeatureCollection") return data;
  return { type: "FeatureCollection", features: Array.isArray(data) ? data : [] };
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

/* ========= amenity category lookup ========= */
function build_category_lookup(csv_text) {
  const { records } = parse_csv(csv_text);
  const by_id = Object.create(null);
  const by_name = Object.create(null);
  const table = [];
  for (const r of records) {
    const id = to_int(r.amenity_category_id);
    const name = String(r.amenity_category || "").trim();
    if (id == null || !name) continue;
    const row = { id, amenity_category: name, slug: slug(name) };
    by_id[id] = row;
    by_name[row.slug] = row;
    table.push(row);
  }
  table.sort((a, b) => a.id - b.id);
  return { by_id, by_name, table };
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

  /* ========= load all local assets ========= */
  useEffect(() => {
    (async () => {
      try {
        set_loading(true);
        const [
          planning, subzone, road,
          floods_csv, amenity_csv,
          category_csv, scenarios_csv
        ] = await Promise.all([
          fetch("/map/planning_area.geojson").then(r => r.json()),
          fetch("/map/subzone_area.geojson").then(r => r.json()),
          fetch("/map/road_network.geojson").then(r => r.json()),
          fetch("/map/flood_3layers.csv").then(r => r.text()),
          fetch("/map/amenity_3layers.csv").then(r => r.text()),
          fetch("/map/amenity_category_lookup_rows.csv").then(r => r.text()),
          fetch("/map/road_network_flood_scenarios.csv").then(r => r.text()),
        ]);

        set_planning_raw(as_feature_collection(planning));
        set_subzone_raw(as_feature_collection(subzone));
        set_road_raw(as_feature_collection(road));
        set_floods_raw(floods_csv_to_fc(floods_csv));
        set_amenity_raw(amenities_csv_to_fc(amenity_csv));
        set_category_lookup(build_category_lookup(category_csv));

        // Parse flood scenarios
        const { records } = parse_csv(scenarios_csv);
        const byScenario = new Map();
        for (const row of records) {
          const scenario = row.flood_scenario?.trim();
          const rn_id = to_int(row.RN_ID);
          const name = row.RD_NAME?.trim() || `Road ${rn_id}`;
          const pa_name = row.PLN_AREA_N?.trim();

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
        set_flood_scenarios(scenarios);

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

  /* ========= enrich amenities (names + category) ========= */
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

  /* ========= context value ========= */
  const value = {
    planning_fc_raw,
    subzone_fc_raw,
    road_fc_enriched,
    floods_fc_enriched,
    amenity_fc_raw,
    amenity_fc_enriched,   // ⬅️ expose enriched amenities
    category_lookup,
    flood_scenarios,       // ⬅️ expose flood scenarios
    lookups,
    loading,
    error,
  };

  return <MapDataContext.Provider value={value}>{children}</MapDataContext.Provider>;
}

/* ========= hook ========= */
function useMapData() {
  const ctx = useContext(MapDataContext);
  if (!ctx) throw new Error("useMapData must be used inside MapDataProvider");
  return ctx;
}

export { MapDataProvider, useMapData };
export default MapDataContext;