// general map/filter helpers
export const buildMatchFilter = (field, values) =>
  (!values?.length
    ? ["==", ["get", field], "__none__"]
    : ["match", ["get", field], values, true, false]);

export const computeFeatureBounds = (geometry) => {
  if (!geometry) return null;
  const pts = [];
  const collect = (c) => {
    if (!c) return;
    if (typeof c[0] === "number") {
      pts.push([c[0], c[1]]);
      return;
    }
    for (const x of c) collect(x);
  };
  collect(geometry.coordinates);
  if (!pts.length) return null;
  let [minLng, minLat] = pts[0],
    [maxLng, maxLat] = pts[0];
  for (const [lng, lat] of pts) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
};

export const mergeBounds = (a, b) =>
  !b
    ? a ?? null
    : !a
    ? [
        [b[0][0], b[0][1]],
        [b[1][0], b[1][1]],
      ]
    : [
        [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])],
        [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])],
      ];

// styling helpers: choropleth & line widths
export const buildChoroplethExpression = (field, countMap, maxCount, palette, fallbackColor) => {
  const entries = Object.entries(countMap || {});
  if (!entries.length || !maxCount) return fallbackColor;
  const safeMax = Math.max(1, maxCount);
  const expr = Array.isArray(field) ? ["match", field] : ["match", ["get", field]];
  for (const [label, v] of entries) {
    const ratio = Math.max(0, Math.min(1, Number(v) / safeMax));
    const idx = Math.min(palette.length - 1, Math.floor(ratio * (palette.length - 1)));
    expr.push(label, palette[idx]);
  }
  expr.push(fallbackColor);
  return expr;
};

export const buildLineWidthExpression = (
  field,
  countMap,
  maxCount,
  minW = 1.2,
  maxW = 6,
  fallback = 1.2
) => {
  const entries = Object.entries(countMap || {});
  if (!entries.length || !maxCount) return fallback;
  const safeMax = Math.max(1, maxCount);
  const expr = Array.isArray(field) ? ["match", field] : ["match", ["get", field]];
  for (const [label, v] of entries) {
    const ratio = Math.max(0, Math.min(1, Number(v) / safeMax));
    const w = minW + ratio * (maxW - minW);
    expr.push(label, Number.isFinite(w) ? w : minW);
  }
  expr.push(fallback);
  return expr;
};

// aggregates used by hover + amenity-based coloring
export function aggregateAmenityStats(amenityFC) {
  const byPA = {}, bySZ = {};
  for (const f of amenityFC.features ?? []) {
    const p = f.properties || {};
    const pa = (p.planning_area || "").trim();
    const sz = (p.subzone || "").trim();
    const cat = (p.amenity_category || p.amenity_type || "other").toString().trim().toLowerCase();
    const flood = Number(p.flood_count);
    const add = (obj, key) => {
      if (!key) return;
      if (!obj[key]) obj[key] = { total: 0, flood_sum: 0, by_category: {} };
      obj[key].total += 1;
      obj[key].flood_sum += Number.isFinite(flood) ? flood : 0;
      obj[key].by_category[cat] = (obj[key].by_category[cat] || 0) + 1;
    };
    add(byPA, pa);
    add(bySZ, sz);
  }
  return { byPA, bySZ };
}