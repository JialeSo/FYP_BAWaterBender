import * as turf from "@turf/turf";
import mapboxgl from "mapbox-gl";

/* ===== Basic utility functions ===== */
export const to_num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };
export const fmt = (v, d = 6) => (Number.isFinite(+v) ? (+v).toFixed(d) : "N/A");
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const to_title_case = (value) => {
  if (value == null) return "";
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => {
      if (!word) return "";
      const upper = word.toUpperCase();
      if (word === upper && /^[A-Z0-9]+$/.test(word)) return upper;
      const lower = word.toLowerCase();
      if (lower.length <= 2) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
};

export const format_option_label = (value, fallback) => {
  if (!value || value === "all") return fallback || "All";
  return to_title_case(value);
};

export const date_in_range = (dt, from, to) => {
  if (!dt) return true;
  if (from && dt < from) return false;
  if (to && dt > to) return false;
  return true;
};

export const dist_m = (lng1, lat1, lng2, lat2) =>
  turf.distance([lng1, lat1], [lng2, lat2], { units: "kilometers" }) * 1000;

/* ===== Normalization ===== */
export function normalize01(val, min, max) {
  if (!Number.isFinite(val) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return (val - min) / (max - min);
}

/* ===== Map utilities ===== */
export function await_style(map) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded && map.isStyleLoaded()) return resolve();
    const on_load = () => { map.off("load", on_load); resolve(); };
    map.on("load", on_load);
  });
}

export function bounds_from_floods(fc) {
  const b = new mapboxgl.LngLatBounds();
  let had = false;
  for (const f of fc?.features || []) {
    const p = f.properties || {};
    const lng = to_num(p.start_lng);
    const lat = to_num(p.start_lat);
    if (!Number.isNaN(lng) && !Number.isNaN(lat)) {
      b.extend([lng, lat]);
      had = true;
    }
  }
  return had ? b : null;
}

export function build_flood_detail(p) {
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

export function popup_html(p = {}) {
  const safe = (x) => (x ?? "—");
  const coord = (lat, lng) => {
    const latNum = to_num(lat);
    const lngNum = to_num(lng);
    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      return `${latNum.toFixed(5)}, ${lngNum.toFixed(5)}`;
    }
    return "—";
  };
  const typ = to_title_case((p.event || "").replace(/_/g, " ")) || "—";
  const road = p.parent_road || "—";
  return `
    <div>
      <div class="text-xs uppercase opacity-70">Flood</div>
      <div><b>ID:</b> ${safe(p.id)}</div>
      <div><b>Date:</b> ${safe(p.event_date)}</div>
      <div><b>Type:</b> ${typ}</div>
      <div><b>Road:</b> ${road}</div>
      <div class="mt-1 text-xs opacity-70">
        Start: ${coord(p.start_lat, p.start_lng)}
      </div>
      <div class="mt-1 text-xs opacity-70">
        Pred A: ${coord(p.end100_a_lat, p.end100_a_lng)}<br/>
        Pred B: ${coord(p.end100_b_lat, p.end100_b_lng)}<br/>
        End: ${coord(p.end_lat, p.end_lng)}
      </div>
    </div>
  `;
}

/* ===== Roads distance calculations ===== */
export function meters_to_deg(lat, meters) {
  const deg_lat = meters / 111320;
  const deg_lng = meters / (111320 * Math.cos(lat * Math.PI / 180) || 1);
  return { deg_lat, deg_lng };
}

export function roads_within_rings(road_fc, center, r_in, r_out) {
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
