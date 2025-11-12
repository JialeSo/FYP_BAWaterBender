export const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";
export const MAP_DEFAULT_CENTER = [103.8198, 1.3521];
export const MAP_DEFAULT_ZOOM = 11;
export const PAGE_SIZE = 40;
export const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

export const COLOR_SCORE = [
  "interpolate", ["linear"], ["coalesce", ["to-number", ["get", "importance"]], 0],
  0, "#dbeafe",
  20, "#93c5fd",
  40, "#60a5fa",
  70, "#3b82f6",
  90, "#1d4ed8",
];

export const WIDTH_EXPR = [
  "interpolate", ["linear"], ["coalesce", ["to-number", ["get", "betweenness_norm"]], 0],
  0, 1, 0.05, 1.5, 0.1, 2.5, 0.3, 4, 0.6, 6, 1, 8,
];

export const MOCK_EXAMPLE = {
  name: "Example Boulevard",
  betweenness_norm: 0.65,
  closeness_norm: 0.72,
  amenities: [
    { category: "Community_spaces", count: 2 },
    { category: "Education_institutions", count: 3 },
    { category: "Emergency_services", count: 1 },
    { category: "Essential_services", count: 2 },
    { category: "Government_services", count: 3 },
    { category: "Healthcare_facilities", count: 1 },
    { category: "Residential", count: 2 },
    { category: "Retail_services", count: 3 },
    { category: "Tourism", count: 1 },
    { category: "Transport_services", count: 1 },
  ],
  floods: [
    { type: "flash_flood", count: 2 },
    { type: "flash_flood_risk", count: 1 },
  ],
};

export const PRESETS = {
  balanced: {
    name: "Balanced (Default)",
    description: "Equal consideration of all factors",
    weights: { betweenness: 0.4, closeness: 0.3, amenity: 0.2, flood: 0.1 },
    toggles: { betweenness: true, closeness: true, amenity: true, flood: true },
  },
  amenityFlood: {
    name: "Amenity + Flood Focused",
    description: "Prioritize amenity access and flood risk",
    weights: { betweenness: 0.2, closeness: 0.1, amenity: 0.4, flood: 0.3 },
    toggles: { betweenness: true, closeness: true, amenity: true, flood: true },
  },
  centrality: {
    name: "Centrality Focused",
    description: "Emphasize network topology metrics",
    weights: { betweenness: 0.5, closeness: 0.5, amenity: 0, flood: 0 },
    toggles: { betweenness: true, closeness: true, amenity: false, flood: false },
  },
};

export const AMENITY_PRESETS = {
  default: {
    name: "Default",
    description: "Custom weighted priorities",
    weights: {
      Community_spaces: 2.0,
      Education_institutions: 2.5,
      Emergency_services: 3.5,
      Essential_services: 3.0,
      Government_services: 2.5,
      Healthcare_facilities: 4.0,
      Residential: 1.5,
      Retail_services: 1.5,
      Tourism: 1.0,
      Transport_services: 2.5,
    },
  },
  balanced: {
    name: "Balanced",
    description: "All categories weighted equally",
    weights: {
      Community_spaces: 1.0,
      Education_institutions: 1.0,
      Emergency_services: 1.0,
      Essential_services: 1.0,
      Government_services: 1.0,
      Healthcare_facilities: 1.0,
      Residential: 1.0,
      Retail_services: 1.0,
      Tourism: 1.0,
      Transport_services: 1.0,
    },
  },
  emergency: {
    name: "Emergency Focused",
    description: "Prioritize emergency and healthcare services",
    weights: {
      Community_spaces: 1.0,
      Education_institutions: 1.5,
      Emergency_services: 5.0,
      Essential_services: 3.5,
      Government_services: 2.0,
      Healthcare_facilities: 5.0,
      Residential: 1.0,
      Retail_services: 1.0,
      Tourism: 0.5,
      Transport_services: 3.0,
    },
  },
};

export const FLOOD_PRESETS = {
  default: {
    name: "Default",
    description: "Flash floods weighted higher",
    weights: {
      flash_flood: 2.5,
      flash_flood_risk: 1.5,
    },
  },
  balanced: {
    name: "Balanced",
    description: "All flood types weighted equally",
    weights: {
      flash_flood: 1.0,
      flash_flood_risk: 1.0,
    },
  },
  emergency: {
    name: "Emergency Focused",
    description: "Prioritize actual flood events",
    weights: {
      flash_flood: 4.0,
      flash_flood_risk: 1.0,
    },
  },
};

export const nznum = (v) => (Number.isFinite(+v) ? +v : 0);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const strip_count_suffix = (s) => String(s).replace(/\s*\(\s*\d[\d,]*\s*\)\s*$/, "").trim();

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

export function format_number(val, digits = 1) {
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function format_cell(value, column) {
  if (column?.format) {
    const out = column.format(value);
    if (out !== null && out !== undefined) return out;
  }
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function make_percentiler(values) {
  const arr = values.filter((x) => Number.isFinite(+x)).map(Number).sort((a, b) => a - b);
  if (!arr.length) return () => 0;
  return (v) => {
    if (!Number.isFinite(+v)) return 0;
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= v) lo = mid + 1; else hi = mid;
    }
    return Math.max(0, Math.min(100, (lo / arr.length) * 100));
  };
}

export const get_amenity_category = (props = {}) =>
  props.amenity_category ?? props.category ?? props.amenity ?? "unknown";

export const get_amenity_category_id = (props = {}) =>
  props.amenity_category_id ?? props.category_id ?? props.amenity_categoryid ?? null;

export const get_flood_type = (props = {}) =>
  props.flood_type ?? props.type ?? props.event ?? props.category ?? "unknown";

export const get_road_type = (props = {}) =>
  props.highway ?? props.road_class ?? props.class ?? props.HIGHWAY ?? "unknown";
