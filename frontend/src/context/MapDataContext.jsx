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
import { createContext, useContext, useEffect, useState } from "react";

/* ========== tiny CSV core ========== */
/** Quote-safe CSV -> array of objects (headers preserved) */
function parseCSV(text) {
  // normalize, strip BOM
  const s = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", i = 0, inQuotes = false;

  const pushCell = () => { row.push(cell); cell = ""; };
  const pushRow  = () => { if (row.length) rows.push(row); row = []; };

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { pushCell(); i++; continue; }
    if (ch === "\r") { pushCell(); pushRow(); i += (s[i + 1] === "\n" ? 2 : 1); continue; }
    if (ch === "\n") { pushCell(); pushRow(); i++; continue; }
    cell += ch; i++;
  }
  pushCell(); pushRow();

  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map(h => h.trim());
  const records = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
    return obj;
  });
  return { headers, records };
}

/* ========== TWO parsers ========== */
const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function amenitiesCsvToFC(csvText) {
  const { records } = parseCSV(csvText);
  const features = records.map((rec, idx) => {
    // amenities: use lon/lat exactly
    const lat = toNum(rec.lat);
    const lon = toNum(rec.lon);
    if (lat == null || lon == null) return null;

    const id = rec.amenity_id || rec.id || idx;
    return {
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: rec,
    };
  }).filter(Boolean);

  return { type: "FeatureCollection", features };
}

function floodsCsvToFC(csvText) {
  const { records } = parseCSV(csvText);
  const features = records.map((rec, idx) => {
    // floods: use start_lat/start_lng; fallback to end_lat/end_lng if start missing
    let lat = toNum(rec.start_lat);
    let lon = toNum(rec.start_lng);
    if (lat == null || lon == null) {
      lat = toNum(rec.end_lat);
      lon = toNum(rec.end_lng);
    }
    if (lat == null || lon == null) return null;

    const id = rec.id || idx;
    return {
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: rec,
    };
  }).filter(Boolean);

  return { type: "FeatureCollection", features };
}

/* ========== small GeoJSON helper ========== */
function asFeatureCollection(data) {
  if (!data) return { type: "FeatureCollection", features: [] };
  if (data.type === "FeatureCollection") return data;
  return { type: "FeatureCollection", features: Array.isArray(data) ? data : [] };
}

/* ========== context ========== */
const MapDataContext = createContext(null);

export function MapDataProvider({ children }) {
  const [planningFC, setPlanning] = useState(null);
  const [subzoneFC, setSubzone] = useState(null);
  const [roadFC, setRoad] = useState(null);
  const [floodsFC, setFloods] = useState(null);
  const [amenityFC, setAmenity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        const [planning, subzone, road, floodsCsv, amenityCsv] = await Promise.all([
          fetch("/map/planning_area.geojson").then((r) => r.json()),
          fetch("/map/subzone_area.geojson").then((r) => r.json()),
          fetch("/map/road_network.geojson").then((r) => r.json()),
          fetch("/map/floods_3layers.csv").then((r) => r.text()),
          fetch("/map/amenities_3layers.csv").then((r) => r.text()),
        ]);

        setPlanning(asFeatureCollection(planning));
        setSubzone(asFeatureCollection(subzone));
        setRoad(asFeatureCollection(road));

        const floodsBuilt   = floodsCsvToFC(floodsCsv);
        const amenitiesBuilt= amenitiesCsvToFC(amenityCsv);

        setFloods(floodsBuilt);
        setAmenity(amenitiesBuilt);

        // quick sanity check
        console.log("Loaded counts", {
          floods: floodsBuilt.features.length,
          amenities: amenitiesBuilt.features.length,
        });
      } catch (e) {
        console.error(e);
        setError(e?.message || "failed to load local map data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <MapDataContext.Provider
      value={{ planningFC, subzoneFC, roadFC, floodsFC, amenityFC, loading, error }}
    >
      {children}
    </MapDataContext.Provider>
  );
}

export function useMapData() {
  const ctx = useContext(MapDataContext);
  if (!ctx) throw new Error("useMapData must be used inside MapDataProvider");
  return ctx;
}



