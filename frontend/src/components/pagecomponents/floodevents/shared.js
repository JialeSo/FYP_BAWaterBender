export const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";
export const MAP_DEFAULT_CENTER = [103.8198, 1.3521];
export const MAP_DEFAULT_ZOOM = 11;
export const PAGE_SIZE = 40;
export const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

// Flood type configurations with weights
export const FLOOD_TYPE_PRESETS = {
  balanced: {
    name: "Default Balanced",
    description: "Weighted priorities for flood severity",
    types: {
      flash_flood: true,
      flash_flood_risk: true,
      ponding: true,
      drainage_issue: true,
    },
    weights: {
      flash_flood: 2.5,
      flash_flood_risk: 1.5,
      ponding: 1.0,
      drainage_issue: 1.0,
    },
  },
  equal: {
    name: "Equal Weights",
    description: "All flood types weighted equally",
    types: {
      flash_flood: true,
      flash_flood_risk: true,
      ponding: true,
      drainage_issue: true,
    },
    weights: {
      flash_flood: 1.0,
      flash_flood_risk: 1.0,
      ponding: 1.0,
      drainage_issue: 1.0,
    },
  },
  critical: {
    name: "Critical Events Focus",
    description: "Prioritize flash floods and high-risk areas",
    types: {
      flash_flood: true,
      flash_flood_risk: true,
      ponding: true,
      drainage_issue: true,
    },
    weights: {
      flash_flood: 5.0,
      flash_flood_risk: 3.0,
      ponding: 1.0,
      drainage_issue: 0.5,
    },
  },
};

// Date range presets
export const DATE_RANGE_PRESETS = {
  lastMonth: {
    name: "Last Month",
    getDates: () => {
      const now = new Date();
      const end = new Date(now);
      const start = new Date(now.setMonth(now.getMonth() - 1));
      return {
        from: start.toISOString().split("T")[0],
        to: end.toISOString().split("T")[0],
      };
    },
  },
  last3Months: {
    name: "Last 3 Months",
    getDates: () => {
      const now = new Date();
      const end = new Date(now);
      const start = new Date(now.setMonth(now.getMonth() - 3));
      return {
        from: start.toISOString().split("T")[0],
        to: end.toISOString().split("T")[0],
      };
    },
  },
  lastYear: {
    name: "Last Year",
    getDates: () => {
      const now = new Date();
      const end = new Date(now);
      const start = new Date(now.setFullYear(now.getFullYear() - 1));
      return {
        from: start.toISOString().split("T")[0],
        to: end.toISOString().split("T")[0],
      };
    },
  },
  allTime: {
    name: "All Time",
    getDates: () => ({ from: "", to: "" }),
  },
};

// Severity levels
export const SEVERITY_LEVELS = {
  low: { name: "Low", color: "#fbbf24", value: 1 },
  medium: { name: "Medium", color: "#f97316", value: 2 },
  high: { name: "High", color: "#ef4444", value: 3 },
  critical: { name: "Critical", color: "#991b1b", value: 4 },
};

// Helper functions
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

export function format_date(dateStr) {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export const get_flood_type = (props = {}) =>
  props.flood_type ?? props.event ?? props.type ?? props.category ?? "unknown";

export const get_planning_area = (props = {}) =>
  props.origin_planning_area ?? props.planning_area ?? props.PLN_AREA_N ?? props.pa_name ?? "unknown";

export const get_subzone = (props = {}) =>
  props.origin_subzone ?? props.subzone ?? props.SUBZONE_N ?? "unknown";

export const get_location = (props = {}) =>
  props.location ?? props.address ?? props.origin_road ?? props.start_street_name ?? "—";

/**
 * Calculate haversine distance between two points
 * @param {number} lat1 - Latitude of first point
 * @param {number} lng1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lng2 - Longitude of second point
 * @returns {number} Distance in meters
 */
export function calculateHaversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Find features within a radius using haversine distance
 * @param {Array} features - Array of GeoJSON features
 * @param {number} centerLat - Center latitude
 * @param {number} centerLng - Center longitude
 * @param {number} radiusMeters - Search radius in meters
 * @param {Function} coordsExtractor - Function to extract coordinates from feature
 * @returns {Array} Features within radius with _distm property
 */
export function findFeaturesWithinRadius(features, centerLat, centerLng, radiusMeters, coordsExtractor) {
  if (!features || !centerLat || !centerLng) return [];

  return features
    .map(feature => {
      const coords = coordsExtractor(feature);
      if (!coords || coords.length < 2) return null;

      const [lng, lat] = coords;
      const distance = calculateHaversineDistance(centerLat, centerLng, lat, lng);

      if (distance > radiusMeters) return null;

      return {
        ...feature,
        _distm: distance,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a._distm - b._distm);
}
